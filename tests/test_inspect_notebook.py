"""静态预览测试：只做 ast/tokenize 分析，任何源码都不会被导入或执行。"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "python" / "inspect_notebook.py"

NOTEBOOK = '''import marimo

__generated_with = "0.25.2"
app = marimo.App(width="medium")


@app.cell
def _():
    # 统计基础数据
    values = [1, 2, 3]
    return (values,)


@app.cell(hide_code=True)
def _(values):
    report = f"""总计 {sum(values)}"""
    report
    return report, values


if __name__ == "__main__":
    app.run()
'''

PLAIN_SCRIPT = '''"""普通脚本，不是 marimo 笔记本。"""
import json


def add(a, b):
    return a + b


print(json.dumps(add(1, 2)))
'''


class InspectorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert SCRIPT.exists(), "python/inspect_notebook.py 尚未实现"
        spec = importlib.util.spec_from_file_location("inspect_notebook", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cls.inspect = staticmethod(module.analyze)

    def analyze(self, source):
        return self.inspect(source)

    def codes(self, source):
        result = self.analyze(source)
        self.assertNotIn("error", result, result)
        self.assertTrue(result["isMarimo"], result)
        return [cell["code"] for cell in result["cells"]]

    def assert_error(self, source, needle):
        result = self.analyze(source)
        self.assertIn("error", result)
        self.assertFalse(result["isMarimo"], result)
        self.assertEqual(result["cells"], [], result)
        self.assertIn(needle, result["error"])
        return result

    # --- 识别 -------------------------------------------------------------

    def test_plain_script_is_not_marimo(self):
        result = self.analyze(PLAIN_SCRIPT)
        self.assertFalse(result["isMarimo"])
        self.assertEqual(result["cells"], [])
        self.assertNotIn("error", result)

    def test_marimo_import_without_app_is_not_marimo(self):
        result = self.analyze('import marimo\n\nprint(marimo.__name__)\n')
        self.assertFalse(result["isMarimo"])
        self.assertEqual(result["cells"], [])
        self.assertNotIn("error", result)

    def test_alias_and_app_construction(self):
        result = self.analyze(NOTEBOOK)
        self.assertNotIn("error", result)
        self.assertTrue(result["isMarimo"])
        self.assertEqual([cell["id"] for cell in result["cells"]], ["preview-0", "preview-1"])
        self.assertEqual(
            [cell["code"] for cell in result["cells"]],
            ["# 统计基础数据\nvalues = [1, 2, 3]", 'report = f"""总计 {sum(values)}"""\nreport'],
        )
        self.assertEqual(sorted(result["cells"][0]), ["code", "id"])

    def test_from_marimo_import_app_and_async_cell(self):
        source = '''from marimo import App as MarimoApp

app = MarimoApp()


@app.cell
async def _(x):
    await x
    return
'''
        self.assertEqual(self.codes(source), ["await x"])

    def test_empty_notebook_has_no_cells(self):
        result = self.analyze('import marimo\n\napp = marimo.App()\n\nif __name__ == "__main__":\n    app.run()\n')
        self.assertNotIn("error", result)
        self.assertTrue(result["isMarimo"])
        self.assertEqual(result["cells"], [])

    def test_comment_only_generated_cell_is_preserved(self):
        source = 'import marimo\napp = marimo.App()\n\n@app.cell\ndef _():\n    # important explanation\n    # 第二行说明\n    return\n'
        self.assertEqual(self.codes(source), ['# important explanation\n# 第二行说明'])

    def test_compact_cell_reports_unsupported_instead_of_empty_preview(self):
        source = 'import marimo\napp = marimo.App()\n\n@app.cell\ndef _(): x = 1; return (x,)\n'
        result = self.analyze(source)
        self.assertIn('error', result)
        self.assertEqual(result['cells'], [])

    def test_nonstandard_top_level_business_code_requires_source_fallback(self):
        for source in [
            'import marimo\napp = marimo.App()\nthreshold = 10\n@app.cell\ndef _():\n    print(threshold)\n    return\n',
            'import marimo\napp = marimo.App()\nif __name__ == "__main__":\n    print("extra")\n    app.run()\n',
        ]:
            result = self.analyze(source)
            self.assertIn('error', result)
            self.assertEqual(result['cells'], [])

    # --- 代码还原 ---------------------------------------------------------

    def test_indentation_semantics_are_preserved(self):
        source = '''import marimo

app = marimo.App()


@app.cell
def _(items):
    total = 0
    for item in items:
        if item > 1:
            total += item
    return (total,)
'''
        self.assertEqual(
            self.codes(source),
            ["total = 0\nfor item in items:\n    if item > 1:\n        total += item"],
        )

    def test_comments_and_string_contents_are_preserved(self):
        source = '''import marimo

app = marimo.App()


@app.cell
def _():
    # 注释必须保留
    text = """
raw = "# 真的不是注释"
"""
    table = {"k": "# 不是注释"}  # 行尾注释
    return (table, text)
'''
        expected = (
            "# 注释必须保留\n"
            'text = """\n'
            'raw = "# 真的不是注释"\n'
            '"""\n'
            'table = {"k": "# 不是注释"}  # 行尾注释'
        )
        self.assertEqual(self.codes(source), [expected])

    def test_generated_trailing_return_is_removed(self):
        source = '''import marimo

app = marimo.App()


@app.cell
def _():
    print("副作用")

    return


@app.cell
def _(a):
    import os

    return (a,)


@app.cell
def _(a, b):
    return a, b
'''
        self.assertEqual(self.codes(source), ['print("副作用")', "import os", ""])

    def test_trailing_comment_before_generated_return_is_kept(self):
        source = '''import marimo

app = marimo.App()


@app.cell
def _():
    x = 1
    # 末尾说明
    return (x,)
'''
        self.assertEqual(self.codes(source), ["x = 1\n# 末尾说明"])

    def test_crlf_source_is_normalized(self):
        source = NOTEBOOK.replace("\n", "\r\n")
        self.assertEqual(
            self.codes(source),
            ["# 统计基础数据\nvalues = [1, 2, 3]", 'report = f"""总计 {sum(values)}"""\nreport'],
        )

    # --- 安全 -------------------------------------------------------------

    def test_source_is_never_executed_or_imported(self):
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / "pwned.txt"
            source = f'''import marimo
import inspect_notebook_should_not_be_imported

app = marimo.App()


@app.cell
def _():
    open({str(marker)!r}, "w").write("owned")
    raise RuntimeError("cell body must not run")
    return
'''
            before = set(sys.modules)
            result = self.analyze(source)
            self.assertNotIn("error", result)
            self.assertTrue(result["isMarimo"])
            self.assertIn("open(", result["cells"][0]["code"])
            self.assertFalse(marker.exists(), "静态预览执行了用户代码")
            added = set(sys.modules) - before
            self.assertEqual(added, set(), "静态预览导入了用户源码")
            self.assertNotIn("inspect_notebook_should_not_be_imported", sys.modules)

    def test_plain_script_with_top_level_write_is_not_executed(self):
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / "pwned.txt"
            result = self.analyze(f'open({str(marker)!r}, "w").write("owned")\n')
            self.assertFalse(result["isMarimo"])
            self.assertFalse(marker.exists(), "静态预览执行了用户代码")

    # --- 错误 -------------------------------------------------------------

    def test_syntax_error_is_reported_without_cells(self):
        result = self.assert_error('import marimo\n\napp = marimo.App(\n\ndef broken(:\n    pass\n', "语法错误")
        self.assertIn("行", result["error"])

    def test_unsupported_structures_report_clear_errors(self):
        cases = {
            "setup cell": (
                'import marimo\n\napp = marimo.App()\n\nwith app.setup:\n    import os\n\n\n'
                '@app.cell\ndef _():\n    x = 1\n    return (x,)\n',
                "setup",
            ),
            "unparsable cell": (
                'import marimo\n\napp = marimo.App()\n\napp._unparsable_cell("x = (")\n',
                "无法解析的单元格",
            ),
            "app.function cell": (
                'import marimo\n\napp = marimo.App()\n\n\n@app.function\ndef foo():\n    return 1\n',
                "@app.function",
            ),
            "nested cell": (
                'import marimo\n\napp = marimo.App()\n\nif True:\n\n    @app.cell\n    def _():\n'
                "        x = 1\n        return (x,)\n",
                "模块顶层",
            ),
            "unknown app": (
                'import marimo\n\n\n@app.cell\ndef _():\n    x = 1\n    return (x,)\n',
                "未绑定",
            ),
            "rebound app": (
                "import marimo\n\napp = marimo.App()\napp = 1\n\n\n@app.cell\n"
                "def _():\n    x = 1\n    return (x,)\n",
                "重新赋值",
            ),
            "unrelated top level function": (
                "import marimo\n\napp = marimo.App()\n\n\ndef helper():\n    return 1\n",
                "未纳入单元格",
            ),
            "multiple apps": (
                'import marimo\n\napp = marimo.App()\nother = marimo.App()\n\n\n@app.cell\n'
                "def _():\n    x = 1\n    return (x,)\n",
                "多个 marimo.App",
            ),
            "stray top level code": (
                'import marimo\n\napp = marimo.App()\n\nprint("顶层副作用")\n\n\n@app.cell\n'
                "def _():\n    x = 1\n    return (x,)\n",
                "顶层",
            ),
            "cell on class": (
                "import marimo\n\napp = marimo.App()\n\n\n@app.cell\nclass Thing:\n    pass\n",
                "class",
            ),
        }
        for label, (source, needle) in cases.items():
            with self.subTest(label):
                self.assert_error(source, needle)

    # --- CLI --------------------------------------------------------------

    def run_cli(self, payload):
        return subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=payload,
            capture_output=True,
            timeout=120,
        )

    def test_cli_reads_utf8_stdin_and_prints_only_json(self):
        process = self.run_cli(NOTEBOOK.encode("utf-8"))
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stderr, b"")
        stdout = process.stdout.decode("utf-8")
        self.assertEqual(len(stdout.strip().splitlines()), 1)
        self.assertIn("统计基础数据", stdout)
        payload = json.loads(stdout)
        self.assertTrue(payload["isMarimo"])
        self.assertEqual([cell["id"] for cell in payload["cells"]], ["preview-0", "preview-1"])
        self.assertNotIn("error", payload)

    def test_cli_plain_script_reports_false(self):
        payload = json.loads(self.run_cli(PLAIN_SCRIPT.encode("utf-8")).stdout.decode("utf-8"))
        self.assertEqual(payload, {"isMarimo": False, "cells": []})

    def test_cli_syntax_error_is_json_only(self):
        process = self.run_cli(b"import marimo\ndef broken(:\n")
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stderr, b"")
        payload = json.loads(process.stdout.decode("utf-8"))
        self.assertFalse(payload["isMarimo"])
        self.assertEqual(payload["cells"], [])
        self.assertIn("语法错误", payload["error"])

    def test_cli_rejects_non_utf8_input(self):
        payload = json.loads(self.run_cli(b"import marimo\n# \xff\xfe\n").stdout.decode("utf-8"))
        self.assertFalse(payload["isMarimo"])
        self.assertEqual(payload["cells"], [])
        self.assertIn("UTF-8", payload["error"])


if __name__ == "__main__":
    unittest.main()
