"""Acceptance tests use a real pinned marimo service and disposable files."""
import importlib.util
import tempfile
import re
import html
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = """import marimo
__generated_with = "0.25.2"
app = marimo.App()

@app.cell
def _():
    x = 2
    return (x,)

@app.cell
def _(x):
    result = x * 3
    result
    return (result,)

if __name__ == "__main__":
    app.run()
"""


class NativeBackendTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.assertTrue((ROOT / "python/backend.py").exists(), "Native backend adapter is not implemented")
        spec = importlib.util.spec_from_file_location("native_backend", ROOT / "python/backend.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.folder = tempfile.TemporaryDirectory(prefix="marimo-native-test-")
        self.path = Path(self.folder.name) / "reactivity.py"
        self.path.write_text(FIXTURE)
        self.session = module.NativeSession(self.path)

    async def asyncTearDown(self):
        if hasattr(self, "session"):
            await self.session.close()
        if hasattr(self, "folder"):
            self.folder.cleanup()

    @staticmethod
    def output_text(events, cell_id):
        values = [event["output"]["data"] for event in events if event.get("cell_id") == cell_id and event.get("output") and event["output"].get("channel") == "output"]
        return html.unescape(re.sub(r"<[^>]*>", "", values[-1])).strip() if values else None

    async def test_reactivity_and_official_save(self):
        await self.session.start()
        cells = self.session.cells
        self.assertEqual(len(cells), 2)
        result = await self.session.run(cells)
        self.assertEqual(self.output_text(result, cells[1]["id"]), "6")
        changed = [{**cell, "code": "x = 4"} if "x = 2" in cell["code"] else dict(cell) for cell in cells]
        # Only the modified upstream cell is submitted. marimo must run its dependent cell.
        result = await self.session.run([changed[0]])
        self.assertEqual(self.output_text(result, cells[1]["id"]), "12")
        await self.session.save(changed)
        saved = self.path.read_text()
        self.assertIn("x = 4", saved)
        import runpy
        loaded = runpy.run_path(str(self.path))["app"]
        _, definitions = loaded.run()
        self.assertEqual(definitions["result"], 12)

    async def test_kernel_error_is_returned_and_service_closes(self):
        await self.session.start()
        result = await self.session.run([{**self.session.cells[0], "code": "raise ValueError('native-probe-error')"}])
        self.assertIn("native-probe-error", str(result))
        process = self.session.process
        await self.session.close()
        self.assertIsNotNone(process.returncode)

    async def test_stdio_starts_with_ready_and_shuts_down_on_eof(self):
        import asyncio
        import json
        import sys
        process = await asyncio.create_subprocess_exec(sys.executable, str(ROOT/'python/backend.py'), '--notebook', str(self.path), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            first = json.loads(await asyncio.wait_for(process.stdout.readline(), 15))
            self.assertEqual(first['type'], 'ready')
            while True:
                frame = json.loads(await asyncio.wait_for(process.stdout.readline(), 15))
                if frame.get('data', {}).get('op') == 'completed-run':
                    break
            process.stdin.close()
            await asyncio.wait_for(process.wait(), 15)
            self.assertEqual(process.returncode, 0)
        finally:
            if process.returncode is None:
                process.terminate()
                await process.wait()

    async def test_input_prompt_is_answerable_while_starting(self):
        """A notebook whose first cycle calls input() must not deadlock."""
        import asyncio
        import json
        import sys
        self.path.write_text('''import marimo as mo
__generated_with = "0.25.2"
app = mo.App()

@app.cell
def _():
    name = input("Name? ")
    return (name,)

@app.cell
def _(name):
    mo.md(f"Hello **{name}**")
    return

if __name__ == "__main__":
    app.run()
''')
        process = await asyncio.create_subprocess_exec(sys.executable, str(ROOT/'python/backend.py'), '--notebook', str(self.path), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            ready = json.loads(await asyncio.wait_for(process.stdout.readline(), 15))
            self.assertEqual(ready['type'], 'ready')
            # Wait for the prompt to arrive while the first cycle is still open.
            prompt_seen = False
            for _ in range(200):
                frame = json.loads(await asyncio.wait_for(process.stdout.readline(), 20))
                console = (frame.get('data') or {}).get('console') or []
                outputs = console if isinstance(console, list) else [console]
                if any(item.get('channel') == 'stdin' for item in outputs if isinstance(item, dict)):
                    prompt_seen = True
                    break
            self.assertTrue(prompt_seen, 'no stdin prompt was published')
            process.stdin.write((json.dumps({'id': '2', 'method': 'stdin', 'value': 'Kains'})+'\n').encode())
            await process.stdin.drain()
            transcript = ''
            for _ in range(400):
                frame = json.loads(await asyncio.wait_for(process.stdout.readline(), 20))
                if frame.get('type') == 'result':
                    self.assertEqual(frame['id'], '2')
                    self.assertIsNone(frame.get('error'))
                transcript += json.dumps(frame, ensure_ascii=False)
                if (frame.get('data') or {}).get('op') == 'completed-run':
                    break
            self.assertIn('Kains', transcript)
        finally:
            if process.returncode is None:
                process.stdin.close()
                try:
                    await asyncio.wait_for(process.wait(), 15)
                except asyncio.TimeoutError:
                    process.terminate()
                    await process.wait()

    async def test_interrupt_ends_a_long_run_without_dropping_the_session(self):
        import asyncio
        import json
        import sys
        import time
        self.path.write_text('''import marimo
__generated_with = "0.25.2"
app = marimo.App()

@app.cell
def _():
    x = 1
    return (x,)

if __name__ == "__main__":
    app.run()
''')
        process = await asyncio.create_subprocess_exec(sys.executable, str(ROOT/'python/backend.py'), '--notebook', str(self.path), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            ready = json.loads(await asyncio.wait_for(process.stdout.readline(), 15))
            self.assertEqual(ready['type'], 'ready')
            cell_id = ready['cells'][0]['id']
            while True:
                frame = json.loads(await asyncio.wait_for(process.stdout.readline(), 20))
                if (frame.get('data') or {}).get('op') == 'completed-run':
                    break
            started = time.monotonic()
            request = {'id': '10', 'method': 'run', 'cells': [{'id': cell_id, 'code': 'import time\ntime.sleep(30)'}]}
            process.stdin.write((json.dumps(request)+'\n').encode())
            await process.stdin.drain()
            await asyncio.sleep(1.2)
            process.stdin.write((json.dumps({'id': '11', 'method': 'interrupt'})+'\n').encode())
            await process.stdin.drain()
            results = {}
            interrupted = False
            cycle_ended = False
            for _ in range(300):
                frame = json.loads(await asyncio.wait_for(process.stdout.readline(), 20))
                if frame.get('type') == 'result':
                    results[frame['id']] = frame.get('error')
                data = frame.get('data') or {}
                # marimo publishes a dedicated `interrupted` event; the cycle's
                # completed-run still reports `succeeded`. The run's own result
                # frame may follow that event, so the loop watches both.
                if data.get('op') == 'interrupted':
                    interrupted = True
                if data.get('op') == 'completed-run':
                    cycle_ended = True
                if cycle_ended and interrupted and '10' in results and '11' in results:
                    break
            self.assertTrue(interrupted, 'no interrupted event was published')
            self.assertIn('11', results, results)
            self.assertIsNone(results['11'], results)
            self.assertIn('10', results, results)
            self.assertIsNone(results['10'], results)
            self.assertLess(time.monotonic()-started, 20)
            # The session survives an interrupt: another run still works.
            process.stdin.write((json.dumps({'id': '12', 'method': 'run', 'cells': [{'id': cell_id, 'code': 'y = 2'}]})+'\n').encode())
            await process.stdin.drain()
            while True:
                frame = json.loads(await asyncio.wait_for(process.stdout.readline(), 20))
                if frame.get('type') == 'result' and frame['id'] == '12':
                    self.assertIsNone(frame.get('error'))
                    break
        finally:
            if process.returncode is None:
                process.stdin.close()
                try:
                    await asyncio.wait_for(process.wait(), 15)
                except asyncio.TimeoutError:
                    process.terminate()
                    await process.wait()

    async def test_missing_file_returns_structured_error(self):
        import asyncio
        import json
        import sys
        process = await asyncio.create_subprocess_exec(sys.executable, str(ROOT/'python/backend.py'), '--notebook', str(self.path.parent/'missing.py'), stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, _ = await asyncio.wait_for(process.communicate(), 10)
        frame = json.loads(stdout.decode().splitlines()[0])
        self.assertEqual(frame['type'], 'error')
        self.assertIn('Could not open notebook', frame['error'])
