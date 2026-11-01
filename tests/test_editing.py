"""Cell configuration, formatting and completion against a real pinned kernel.

These three actions share one property: the adapter must never guess. Config
updates are cycles (`completed-run`), formatting is a server call that must not
return broken Python, and completion answers arrive on the websocket rather than
in the HTTP response.
"""
import asyncio
import importlib.util
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FIXTURE = '''import marimo
__generated_with = "0.25.2"
app = marimo.App()


@app.cell
def _():
    base = 1
    base
    return (base,)


@app.cell
def _(base):
    mid = base + 1
    mid
    return (mid,)


@app.cell
def _(mid):
    tail = mid * 2
    tail
    return (tail,)


if __name__ == "__main__":
    app.run()
'''


def texts(events, cell_id):
    return [
        event["output"]["data"]
        for event in events
        if event.get("cell_id") == cell_id
        and isinstance(event.get("output"), dict)
        and event["output"].get("mimetype") in ("text/plain", "text/html")
    ]


def plain(events, cell_id):
    """marimo wraps scalars in `<pre>`; compare the visible text."""
    values = texts(events, cell_id)
    return re.sub(r"<[^>]*>", "", values[-1]).strip() if values else None


class EditingTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        spec = importlib.util.spec_from_file_location("native_backend_edit", ROOT / "python/backend.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.module = module
        self.folder = tempfile.TemporaryDirectory(prefix="marimo-native-edit-")
        self.path = Path(self.folder.name) / "editing.py"
        self.path.write_text(FIXTURE)
        self.events = []
        self.session = module.NativeSession(self.path, self.events.append)
        await self.session.start()
        await self.session.instantiate()
        self.ids = [cell["id"] for cell in self.session.cells]

    async def asyncTearDown(self):
        if hasattr(self, "session"):
            await self.session.close()
        if hasattr(self, "folder"):
            self.folder.cleanup()

    # ------------------------------------------------------------- config

    async def test_hiding_code_is_a_cycle_and_survives_a_save(self):
        events = await self.session.set_cell_config(self.ids[0], {"hide_code": True})
        self.assertEqual(events[-1]["op"], "completed-run")
        self.assertTrue(self.session.cells[0]["config"]["hide_code"])
        # The other cells keep their defaults.
        self.assertFalse(self.session.cells[1]["config"]["hide_code"])

        cells = [{"id": cell["id"], "code": cell["code"]} for cell in self.session.cells]
        await self.session.save(cells)
        self.assertIn("hide_code=True", self.path.read_text())

    async def test_disabling_a_cell_disables_its_descendants(self):
        events = await self.session.set_cell_config(self.ids[1], {"disabled": True})
        self.assertEqual(events[-1]["op"], "completed-run")
        disabled = {
            event["cell_id"]
            for event in events
            if event.get("op") == "cell-op" and event.get("status") == "disabled-transitively"
        }
        self.assertIn(self.ids[2], disabled)

        # Re-enabling clears the transitive state; the descendant keeps its last
        # value, so marimo does not re-run it (only a stale input would).
        events = await self.session.set_cell_config(self.ids[1], {"disabled": False})
        self.assertEqual(events[-1]["op"], "completed-run")
        statuses = {
            event["cell_id"]: event.get("status")
            for event in events
            if event.get("op") == "cell-op"
        }
        self.assertEqual(statuses.get(self.ids[2]), "idle")
        # The notebook still executes after the round trip.
        events = await self.session.run([{"id": cell["id"], "code": cell["code"]} for cell in self.session.cells])
        self.assertEqual(plain(events, self.ids[2]), "4")

    async def test_an_unregistered_cell_accepts_config_but_stays_local(self):
        new_id = self.session.create("pending = 5")
        events = await self.session.set_cell_config(new_id, {"hide_code": True})
        self.assertEqual(events[-1]["op"], "completed-run")
        self.assertTrue(next(cell for cell in self.session.cells if cell["id"] == new_id)["config"]["hide_code"])

    async def test_a_bad_config_is_rejected_before_it_reaches_the_kernel(self):
        with self.assertRaises(ValueError):
            await self.session.set_cell_config("", {"disabled": True})
        with self.assertRaises(ValueError):
            await self.session.set_cell_config("does-not-exist", {"disabled": True})
        with self.assertRaises(ValueError):
            await self.session.set_cell_config(self.ids[0], {"colour": "red"})
        with self.assertRaises(ValueError):
            await self.session.set_cell_config(self.ids[0], {"disabled": "yes"})
        with self.assertRaises(ValueError):
            await self.session.set_cell_config(self.ids[0], {})
        with self.assertRaises(ValueError):
            # `bool` is an `int` in Python; a column of `True` must not pass.
            await self.session.set_cell_config(self.ids[0], {"column": True})
        # A rejected update must leave the session usable and unchanged.
        self.assertFalse(self.session.cells[0]["config"]["disabled"])
        events = await self.session.set_cell_config(self.ids[0], {"expand_output": True})
        self.assertEqual(events[-1]["op"], "completed-run")

    # ------------------------------------------------------------- format

    async def test_format_returns_rewritten_code(self):
        codes = await self.session.format_cells({self.ids[0]: "base    =    1\n"})
        self.assertEqual(codes, {self.ids[0]: "base = 1"})

    async def test_format_rejects_unknown_cells_and_bad_limits(self):
        with self.assertRaises(ValueError):
            await self.session.format_cells({})
        with self.assertRaises(ValueError):
            await self.session.format_cells({"nope": "x = 1\n"})
        with self.assertRaises(ValueError):
            await self.session.format_cells({self.ids[0]: "x = 1\n"}, line_length=5)

    # --------------------------------------------------------- completion

    async def test_completion_answers_on_the_socket(self):
        result = await self.session.complete(self.ids[0], "import ma")
        names = [option["name"] for option in result["options"]]
        self.assertIn("marimo", names)
        self.assertGreaterEqual(result["prefixLength"], 2)

    async def test_completion_rejects_an_unknown_cell(self):
        with self.assertRaises(ValueError):
            await self.session.complete("does-not-exist", "import ma")

    # ------------------------------------------------------------- closed

    async def test_a_closed_session_refuses_editing(self):
        await self.session.close()
        with self.assertRaises(RuntimeError):
            await self.session.set_cell_config(self.ids[0], {"disabled": True})
        with self.assertRaises(RuntimeError):
            await self.session.format_cells({self.ids[0]: "x = 1\n"})
        with self.assertRaises(RuntimeError):
            await self.session.complete(self.ids[0], "import ma")


class ConfigValidationTest(unittest.TestCase):
    """Validation that must not need a kernel at all."""

    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("native_backend_rules", ROOT / "python/backend.py")
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def session(self):
        folder = tempfile.TemporaryDirectory(prefix="marimo-native-rules-")
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "rules.py"
        path.write_text(FIXTURE)
        session = self.module.NativeSession(path)
        session.cells = [{"id": "a", "code": "x = 1", "name": "_", "config": dict(self.module.DEFAULT_CONFIG)}]
        return session

    def test_a_closed_session_is_checked_before_anything_else(self):
        session = self.session()
        session.closed = True
        with self.assertRaises(RuntimeError):
            asyncio.run(session.set_cell_config("a", {"disabled": True}))


if __name__ == "__main__":
    unittest.main()
