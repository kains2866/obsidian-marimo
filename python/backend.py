"""Pinned marimo protocol adapter. Never expose its local authentication token."""
import argparse
import asyncio
import http.cookiejar
import hashlib
from html.parser import HTMLParser
import importlib.metadata
import json
import os
import secrets
import signal
import socket
import tempfile
import stat
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from websockets.asyncio.client import connect

SUPPORTED_VERSION = "0.25.2"


class ServerTokenParser(HTMLParser):
    token = None

    def handle_starttag(self, tag, attrs):
        if tag == "marimo-server-token":
            self.token = dict(attrs).get("data-token")


class NativeSession:
    def __init__(self, filename, on_event=None):
        self.filename = Path(filename).resolve(strict=True)
        self.on_event = on_event or (lambda event: None)
        self.process = None
        self.ws = None
        self.closed = False
        self.own_service_group = os.name == "posix" and os.environ.get("MARIMO_NATIVE_PARENT_GROUP") != "1"
        self.cells = []
        self.token = secrets.token_urlsafe(32)
        self.session_id = secrets.token_hex(16)
        self.cookies = http.cookiejar.CookieJar()
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.cookies))
        self.base_url = ""
        self.server_token = ""
        self._drain_task = None
        self.layout = None
        self.initial_events = []
        self.fingerprint = hashlib.sha256(self.filename.read_bytes()).hexdigest()

    def _request(self, path, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": "application/json", "Marimo-Session-Id": self.session_id, "Authorization": "Bearer " + self.token}
        if self.server_token:
            headers["Marimo-Server-Token"] = self.server_token
        request = urllib.request.Request(self.base_url + path, data=data, headers=headers)
        with self.http.open(request, timeout=10) as response:
            return response.read().decode()

    async def start(self):
        if importlib.metadata.version("marimo") != SUPPORTED_VERSION:
            raise RuntimeError("Native prototype requires marimo " + SUPPORTED_VERSION)
        try:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            self.base_url = f"http://127.0.0.1:{port}"
            self.process = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "marimo", "edit", str(self.filename),
                "--host", "127.0.0.1", "--port", str(port), "--headless", "--no-sandbox",
                "--token-password-file", "-", "--skip-update-check",
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE, start_new_session=self.own_service_group,
            )
            self.process.stdin.write((self.token + "\n").encode())
            await self.process.stdin.drain()
            self.process.stdin.close()
            self._drain_task = asyncio.create_task(self._drain_stderr())
            for _ in range(150):
                if self.process.returncode is not None:
                    raise RuntimeError("marimo service exited during startup")
                try:
                    page = await asyncio.to_thread(self._request, "/?access_token=" + self.token)
                    parser = ServerTokenParser()
                    parser.feed(page)
                    if not parser.token:
                        raise RuntimeError("marimo did not provide a server token")
                    self.server_token = parser.token
                    break
                except (OSError, urllib.error.URLError):
                    await asyncio.sleep(0.1)
            else:
                raise TimeoutError("marimo startup timed out")
            await self._connect_protocol()
        except BaseException:
            await self.close()
            raise

    async def _drain_stderr(self):
        while self.process and self.process.stderr and await self.process.stderr.read(65536):
            pass

    async def _next_event(self):
        frame = json.loads(await asyncio.wait_for(self.ws.recv(), 90))
        event = frame.get("data", {})
        if not isinstance(event, dict):
            raise RuntimeError("Invalid marimo event")
        return {**event, "op": frame["op"]}

    async def _connect_protocol(self):
        url = self.base_url.replace("http://", "ws://") + "/ws?" + urllib.parse.urlencode({"session_id": self.session_id})
        self.ws = await connect(url, additional_headers={"Authorization": "Bearer " + self.token}, origin=self.base_url, proxy=None, max_size=16 * 1024 * 1024)
        for _ in range(200):
            ready = await self._next_event()
            if ready["op"] == "kernel-ready":
                break
        else:
            raise RuntimeError("marimo did not provide notebook state")
        ids, codes = ready["cell_ids"], ready["codes"]
        if len(ids) != len(codes):
            raise RuntimeError("Invalid marimo notebook state")
        self.cells = [{"id": cell_id, "code": code, "name": ready["names"][i], "config": ready["configs"][i]} for i, (cell_id, code) in enumerate(zip(ids, codes))]
        self.layout = ready.get("layout")
        await asyncio.to_thread(self._request, "/api/kernel/instantiate", {"objectIds": [], "values": [], "autoRun": True})
        self.initial_events = await self._collect_run(publish=False)

    async def _collect_run(self, publish=True):
        events = []
        total_bytes = 0
        while True:
            event = await self._next_event()
            total_bytes += len(json.dumps(event))
            if total_bytes > 16 * 1024 * 1024:
                raise RuntimeError("Prototype output limit reached")
            if publish:
                self.on_event(event)
            events.append(event)
            if event["op"] == "completed-run":
                return events
            if len(events) > 10000:
                raise RuntimeError("Prototype event limit reached")

    def _validate_cells(self, cells, all_cells=False):
        known = {cell["id"] for cell in self.cells}
        ids = [cell.get("id") for cell in cells]
        if len(ids) != len(set(ids)) or not set(ids) <= known or any(not isinstance(cell.get("code"), str) for cell in cells):
            raise ValueError("Invalid cell update")
        if all_cells and set(ids) != known:
            raise ValueError("Saving requires every original cell")

    async def run(self, cells):
        if self.closed:
            raise RuntimeError("Session stopped; reconnect before running")
        self._validate_cells(cells)
        try:
            await asyncio.to_thread(self._request, "/api/kernel/run", {"cellIds": [cell["id"] for cell in cells], "codes": [cell["code"] for cell in cells]})
            return await self._collect_run()
        except BaseException:
            # A partial cycle cannot safely be reused: never consume its late events as another run.
            await self.close()
            raise

    async def save(self, cells):
        self._validate_cells(cells, all_cells=True)
        if hashlib.sha256(self.filename.read_bytes()).hexdigest() != self.fingerprint:
            raise RuntimeError("Notebook changed outside this view; reopen before saving")
        original = {cell["id"]: cell for cell in self.cells}
        payload = {"cellIds": [cell["id"] for cell in cells], "codes": [cell["code"] for cell in cells], "names": [original[cell["id"]]["name"] for cell in cells], "configs": [original[cell["id"]]["config"] for cell in cells], "filename": str(self.filename), "layout": self.layout, "persist": False}
        if self.layout is not None:
            raise RuntimeError("Saving separate layout files is not supported by this prototype")
        contents = await asyncio.to_thread(self._request, "/api/kernel/save", payload)
        if hashlib.sha256(self.filename.read_bytes()).hexdigest() != self.fingerprint:
            raise RuntimeError("Notebook changed while preparing save; file was not overwritten")
        compile(contents, str(self.filename), "exec")
        fd, temporary_name = tempfile.mkstemp(prefix=".marimo-native-", suffix=".tmp", dir=self.filename.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
                os.fchmod(stream.fileno(), stat.S_IMODE(self.filename.stat().st_mode))
                stream.write(contents)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.filename)
        finally:
            temporary.unlink(missing_ok=True)
        self.fingerprint = hashlib.sha256(self.filename.read_bytes()).hexdigest()

    async def close(self):
        self.closed = True
        if self.ws is not None:
            try:
                await self.ws.close()
            except Exception:
                # Socket shutdown must never prevent terminating our owned service.
                pass
            finally:
                self.ws = None
        if self.process and self.process.returncode is None:
            try:
                if self.own_service_group:
                    os.killpg(self.process.pid, signal.SIGTERM)
                else:
                    self.process.terminate()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(self.process.wait(), 8)
            except asyncio.TimeoutError:
                try:
                    if self.own_service_group:
                        os.killpg(self.process.pid, signal.SIGKILL)
                    else:
                        self.process.kill()
                except ProcessLookupError:
                    pass
                await self.process.wait()
        if self._drain_task:
            await self._drain_task
            self._drain_task = None


def emit(frame):
    print(json.dumps(frame, ensure_ascii=False), flush=True)


async def serve(filename):
    try:
        session = NativeSession(filename, lambda event: emit({"type": "event", "data": event}))
    except Exception as error:
        emit({"type": "error", "error": "Could not open notebook: " + str(error)})
        return
    task = asyncio.current_task()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, task.cancel)
        except (NotImplementedError, RuntimeError):
            pass
    try:
        await session.start()
        emit({"type": "ready", "cells": session.cells})
        for event in session.initial_events:
            emit({"type": "event", "data": event})
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            request_id = ""
            try:
                request = json.loads(line)
                request_id = str(request["id"])
                method, cells = request["method"], request["cells"]
                if method == "run":
                    await session.run(cells)
                elif method == "save":
                    await session.save(cells)
                else:
                    raise ValueError("Unsupported operation")
                emit({"type": "result", "id": request_id})
            except Exception as error:
                message = str(error).replace(session.token, "[redacted]").replace(session.server_token, "[redacted]") if session.server_token else str(error).replace(session.token, "[redacted]")
                emit({"type": "result", "id": request_id, "error": message})
                if session.closed:
                    emit({"type": "error", "error": "Session stopped after an incomplete operation; reconnect"})
                    break
    except asyncio.CancelledError:
        pass
    except Exception as error:
        message = str(error).replace(session.token, "[redacted]")
        if session.server_token:
            message = message.replace(session.server_token, "[redacted]")
        emit({"type": "error", "error": message})
    finally:
        await session.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--notebook", required=True)
    arguments = parser.parse_args()
    asyncio.run(serve(arguments.notebook))
