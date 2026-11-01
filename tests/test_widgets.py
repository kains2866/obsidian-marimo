"""Widget write-back against a real pinned kernel.

`mo.ui.*` elements are useless without a way to push their new value into the
kernel; these tests hold the adapter to marimo's own `set_ui_element_value`
contract (a reactive cycle that ends in `completed-run`).
"""
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
    import marimo as mo
    return (mo,)


@app.cell
def _(mo):
    slider = mo.ui.slider(0, 10, value=3, label="Level")
    slider
    return (slider,)


@app.cell
def _(slider):
    doubled = slider.value * 2
    doubled
    return (doubled,)


@app.cell
def _(mo):
    lonely = mo.ui.text(value="a", label="Lonely")
    lonely
    return (lonely,)


if __name__ == "__main__":
    app.run()
'''


def plain(events, cell_id):
    values = [
        event["output"]["data"]
        for event in events
        if event.get("cell_id") == cell_id
        and isinstance(event.get("output"), dict)
        and event["output"].get("mimetype") == "text/html"
    ]
    return re.sub(r"<[^>]*>", "", values[-1]).strip() if values else None


def object_id(events, needle=""):
    for event in events:
        output = event.get("output")
        if not isinstance(output, dict) or not isinstance(output.get("data"), str):
            continue
        if "marimo-ui-element" not in output["data"] or needle not in output["data"]:
            continue
        match = re.search(r"object-id='([^']+)'", output["data"])
        if match:
            return match.group(1)
    raise AssertionError("no widget in the fixture output")


class WidgetWriteBackTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        spec = importlib.util.spec_from_file_location("native_backend", ROOT / "python/backend.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.folder = tempfile.TemporaryDirectory(prefix="marimo-native-widget-")
        self.path = Path(self.folder.name) / "widgets.py"
        self.path.write_text(FIXTURE)
        self.events = []
        self.session = module.NativeSession(self.path, self.events.append)
        await self.session.start()
        await self.session.instantiate()

    async def asyncTearDown(self):
        if hasattr(self, "session"):
            await self.session.close()
        if hasattr(self, "folder"):
            self.folder.cleanup()

    async def test_value_change_recomputes_descendants(self):
        slider = object_id(self._initial_events(), "marimo-slider")
        doubled_cell = next(cell["id"] for cell in self.session.cells if "doubled" in cell["code"])
        self.assertEqual(plain(self._initial_events(), doubled_cell), "6")
        events = await self.session.set_ui_element(slider, 7)
        self.assertEqual(plain(events, doubled_cell), "14")
        self.assertEqual(events[-1]["op"], "completed-run")

    async def test_a_widget_without_dependents_still_finishes_its_cycle(self):
        lonely = object_id(self._initial_events(), "marimo-text")
        events = await self.session.set_ui_element(lonely, "b")
        self.assertEqual(events[-1]["op"], "completed-run")

    async def test_rejects_a_missing_id_and_a_value_that_is_not_json(self):
        with self.assertRaises(ValueError):
            await self.session.set_ui_element("", 1)
        with self.assertRaises(ValueError):
            await self.session.set_ui_element("MJUe-0", object())
        # A rejected call must leave the session usable.
        slider = object_id(self._initial_events(), "marimo-slider")
        events = await self.session.set_ui_element(slider, 2)
        self.assertEqual(events[-1]["op"], "completed-run")

    async def test_closed_session_refuses_writes(self):
        await self.session.close()
        with self.assertRaises(RuntimeError):
            await self.session.set_ui_element("MJUe-0", 1)

    def _initial_events(self):
        return self.events
