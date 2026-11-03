# Marimo Native

[![CI](https://github.com/kains2866/obsidian-marimo/actions/workflows/ci.yml/badge.svg)](https://github.com/kains2866/obsidian-marimo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Desktop only](https://img.shields.io/badge/Obsidian-Desktop%20only-7c3aed)
![Runtime](https://img.shields.io/badge/marimo-0.25.2-1b806a)

**A native marimo notebook editor inside Obsidian, powered by your local Python environment.**

Edit reactive Python notebooks using Obsidian's DOM, CodeMirror editors, theme colors and side panels. The main notebook view does not embed a website or webview. Files remain standard marimo `.py` notebooks.

[简体中文](README.zh-CN.md) · [Example notebook](docs/examples/marimo-showcase.py) · [Documentation](docs/README.md) · [Releases](https://github.com/kains2866/obsidian-marimo/releases)

> Early release, version **0.0.2**. Obsidian community-directory approval is pending. Native rendering covers a subset of marimo, rather than every feature of the official editor.

## What you can do

- **Edit natively:** create, reorder, split and delete cells; edit Markdown cells, hide code, disable cells and collapse outputs.
- **Keep reactive execution:** connect to the real local marimo runtime; rerun edited cells and their downstream dependants. Inspect variables and cell dependencies in side panels.
- **Read before running:** open `.py` files as static, read-only content first. New installations require an explicit connection before notebook code runs. Ordinary Python scripts stay read-only.
- **Use interactive outputs:** sliders, text fields, dropdowns, forms, tabs, tables and other supported `mo.ui` controls write values back to the kernel. Tables support search, sorting and row selection. Dataframe output provides a structural preview, not a full data editor.
- **Work with rich results:** Markdown previews (including formulas), images, Plotly and Vega/Altair charts, input prompts and errors. Chart engines are bundled rather than downloaded as CDN scripts.
- **Navigate and save:** outline headings, cell dependency views, code completion, run shortcuts, standard marimo saves and recovery drafts for unsaved changes. Saving refuses to silently overwrite externally changed files.
- **Optionally connect an AI provider:** generate or refactor cells, chat about the current notebook, and use inline completion through an OpenAI-compatible endpoint you configure.

`Mod+Enter` runs the current cell; `Shift+Enter` runs it and moves to the next cell. For features unavailable in the native UI, the toolbar can explicitly open the notebook in the official browser editor.

## Installation

Requirements: **Obsidian desktop 1.13.0+**, **Python 3.12**, and exactly **marimo 0.25.2**. Local GUI verification uses macOS and Obsidian 1.14.5. Windows and Linux GUI behavior has not been verified on real devices.

### 1. Prepare Python yourself

Use a dedicated virtual environment. Ruff 0.17.3 supplies the Format action; other notebook execution does not require Ruff. The plugin does not install or upgrade Python packages automatically.

macOS / Linux:

```sh
python3.12 -m venv ~/.venvs/obsidian-marimo
~/.venvs/obsidian-marimo/bin/python -m pip install marimo==0.25.2 ruff==0.17.3
```

Windows PowerShell:

```powershell
py -3.12 -m venv "$env:USERPROFILE\.venvs\obsidian-marimo"
& "$env:USERPROFILE\.venvs\obsidian-marimo\Scripts\python.exe" -m pip install marimo==0.25.2 ruff==0.17.3
```

Packages used by your notebook, such as pandas or Altair, must be installed in the same environment. Other marimo versions are rejected because the plugin uses a version-specific protocol adapter.

### 2. Install the plugin files

Once a release is published, download its **three individual assets**: `main.js`, `manifest.json` and `styles.css`. Put them in `<vault>/.obsidian/plugins/marimo-native/`, then enable **Marimo Native** in Community plugins. No ZIP is needed for Obsidian's update mechanism.

For a source checkout before the first release:

```sh
npm ci
npm run build
```

Copy those same three files from `dist/` into the plugin folder. Node.js **24+** is needed to build and test the source, but not to use an installed plugin.

### 3. Select Python and open a notebook

In Marimo Native settings, select the environment's **Python executable**, not the `marimo` command. Open the [example](docs/examples/marimo-showcase.py), inspect it, and choose **Connect and run** only if you trust its code.

Python file association can be disabled in settings. If another plugin owns `.py`, use the file context menu or command palette to open the native marimo view. **Auto-connect on open** is off for new installations; a previously saved explicit opt-in is preserved.

## Privacy and execution

- **Local execution is not a sandbox.** Connecting runs notebook Python with your user permissions. Virtual environments isolate packages, not filesystem or network access. Only run trusted notebooks.
- The adapter launches an authenticated service on loopback, uses your chosen Python executable, and stops the processes it owns when its notebook session closes. The runtime is separately installed and is not included in the plugin bundle.
- Recovery drafts are stored **outside the vault** in `~/.local/state/obsidian-marimo/drafts/<vault-hash>/`. They contain notebook code and are separate from saved `.py` files.
- The plugin adds no telemetry. Python code, external datasets referenced by chart specifications, and the explicitly opened official editor may still make network requests. Bundling chart engines does not make arbitrary notebook content offline.
- **AI is optional.** With an endpoint and model configured, AI actions send notebook code and variable context/value previews to that endpoint. Enabled inline completion may send context as you type. Provider terms and charges apply.
- The AI key is sent as a Bearer credential and saved **in plaintext** in `<vault>/.obsidian/plugins/marimo-native/data.json`. Vault synchronization tools may sync it. Do not publish that file or include keys in diagnostics.

## Current boundaries

- Desktop only; no mobile or browser-only Python runtime.
- Formula rendering follows Obsidian's Markdown preview; arbitrary kernel HTML/LaTeX output may retain formula source.
- Native widgets and charts are implemented individually. JavaScript-backed third-party widgets, specialized data editors, file pickers and some layouts are not fully supported. Use the official editor when needed.
- Static inspection handles supported standard `@app.cell` structures. Unsupported or invalid structures fall back to complete read-only source instead of presenting a partial notebook.
- A timed-out or oversized protocol response can end a session and require reconnection. Notebooks with separate layout files are not supported for saving.
- Integration currently includes file opening, themes, outline and notebook side panels. Do not assume all Markdown-only features, Properties or every community plugin work with `.py` notebooks.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run check:release -- --artifacts
```

Use Python 3.12 with `pip install -r requirements-dev.txt`, then run `python -m unittest discover -s tests -p 'test_*.py'`. Tests include real local runtime interactions and execute test fixtures. Host verification is separate from unit/protocol testing.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Release process](docs/RELEASING.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## License and acknowledgements

Plugin source is [MIT licensed](LICENSE). This is an independent project, not an official marimo or Obsidian product. [marimo](https://github.com/marimo-team/marimo) is a separately installed, Apache-2.0-licensed runtime. Bundled libraries retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
