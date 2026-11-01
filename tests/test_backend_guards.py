import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

SPEC = importlib.util.spec_from_file_location('native_backend', Path(__file__).resolve().parents[1] / 'python/backend.py')
BACKEND = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKEND)


class GuardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.file = Path(self.directory.name) / 'notebook.py'
        self.file.write_text('original')
        self.session = BACKEND.NativeSession(self.file)
        self.session.cells = [{'id':'a', 'code':'x=2', 'name':'_', 'config':{}}]

    def test_invalid_cells_are_rejected(self):
        for cells in [[{'id':'unknown','code':'1'}], [{'id':'a','code':'1'},{'id':'a','code':'2'}], [{'id':'a','code':None}]]:
            with self.subTest(cells=cells), self.assertRaises(ValueError):
                self.session._validate_cells(cells)
        with self.assertRaises(ValueError):
            self.session._validate_cells([], all_cells=True)

    async def test_external_change_is_not_overwritten(self):
        self.file.write_text('external edit')
        with self.assertRaisesRegex(RuntimeError,'changed outside'):
            await self.session.save(self.session.cells)
        self.assertEqual(self.file.read_text(),'external edit')

    async def test_unsupported_version_never_spawns(self):
        with patch.object(BACKEND.importlib.metadata,'version',return_value='999.0'), patch.object(BACKEND.asyncio,'create_subprocess_exec',new_callable=AsyncMock) as spawn:
            with self.assertRaisesRegex(RuntimeError,'requires marimo'):
                await self.session.start()
            spawn.assert_not_called()

    async def test_interrupt_targets_the_kernel_endpoint(self):
        with patch.object(self.session, '_request', return_value='{}') as request:
            await self.session.interrupt()
        self.assertEqual(request.call_args.args[0], '/api/kernel/interrupt')

    async def test_stdin_forwards_text_to_the_stdin_endpoint(self):
        with patch.object(self.session, '_request', return_value='{}') as request:
            await self.session.stdin('Kains')
        self.assertEqual(request.call_args.args[0], '/api/kernel/stdin')
        self.assertEqual(request.call_args.args[1], {'text': 'Kains'})

    async def test_stdin_rejects_non_text_values(self):
        for value in (None, 42, {'text': 'x'}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                await self.session.stdin(value)

    async def test_stopped_session_refuses_interrupt_and_stdin(self):
        self.session.closed = True
        with self.assertRaises(RuntimeError):
            await self.session.interrupt()
        with self.assertRaises(RuntimeError):
            await self.session.stdin('x')

    async def test_close_cleans_process_even_when_websocket_close_fails(self):
        self.session.ws = AsyncMock()
        self.session.ws.close.side_effect = OSError('socket already broken')
        process = AsyncMock()
        process.returncode = None
        process.pid = 123456789
        self.session.process = process
        with patch.object(BACKEND.os,'killpg') as kill:
            await self.session.close()
            kill.assert_called_once()
            process.wait.assert_awaited()

    async def test_save_uses_render_only_then_atomic_replace(self):
        rendered = '# safely rendered\nx = 3\n'
        with patch.object(self.session, '_request', return_value=rendered) as request:
            await self.session.save(self.session.cells)
        self.assertFalse(request.call_args.args[1]['persist'])
        self.assertEqual(self.file.read_text(), rendered)

    async def test_atomic_save_failure_preserves_original(self):
        with patch.object(self.session, '_request', return_value='x=3\n'), patch.object(BACKEND.os, 'replace', side_effect=OSError('disk error')):
            with self.assertRaisesRegex(OSError, 'disk error'):
                await self.session.save(self.session.cells)
        self.assertEqual(self.file.read_text(), 'original')
        self.assertEqual(list(self.file.parent.glob('*.tmp')), [])

    async def test_timeout_closes_session_before_next_command(self):
        with patch.object(self.session, '_request', return_value='{}'), patch.object(self.session, '_collect_run', new_callable=AsyncMock, side_effect=TimeoutError), patch.object(self.session, 'close', new_callable=AsyncMock) as close:
            with self.assertRaises(TimeoutError):
                await self.session.run(self.session.cells)
            close.assert_awaited_once()
