# MarimoNotebook

[![CI](https://github.com/kains2866/obsidian-marimo-notebook/actions/workflows/ci.yml/badge.svg)](https://github.com/kains2866/obsidian-marimo-notebook/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Desktop only](https://img.shields.io/badge/Obsidian-Desktop%20only-7c3aed)
![Runtime](https://img.shields.io/badge/marimo-0.25.2-1b806a)

**在 Obsidian 中原生编辑 marimo 笔记本，由本地 Python 环境执行。**

单元格使用 Obsidian 的 DOM、CodeMirror、主题色和侧栏。主要笔记本界面不嵌入网页或 webview；保存后仍是标准 marimo `.py` 文件。

[English](README.md) · [示例笔记本](docs/examples/marimo-showcase.py) · [文档](docs/README.md) · [发行页面](https://github.com/kains2866/obsidian-marimo-notebook/releases)

> 当前为 **0.0.1 首次发行准备阶段**，尚未上架 Obsidian 社区目录。原生渲染覆盖部分 marimo 功能，不保证与官方编辑器完全一致。

## 主要功能

- **原生编辑**：增删、移动、拆分单元格；专用 Markdown 编辑；隐藏代码、禁用单元格及折叠输出。
- **响应式运行**：连接真实的本地 marimo 内核，运行修改过的单元格并重算下游；侧栏查看变量与依赖关系。
- **先查看，再运行**：新安装默认只读预览 `.py`，明确连接后才执行代码。普通 Python 脚本保持只读。
- **交互输出**：滑块、文本框、下拉框、表单、tabs、表格等已适配的 `mo.ui` 控件可写回内核；表格支持搜索、排序、行选择。Dataframe 提供结构预览，并非完整数据编辑器。
- **丰富的结果**：Markdown 编辑预览（含公式）、图片、Plotly 与 Vega/Altair 图表、输入提示和错误。图表库随包构建，不再运行时从 CDN 加载脚本。
- **导航与保存**：标题大纲、依赖视图、代码补全、运行快捷键、标准 marimo 保存与未保存内容的恢复草稿；拒绝静默覆盖外部修改。
- **可选 AI**：自行配置兼容 OpenAI 的端点，可生成／重构单元格、进行笔记本对话，以及使用行内补全。

`Mod+Enter` 运行当前单元格；`Shift+Enter` 运行并转到下一单元格。原生界面尚未覆盖的功能，可通过工具栏明确选择在官方浏览器编辑器中打开。

## 安装

需要 **Obsidian 桌面版 1.13.0+、Python 3.12、marimo 0.25.2**。本机界面验证环境为 macOS 与 Obsidian 1.14.5；Windows／Linux 界面尚无真实设备验证。

### 1. 自行准备 Python 环境

建议使用独立虚拟环境。格式化操作需要 Ruff 0.17.3；其他 Notebook 执行不依赖 Ruff。插件不会自动安装或升级 Python 依赖。

macOS／Linux：

```sh
python3.12 -m venv ~/.venvs/obsidian-marimo
~/.venvs/obsidian-marimo/bin/python -m pip install marimo==0.25.2 ruff==0.17.3
```

Windows PowerShell：

```powershell
py -3.12 -m venv "$env:USERPROFILE\.venvs\obsidian-marimo"
& "$env:USERPROFILE\.venvs\obsidian-marimo\Scripts\python.exe" -m pip install marimo==0.25.2 ruff==0.17.3
```

Notebook 使用的 pandas、Altair 等包也需装入同一环境。由于插件依赖特定版本的协议适配层，目前会拒绝其他 marimo 版本。

### 2. 放置插件文件

正式发布后，从发行页面下载 `main.js`、`manifest.json`、`styles.css` **三个独立附件**，放入 `<vault>/.obsidian/plugins/marimo-notebook/`，在社区插件中启用 MarimoNotebook。Obsidian 自动更新不需要 ZIP。

首次发布前，可从源码构建：

```sh
npm ci
npm run build
```

将 `dist/` 下相同的三个文件复制到插件目录即可。构建和测试需 Node.js **24+**；使用已安装插件不需要单独安装 Node.js。

### 3. 配置解释器并打开 Notebook

设置中填写上述环境的 **Python 可执行文件路径**，不是 `marimo` 命令。打开[示例](docs/examples/marimo-showcase.py)，查看代码，确认可信后选择“连接并运行”。

可在设置中关闭 Python 文件关联。其他插件占用 `.py` 时，可使用文件右键菜单或命令面板打开原生 marimo 视图。“打开文件自动连接”新安装默认关闭；此前明确开启的设置会保留。

## 隐私与执行范围

- **本地运行不等于沙箱**。连接时会执行 Notebook 的 Python，拥有当前用户的文件和网络权限。虚拟环境只隔离依赖包，请仅运行可信代码。
- 适配层使用所选 Python，在 loopback 启动带认证的服务；关闭笔记本会话时清理自身启动的进程。marimo 运行时需单独安装，不包含在插件发行文件内。
- 恢复草稿保存在**仓库外**的 `~/.local/state/obsidian-marimo/drafts/<vault-hash>/`，包含未保存的 Notebook 代码，与已保存 `.py` 文件分开。
- 插件不添加遥测。Python 代码、图表规格引用的远程数据，以及明确打开的官方编辑器仍可能联网。图表库本地化不代表任意 Notebook 内容都能离线使用。
- **AI 为可选功能**。配置端点和模型后，AI 操作会将 Notebook 代码、变量上下文及值预览发送到该端点；启用行内补全时，输入过程中可能发送上下文。服务条款和费用由提供商决定。
- AI 密钥通过 Bearer 请求头发送，并**明文保存**于 `<vault>/.obsidian/plugins/marimo-notebook/data.json`，可能被仓库同步工具同步。请勿公开该文件或在诊断信息中粘贴密钥。

## 当前边界

- 仅限桌面版；不提供手机或纯浏览器 Python 运行时。
- 公式排版依赖 Obsidian 的 Markdown 编辑预览；任意内核 HTML／LaTeX 输出可能保留公式源码。
- 原生控件与图表逐项适配。依赖 JavaScript 的第三方组件、专用数据编辑器、文件选择器及部分布局尚未完整支持，必要时使用官方编辑器。
- 静态解析支持已适配的标准 `@app.cell` 结构；遇到不支持或无效的结构，会显示完整只读源码，不展示残缺的单元格列表。
- 协议响应超时或过大可能结束会话，需要重新连接。不支持保存带有独立布局文件的 Notebook。
- 已适配文件打开、主题、标题大纲与 Notebook 侧栏，不代表所有 Markdown 专属能力、Properties 或社区插件都能处理 `.py`。

## 开发与验证

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run check:release -- --artifacts
```

使用 Python 3.12，先执行 `pip install -r requirements-dev.txt`，再执行 `python -m unittest discover -s tests -p 'test_*.py'`。部分测试会启动真实本地运行时并执行测试用代码；宿主界面验证与单元／协议测试分别记录。

[贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [发行流程](docs/RELEASING.md) · [第三方许可](THIRD_PARTY_NOTICES.md)

## 许可与致谢

插件源码采用 [MIT](LICENSE)。本项目独立开发，并非 marimo 或 Obsidian 官方产品。[marimo](https://github.com/marimo-team/marimo) 是单独安装、采用 Apache-2.0 许可的运行时。打包的第三方库保留其原许可，见[第三方声明](THIRD_PARTY_NOTICES.md)。
