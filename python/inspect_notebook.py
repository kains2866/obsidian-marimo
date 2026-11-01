"""Static preview of marimo notebook source.

The source is only ever *parsed* with :mod:`ast` / :mod:`tokenize`: nothing is
imported, executed, or written to disk. Output is a single JSON object
``{"isMarimo": bool, "cells": [{"id", "code"}], "error"?: str}`` read from
UTF-8 stdin.

Anything that cannot be represented faithfully (setup cells, ``@app.function``
cells, unparsable cells, module level code that belongs to no cell, ...) is
reported as a clear error with an empty cell list, so a preview can never look
complete when it is only part of a notebook.
"""
import ast
import io
import json
import re
import sys
import tokenize

MAX_SOURCE_BYTES = 5 * 1024 * 1024

_NEWLINE_RE = re.compile(r"\r\n|\r|\n")
_FSTRING_START = getattr(tokenize, "FSTRING_START", None)
_FSTRING_END = getattr(tokenize, "FSTRING_END", None)
# Decorators that turn a top-level definition into a cell-like marimo object.
_CELL_LIKE_DECORATORS = ("cell", "function", "class_definition")


class InspectionError(Exception):
    """Source cannot be previewed without guessing at its structure."""


def analyze(source):
    """Return the JSON-ready preview for ``source``; never raises."""
    try:
        return _analyze(source)
    except InspectionError as error:
        return _failure(str(error))
    except RecursionError:
        return _failure("源码嵌套过深，无法静态分析")
    except MemoryError:
        return _failure("源码过大，无法静态分析")
    except Exception as error:  # keep the JSON contract even on an internal bug
        return _failure("静态分析失败：" + type(error).__name__ + ": " + str(error))


def _failure(message):
    return {"isMarimo": False, "cells": [], "error": message}


def _analyze(source):
    if not isinstance(source, str):
        raise InspectionError("源码必须是字符串")
    text = "\n".join(_NEWLINE_RE.sub("\n", source).split("\n"))
    if text.startswith("\ufeff"):
        text = text[1:]
    try:
        tree = ast.parse(text, filename="<marimo-preview>", mode="exec")
    except SyntaxError as error:
        raise InspectionError(_syntax_message(error)) from None
    except ValueError as error:
        raise InspectionError("Python 源码包含无法解析的内容：" + str(error)) from None
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError) as error:
        raise InspectionError("源码无法进行词法分析：" + str(error)) from None

    lines = text.split("\n")
    module_aliases, app_classes = _imports(tree)
    app_names, constructor_nodes = _app_instances(tree, module_aliases, app_classes)
    _reject_stray_constructions(tree, module_aliases, app_classes, constructor_nodes)
    if not app_names:
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            for decorator in node.decorator_list:
                base, attribute = _call_attribute(decorator)
                if attribute == "cell":
                    raise InspectionError(
                        "无法识别 cell 装饰器：`"
                        + str(base)
                        + "` 未绑定到 marimo.App 实例（第 "
                        + str(node.lineno)
                        + " 行）"
                    )
        return {"isMarimo": False, "cells": []}

    _check_module_body(tree, app_names, module_aliases, app_classes)
    cell_nodes = _cell_nodes(tree, app_names)
    protected_rows = _protected_rows(tokens)
    positions = _token_positions(tokens)
    cells = [
        {
            "id": "preview-" + str(index),
            "code": _cell_code(lines, tokens, positions, protected_rows, node),
        }
        for index, node in enumerate(cell_nodes)
    ]
    return {"isMarimo": True, "cells": cells}


def _syntax_message(error):
    location = "第 " + str(error.lineno) + " 行" if error.lineno else "未知位置"
    return "Python 语法错误（" + location + "）：" + str(error.msg)


# --- 结构识别 ------------------------------------------------------------


def _imports(tree):
    """Names bound to the ``marimo`` module and to ``marimo.App``."""
    modules, classes = set(), set()
    for statement in tree.body:
        if isinstance(statement, ast.Import):
            for alias in statement.names:
                if alias.name == "marimo":
                    modules.add(alias.asname or alias.name)
        elif (
            isinstance(statement, ast.ImportFrom)
            and not statement.level
            and statement.module == "marimo"
        ):
            for alias in statement.names:
                if alias.name == "App":
                    classes.add(alias.asname or alias.name)
    return modules, classes


def _builds_app(value, module_aliases, app_classes):
    if not isinstance(value, ast.Call):
        return False
    function = value.func
    if isinstance(function, ast.Name):
        return function.id in app_classes
    return (
        isinstance(function, ast.Attribute)
        and isinstance(function.value, ast.Name)
        and function.value.id in module_aliases
        and function.attr == "App"
    )


def _app_instances(tree, module_aliases, app_classes):
    names, allowed = [], set()
    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            targets, value = statement.targets, statement.value
        elif isinstance(statement, ast.AnnAssign):
            targets, value = [statement.target], statement.value
        else:
            continue
        if value is None or not _builds_app(value, module_aliases, app_classes):
            continue
        for target in targets:
            if not isinstance(target, ast.Name):
                raise InspectionError(
                    "不支持预览：marimo.App 必须直接赋值给简单名称（第 " + str(statement.lineno) + " 行）"
                )
            if target.id in names:
                raise InspectionError("不支持预览：marimo.App 被重复赋值给 `" + target.id + "`")
            names.append(target.id)
        allowed.add(id(value))
    if len(names) > 1:
        raise InspectionError(
            "不支持预览：存在多个 marimo.App 实例（" + "、".join(names) + "），无法确定要预览哪一个"
        )
    return names, allowed


def _reject_stray_constructions(tree, module_aliases, app_classes, allowed):
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and _builds_app(node, module_aliases, app_classes)
            and id(node) not in allowed
        ):
            raise InspectionError(
                "不支持预览：marimo.App 必须在模块顶层构造（第 " + str(node.lineno) + " 行）"
            )


def _call_attribute(node):
    """`(base_name, attribute)` for a call/attribute expression, else `(None, None)`."""
    if isinstance(node, ast.Call):
        node = node.func
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
        return node.value.id, node.attr
    if isinstance(node, ast.Attribute):
        return None, node.attr
    return None, None


def _decorator_attribute(node):
    """Attribute name of a decorator expression, ignoring whether it is called."""
    return _call_attribute(node)[1]


def _has_decorator(node, attribute):
    return any(_decorator_attribute(item) == attribute for item in getattr(node, "decorator_list", []))


def _check_module_body(tree, app_names, module_aliases, app_classes):
    """Only marimo-generated module level scaffolding may exist besides cells."""
    for statement in tree.body:
        if isinstance(statement, (ast.Import, ast.ImportFrom)):
            continue
        if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if _cell_decorator_index(statement, app_names) is not None:
                continue
            label = "class" if isinstance(statement, ast.ClassDef) else "函数"
            raise InspectionError(
                "不支持预览：模块顶层存在未纳入单元格的 "
                + label
                + " 定义（第 "
                + str(statement.lineno)
                + " 行）"
            )
        if isinstance(statement, (ast.Assign, ast.AnnAssign)):
            if statement.value is not None and _builds_app(statement.value, module_aliases, app_classes):
                continue
            rebound = _rebinding_target(statement, app_names)
            if rebound is not None:
                raise InspectionError(
                    "不支持预览：`" + rebound + "` 被重新赋值（第 " + str(statement.lineno) + " 行）"
                )
            targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
            if (len(targets) == 1 and isinstance(targets[0], ast.Name)
                    and targets[0].id == "__generated_with"
                    and isinstance(statement.value, ast.Constant)
                    and isinstance(statement.value.value, str)):
                continue
            raise InspectionError(
                "不支持预览：模块顶层赋值无法归属到单元格（第 " + str(statement.lineno) + " 行）"
            )
        if isinstance(statement, ast.Expr):
            value = statement.value
            if isinstance(value, ast.Constant):
                continue
            if _is_app_call(value, app_names, "run"):
                continue
            if _is_app_call(value, app_names, "_unparsable_cell"):
                raise InspectionError(
                    "不支持预览：文件中存在无法解析的单元格（app._unparsable_cell，第 "
                    + str(statement.lineno)
                    + " 行），请先在 marimo 中修复语法"
                )
            raise InspectionError(
                "不支持预览：模块顶层语句无法归属到单元格（第 " + str(statement.lineno) + " 行）"
            )
        if isinstance(statement, ast.With):
            if any(
                _call_attribute(item.context_expr)[1] == "setup"
                and _call_attribute(item.context_expr)[0] in app_names
                for item in statement.items
            ):
                raise InspectionError(
                    "不支持预览：检测到 setup cell（`with app.setup`），其代码不属于任何单元格"
                )
            raise InspectionError(
                "不支持预览：模块顶层 with 语句无法归属到单元格（第 " + str(statement.lineno) + " 行）"
            )
        if isinstance(statement, ast.If) and _is_main_guard(statement.test):
            if (not statement.orelse and len(statement.body) == 1
                    and isinstance(statement.body[0], ast.Expr)
                    and _is_app_call(statement.body[0].value, app_names, "run")):
                continue
            raise InspectionError("不支持预览：__main__ 分支包含 app.run() 之外的代码")
        raise InspectionError(
            "不支持预览：模块顶层代码无法归属到单元格（第 " + str(statement.lineno) + " 行）"
        )


def _rebinding_target(statement, app_names):
    """Name of the App instance this assignment overwrites, if any."""
    targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
    for target in targets:
        if isinstance(target, ast.Name) and target.id in app_names:
            return target.id
    return None


def _is_main_guard(test):
    return (
        isinstance(test, ast.Compare)
        and isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and len(test.ops) == 1
        and isinstance(test.ops[0], ast.Eq)
        and len(test.comparators) == 1
        and isinstance(test.comparators[0], ast.Constant)
        and test.comparators[0].value == "__main__"
    )


def _is_app_call(node, app_names, attribute):
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id in app_names
        and node.func.attr == attribute
    )


def _cell_nodes(tree, app_names):
    """Module level `@app.cell` functions, in source order."""
    cells = []
    for statement in tree.body:
        if not isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        index = _cell_decorator_index(statement, app_names)
        if index is None:
            continue
        if len(statement.decorator_list) != 1:
            raise InspectionError(
                "不支持预览：cell 函数 `"
                + statement.name
                + "` 上存在额外装饰器（第 "
                + str(statement.lineno)
                + " 行）"
            )
        cells.append(statement)
    _reject_nested_cells(tree, app_names, cells)
    return cells


def _cell_decorator_index(node, app_names):
    for index, decorator in enumerate(node.decorator_list):
        base, attribute = _call_attribute(decorator)
        if attribute not in _CELL_LIKE_DECORATORS:
            continue
        if base in app_names:
            if attribute != "cell":
                raise InspectionError(
                    "不支持预览：检测到 @"
                    + str(base)
                    + "."
                    + attribute
                    + " 单元格，当前仅支持 @app.cell（第 "
                    + str(node.lineno)
                    + " 行）"
                )
            return index
        if attribute == "cell":
            raise InspectionError(
                "无法识别 cell 装饰器：`"
                + str(base)
                + "` 未绑定到 marimo.App 实例（第 "
                + str(node.lineno)
                + " 行）"
            )
    return None


def _reject_nested_cells(tree, app_names, cells):
    module_level = {id(node) for node in cells}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            if _has_decorator(node, "cell") or any(
                _call_attribute(item)[1] in _CELL_LIKE_DECORATORS
                and _call_attribute(item)[0] in app_names
                for item in node.decorator_list
            ):
                raise InspectionError(
                    "不支持预览：class 上不能使用 @app.cell（第 " + str(node.lineno) + " 行）"
                )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and id(node) not in module_level:
            if _has_decorator(node, "cell"):
                raise InspectionError(
                    "不支持预览：cell 函数必须定义在模块顶层（第 " + str(node.lineno) + " 行）"
                )


# --- 代码还原 ------------------------------------------------------------


def _token_positions(tokens):
    positions = {}
    for index, token in enumerate(tokens):
        positions.setdefault(token.start, index)
    return positions


def _signature_end_row(tokens, positions, node):
    """Line holding the end of the `def` signature (its trailing colon)."""
    index = positions.get((node.lineno, node.col_offset))
    if index is None:
        for candidate, token in enumerate(tokens):
            if token.start == (node.lineno, node.col_offset):
                index = candidate
                break
    if index is not None:
        for token in tokens[index:]:
            if token.type == tokenize.NEWLINE:
                return token.start[0]
            if token.type == tokenize.ENDMARKER:
                break
    return node.body[0].lineno - 1


def _protected_rows(tokens):
    """Rows that live inside a multiline string literal (dedent must not eat them)."""
    protected = set()
    fstring_rows = []
    for token in tokens:
        if token.type == tokenize.STRING and "\n" in token.string:
            protected.update(range(token.start[0] + 1, token.end[0] + 1))
        elif _FSTRING_START is not None and token.type == _FSTRING_START:
            fstring_rows.append(token.start[0])
        elif _FSTRING_END is not None and token.type == _FSTRING_END:
            start = fstring_rows.pop() if fstring_rows else None
            if start is not None:
                protected.update(range(start + 1, token.end[0] + 1))
    return protected


def _generated_return(node):
    """marimo appends `return`, `return (a,)` or `return a, b` listing cell defs."""
    if not isinstance(node, ast.Return):
        return False
    value = node.value
    if value is None:
        return True
    if isinstance(value, (ast.Tuple, ast.List)):
        return all(
            isinstance(element, ast.Name) and isinstance(element.ctx, ast.Load)
            for element in value.elts
        )
    return False


def _leading_width(line):
    return len(line) - len(line.lstrip(" \t"))


def _strip_indent(line, shift):
    index = 0
    while index < shift and index < len(line) and line[index] in " \t":
        index += 1
    return line[index:]


def _dedent(block, shift, protected):
    """Dedent a cell body, leaving under-indented string blocks untouched."""
    keep = [False] * len(block)
    index = 0
    while index < len(block):
        if not protected[index]:
            index += 1
            continue
        end = index
        smallest = None
        while end < len(block) and protected[end]:
            line = block[end]
            if line.strip():
                width = _leading_width(line)
                smallest = width if smallest is None else min(smallest, width)
            end += 1
        if smallest is not None and smallest < shift:
            for position in range(index, end):
                keep[position] = True
        index = end
    return [
        line if keep[position] else _strip_indent(line, shift)
        for position, line in enumerate(block)
    ]


def _cell_code(lines, tokens, positions, protected_rows, node):
    statements = list(node.body)
    removed = statements.pop() if statements and _generated_return(statements[-1]) else None
    signature_end = _signature_end_row(tokens, positions, node)
    if node.body[0].lineno <= signature_end:
        raise InspectionError("不支持预览：单行函数体（第 " + str(node.lineno) + " 行），请使用标准多行单元格")
    start_row = signature_end + 1
    end_row = (statements[-1].end_lineno or statements[-1].lineno) if statements else start_row - 1
    if removed is not None and removed.lineno - 1 > end_row:
        # Keep comments that sat between the code and the generated return.
        end_row = removed.lineno - 1
    if end_row < start_row:
        return ""
    block = lines[start_row - 1:end_row]
    shift = _leading_width(lines[node.body[0].lineno - 1])
    protected = [(start_row + offset) in protected_rows for offset in range(len(block))]
    dedented = _dedent(block, shift, protected)
    while dedented and not dedented[0].strip():
        dedented.pop(0)
    while dedented and not dedented[-1].strip():
        dedented.pop()
    return "\n".join(dedented)


# --- CLI -----------------------------------------------------------------


def _emit(result):
    try:
        text = json.dumps(result, ensure_ascii=False)
    except ValueError:
        text = json.dumps(result)
    try:
        sys.stdout.write(text + "\n")
    except UnicodeEncodeError:
        sys.stdout.write(json.dumps(result) + "\n")
    sys.stdout.flush()


def main():
    try:
        payload = sys.stdin.buffer.read(MAX_SOURCE_BYTES + 1)
    except (OSError, ValueError, AttributeError):
        result = _failure("无法读取标准输入")
    else:
        if len(payload) > MAX_SOURCE_BYTES:
            result = _failure(
                "源码超过 " + str(MAX_SOURCE_BYTES // (1024 * 1024)) + " MiB 限制，无法预览"
            )
        else:
            try:
                source = payload.decode("utf-8-sig")
            except UnicodeDecodeError:
                result = _failure("源码不是有效的 UTF-8 文本")
            else:
                result = analyze(source)
    _emit(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
