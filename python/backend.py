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
import webbrowser
from pathlib import Path

from websockets.asyncio.client import connect

SUPPORTED_VERSION = "0.25.2"

# marimo's own defaults for a freshly created cell; codegen needs them on save.
DEFAULT_CONFIG = {"column": None, "disabled": False, "hide_code": False, "expand_output": False}
CELL_CONFIG_KEYS = set(DEFAULT_CONFIG)
# A single completion answer is a UI list; anything larger is not a menu.
COMPLETION_LIMIT = 50


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
        # Cell ids the kernel knows about: only those can produce a reactive
        # cycle, so only those may be deleted through the service.
        self.registered = set()
        # Cells removed locally; a save may omit these and nothing else.
        self.deleted = set()
        self.fingerprint = hashlib.sha256(self.filename.read_bytes()).hexdigest()
        # One reactive cycle at a time: the initial run and user runs share the
        # websocket and must not read frames concurrently.
        self._cycle_lock = asyncio.Lock()

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
        self.registered = set(ids)
        self.layout = ready.get("layout")

    async def instantiate(self):
        """Run every cell once, streaming events as they happen.

        Streamed rather than collected: a notebook whose top-level code calls
        ``input()`` must be able to show its prompt and receive an answer while
        this first cycle is still open.
        """
        if self.closed:
            raise RuntimeError("Session stopped before the first run")
        async with self._cycle_lock:
            await asyncio.to_thread(self._request, "/api/kernel/instantiate", {"objectIds": [], "values": [], "autoRun": True})
            await self._collect_run(publish=True)

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
        if all_cells:
            # A cell may only vanish from the file after an explicit delete; a
            # view that merely loses a cell must never truncate the notebook.
            missing = known - set(ids) - self.deleted
            if missing:
                raise ValueError("Saving requires every cell that was not deleted")

    def create(self, code=""):
        """Claim a local cell id for a new cell.

        No service call: an empty cell has nothing to run, and marimo registers
        an unseen id by itself the first time that cell is run or saved.
        """
        if self.closed:
            raise RuntimeError("Session stopped; reconnect before adding a cell")
        if not isinstance(code, str):
            raise ValueError("A cell requires text code")
        existing = {cell["id"] for cell in self.cells}
        cell_id = "native-" + secrets.token_hex(6)
        while cell_id in existing:
            cell_id = "native-" + secrets.token_hex(6)
        self.cells.append({"id": cell_id, "code": code, "name": "_", "config": dict(DEFAULT_CONFIG)})
        self.deleted.discard(cell_id)
        return cell_id

    async def delete(self, cell_id):
        """Drop a cell; a live cell is removed from the kernel as well."""
        if self.closed:
            raise RuntimeError("Session stopped; reconnect before deleting a cell")
        if not isinstance(cell_id, str) or not cell_id:
            raise ValueError("A cell id is required")
        if cell_id not in {cell["id"] for cell in self.cells}:
            return
        if cell_id in self.registered:
            try:
                # Deleting a live cell triggers a reactive cycle: consume it here
                # so the next run cannot read frames that belong to this one.
                async with self._cycle_lock:
                    await asyncio.to_thread(self._request, "/api/kernel/delete", {"cellId": cell_id})
                    await self._collect_run()
            except BaseException:
                await self.close()
                raise
            self.registered.discard(cell_id)
        self.cells = [cell for cell in self.cells if cell["id"] != cell_id]
        self.deleted.add(cell_id)

    async def run(self, cells):
        if self.closed:
            raise RuntimeError("Session stopped; reconnect before running")
        self._validate_cells(cells)
        try:
            # Queue behind the initial cycle instead of reading the same socket.
            async with self._cycle_lock:
                if self.closed:
                    raise RuntimeError("Session stopped; reconnect before running")
                await asyncio.to_thread(self._request, "/api/kernel/run", {"cellIds": [cell["id"] for cell in cells], "codes": [cell["code"] for cell in cells]})
                events = await self._collect_run()
                self.registered.update(cell["id"] for cell in cells)
                return events
        except BaseException:
            # A partial cycle cannot safely be reused: never consume its late events as another run.
            await self.close()
            raise

    async def interrupt(self):
        """Cancel the current run without dropping the session."""
        if self.closed:
            raise RuntimeError("Session stopped; reconnect before interrupting")
        await asyncio.to_thread(self._request, "/api/kernel/interrupt", {})

    async def stdin(self, text):
        """Answer a pending `input()`; the value is only ever plain text."""
        if self.closed:
            raise RuntimeError("Session stopped; reconnect before answering input")
        if not isinstance(text, str):
            raise ValueError("stdin requires text")
        await asyncio.to_thread(self._request, "/api/kernel/stdin", {"text": text})

    def open_in_browser(self):
        """Open the native marimo editor for this same notebook.

        The URL embeds the session access token, so the token is handed to the
        browser directly and never travels back over stdout. Used as the escape
        hatch for features this frontend does not reimplement (chat panel,
        package management, settings, AI copilot).
        """
        if not self.base_url:
            raise RuntimeError("marimo is not running")
        url = self.base_url + "/?access_token=" + urllib.parse.quote(self.token)
        return bool(webbrowser.open(url, new=2))

    async def set_ui_element(self, object_id, value):
        """Push a `mo.ui` element's new value and consume the cycle it triggers.

        The endpoint only acknowledges the request; the recomputation arrives as
        a reactive cycle, so the caller must wait for `completed-run` just like a
        run. Values are validated before any HTTP call so a bad payload cannot
        kill a live session.
        """
        if self.closed:
            raise RuntimeError("Session stopped; reconnect before using widgets")
        if not isinstance(object_id, str) or not object_id.strip():
            raise ValueError("A widget object id is required")
        try:
            json.dumps(value)
        except (TypeError, ValueError) as error:
            raise ValueError("A widget value must be JSON-serializable") from error
        try:
            async with self._cycle_lock:
                if self.closed:
                    raise RuntimeError("Session stopped; reconnect before using widgets")
                await asyncio.to_thread(
                    self._request,
                    "/api/kernel/set_ui_element_value",
                    {"objectIds": [object_id], "values": [value]},
                )
                return await self._collect_run()
        except BaseException:
            # A half-consumed cycle cannot be reused by the next request.
            await self.close()
            raise

    def _config_cell(self, cell_id):
        if not isinstance(cell_id, str) or not cell_id:
            raise ValueError("A cell id is required")
        cell = next((item for item in self.cells if item["id"] == cell_id), None)
        if cell is None:
            raise ValueError("Unknown cell")
        return cell

    async def set_cell_config(self, cell_id, updates):
        """Apply a partial config to one cell and consume the cycle it triggers.

        marimo always closes the resulting command with `completed-run`, even
        when nothing is stale, so the caller owns exactly one cycle afterwards.
        The local copy is only updated once the kernel has accepted the change;
        `save()` takes its configs from that copy, which is how `hide_code`,
        `disabled` and `column` end up in the file.
        """
        if self.closed:
            raise RuntimeError("Session stopped; reconnect before changing a cell")
        cell = self._config_cell(cell_id)
        if not isinstance(updates, dict) or not updates:
            raise ValueError("A cell config update is required")
        if set(updates) - CELL_CONFIG_KEYS:
            raise ValueError("Unsupported cell config")
        merged = dict(cell["config"])
        for key, value in updates.items():
            if key == "column":
                # `bool` is an `int` in Python; a column of `True` must not pass.
                if value is not None and (isinstance(value, bool) or not isinstance(value, int)):
                    raise ValueError("A column must be an integer or None")
            elif not isinstance(value, bool):
                raise ValueError("A cell config flag must be a boolean")
            merged[key] = value
        try:
            async with self._cycle_lock:
                if self.closed:
                    raise RuntimeError("Session stopped; reconnect before changing a cell")
                await asyncio.to_thread(
                    self._request,
                    "/api/kernel/set_cell_config",
                    {"configs": {cell_id: updates}},
                )
                events = await self._collect_run()
                cell["config"] = merged
                return events
        except BaseException:
            await self.close()
            raise

    async def format_cells(self, codes, line_length=88):
        """Format code with the server's formatter (ruff).

        Pure server call: no reactive cycle, no kernel state change. The answer
        is compiled per cell so a broken formatter can never replace working code.
        """
        if self.closed:
            raise RuntimeError("Session stopped; reconnect before formatting")
        known = {cell["id"] for cell in self.cells}
        if not isinstance(codes, dict) or not codes:
            raise ValueError("Formatting requires at least one cell")
        if not set(codes) <= known:
            raise ValueError("Unknown cell")
        if any(not isinstance(code, str) for code in codes.values()):
            raise ValueError("Cell code must be text")
        if isinstance(line_length, bool) or not isinstance(line_length, int) or not 20 <= line_length <= 200:
            raise ValueError("Line length must be between 20 and 200")
        body = await asyncio.to_thread(
            self._request,
            "/api/kernel/format",
            {"codes": codes, "lineLength": line_length},
        )
        payload = json.loads(body) if body else {}
        formatted = payload.get("codes") if isinstance(payload, dict) else None
        if not isinstance(formatted, dict) or set(formatted) - set(codes):
            raise RuntimeError("Invalid formatter response")
        for code in formatted.values():
            if not isinstance(code, str):
                raise RuntimeError("Invalid formatter response")
            try:
                compile(code, "<cell>", "exec")
            except SyntaxError as error:
                raise RuntimeError("Formatter returned invalid Python") from error
        return formatted

    async def complete(self, cell_id, document, timeout=6.0):
        """Ask the kernel's language server for completions at the cursor.

        The HTTP call only acknowledges; the options arrive on the websocket as
        `completion-result` tagged with our request id. Any other event seen while
        waiting is published normally so an unprompted cycle is never swallowed.
        A missing answer is not fatal: an empty list keeps the editor usable.
        """
        if self.closed:
            raise RuntimeError("Session stopped; reconnect before completing")
        self._config_cell(cell_id)
        if not isinstance(document, str):
            raise ValueError("Completion requires the document text")
        request_id = "native-" + secrets.token_hex(4)
        async with self._cycle_lock:
            if self.closed:
                raise RuntimeError("Session stopped; reconnect before completing")
            await asyncio.to_thread(
                self._request,
                "/api/kernel/code_autocomplete",
                {"id": request_id, "document": document, "cellId": cell_id},
            )
            while True:
                try:
                    event = await asyncio.wait_for(self._next_event(), timeout)
                except (asyncio.TimeoutError, TimeoutError):
                    return {"prefixLength": 0, "options": []}
                if event.get("op") == "completion-result" and event.get("completion_id") == request_id:
                    options = []
                    for option in event.get("options") or []:
                        if not isinstance(option, dict) or not isinstance(option.get("name"), str):
                            continue
                        options.append(
                            {
                                "name": option["name"],
                                "type": option.get("type") if isinstance(option.get("type"), str) else "",
                                "info": option.get("completion_info") if isinstance(option.get("completion_info"), str) else "",
                            }
                        )
                        if len(options) >= COMPLETION_LIMIT:
                            break
                    prefix = event.get("prefix_length")
                    return {"prefixLength": prefix if isinstance(prefix, int) else 0, "options": options}
                self.on_event(event)

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

    def redact(error):
        message = str(error).replace(session.token, "[redacted]")
        if session.server_token:
            message = message.replace(session.server_token, "[redacted]")
        return message

    pending = set()
    stop_reading = False

    async def handle_run(request, request_id):
        # Runs happen off the reader loop: `interrupt` and `stdin` must stay
        # answerable while a cell is executing.
        try:
            method = request["method"]
            if method == "run":
                await session.run(request["cells"])
            elif method == "save":
                await session.save(request["cells"])
            elif method == "ui":
                await session.set_ui_element(request.get("objectId"), request.get("value"))
            elif method == "config":
                await session.set_cell_config(request.get("cellId"), request.get("config"))
            elif method == "format":
                codes = await session.format_cells(request.get("codes") or {}, request.get("lineLength", 88))
                emit({"type": "result", "id": request_id, "codes": codes})
                return
            elif method == "complete":
                answer = await session.complete(request.get("cellId"), request.get("document", ""))
                emit({"type": "result", "id": request_id, "prefixLength": answer["prefixLength"], "options": answer["options"]})
                return
            else:
                await session.delete(request.get("cellId"))
            emit({"type": "result", "id": request_id})
        except Exception as error:
            emit({"type": "result", "id": request_id, "error": redact(error)})
            if session.closed:
                emit({"type": "error", "error": "Session stopped after an incomplete operation; reconnect"})

    try:
        await session.start()
        emit({"type": "ready", "cells": session.cells})

        async def handle_initial():
            # Streams the first cycle so `input()` prompts can be answered while
            # the notebook is still starting up.
            try:
                await session.instantiate()
            except Exception as error:
                emit({"type": "error", "error": redact(error)})

        initial = asyncio.create_task(handle_initial())
        pending.add(initial)
        initial.add_done_callback(pending.discard)
        while not stop_reading:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            request_id = ""
            try:
                request = json.loads(line)
                request_id = str(request["id"])
                method = request["method"]
                if method in ("run", "save", "delete", "ui", "config", "format", "complete"):
                    running = asyncio.create_task(handle_run(request, request_id))
                    pending.add(running)
                    running.add_done_callback(pending.discard)
                elif method == "create":
                    # Purely local: the id is handed to the view, which decides
                    # where the cell sits in the file order.
                    emit({"type": "result", "id": request_id, "cellId": session.create(request.get("code", ""))})
                elif method == "interrupt":
                    await session.interrupt()
                    emit({"type": "result", "id": request_id})
                elif method == "open":
                    # Only a boolean leaves the adapter: the token in the URL
                    # stays inside the Python process and the browser.
                    opened = await asyncio.to_thread(session.open_in_browser)
                    emit({"type": "result", "id": request_id, "opened": opened})
                elif method == "stdin":
                    await session.stdin(request.get("value"))
                    emit({"type": "result", "id": request_id})
                else:
                    raise ValueError("Unsupported operation")
            except Exception as error:
                emit({"type": "result", "id": request_id, "error": redact(error)})
                if session.closed:
                    emit({"type": "error", "error": "Session stopped after an incomplete operation; reconnect"})
                    stop_reading = True
    except asyncio.CancelledError:
        pass
    except Exception as error:
        emit({"type": "error", "error": redact(error)})
    finally:
        for running in list(pending):
            running.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        await session.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--notebook", required=True)
    arguments = parser.parse_args()
    asyncio.run(serve(arguments.notebook))
