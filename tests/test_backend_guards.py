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

    # ---------------------------------------------------- cell structure

    async def test_create_allocates_a_fresh_cell_without_running_anything(self):
        with patch.object(self.session, '_request', return_value='{}') as request:
            first = self.session.create('y = 3')
            second = self.session.create('')
        # Creating a cell only claims an id: nothing runs until the user asks.
        request.assert_not_called()
        self.assertNotEqual(first, second)
        self.assertNotIn(first, {'a'})
        self.assertEqual([cell['id'] for cell in self.session.cells], ['a', first, second])
        self.assertEqual(self.session.cells[1]['code'], 'y = 3')
        # A brand new cell has no kernel presence until it is run.
        self.assertNotIn(first, self.session.registered)

    async def test_create_rejects_non_text_code(self):
        for value in (None, 42, {'code': 'x'}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.session.create(value)

    async def test_delete_of_an_unregistered_cell_never_touches_the_kernel(self):
        # An id the kernel never saw cannot produce a reactive cycle; asking the
        # service to delete it and waiting for `completed-run` would hang.
        cell = self.session.create('y = 3')
        with patch.object(self.session, '_request', return_value='{}') as request, \
                patch.object(self.session, '_collect_run', new_callable=AsyncMock) as collect:
            await self.session.delete(cell)
        request.assert_not_called()
        collect.assert_not_awaited()
        self.assertEqual([item['id'] for item in self.session.cells], ['a'])

    async def test_delete_of_a_registered_cell_calls_the_endpoint_and_waits_for_the_cycle(self):
        self.session.cells = [
            {'id': 'a', 'code': 'x=2', 'name': '_', 'config': {}},
            {'id': 'b', 'code': 'y=3', 'name': '_', 'config': {}},
        ]
        self.session.registered = {'a', 'b'}
        with patch.object(self.session, '_request', return_value='{}') as request, \
                patch.object(self.session, '_collect_run', new_callable=AsyncMock) as collect:
            await self.session.delete('a')
        self.assertEqual(request.call_args.args[0], '/api/kernel/delete')
        self.assertEqual(request.call_args.args[1], {'cellId': 'a'})
        collect.assert_awaited_once()
        self.assertEqual([cell['id'] for cell in self.session.cells], ['b'])
        self.assertNotIn('a', self.session.registered)

    async def test_delete_of_an_unknown_cell_is_ignored(self):
        with patch.object(self.session, '_request', return_value='{}') as request:
            await self.session.delete('not-here')
        request.assert_not_called()

    async def test_save_keeps_created_cells_in_the_requested_order(self):
        created = self.session.create('y = 3')
        with patch.object(self.session, '_request', return_value='rendered\n') as request:
            await self.session.save([{'id': created, 'code': 'y = 3'}, {'id': 'a', 'code': 'x=2'}])
        payload = request.call_args.args[1]
        self.assertEqual(payload['cellIds'], [created, 'a'])
        # Codegen derives references from the code, so `_` is the correct name.
        self.assertEqual(payload['names'], ['_', '_'])
        self.assertEqual(payload['configs'][0], BACKEND.DEFAULT_CONFIG)

    async def test_save_refuses_to_silently_drop_a_cell_that_was_not_deleted(self):
        self.session.cells = [
            {'id': 'a', 'code': 'x=2', 'name': '_', 'config': {}},
            {'id': 'b', 'code': 'y=3', 'name': '_', 'config': {}},
        ]
        with patch.object(self.session, '_request', return_value='rendered\n'):
            with self.assertRaisesRegex(ValueError, 'not deleted'):
                await self.session.save([{'id': 'a', 'code': 'x=2'}])
            # The same save is legitimate once the cell was explicitly removed.
            await self.session.delete('b')
            await self.session.save([{'id': 'a', 'code': 'x=2'}])
        self.assertEqual(self.file.read_text(), 'rendered\n')
