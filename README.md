# MarimoNotebook

独立的 Obsidian 原生 marimo 前端，不嵌入官方网页。当前验证环境为 macOS、Obsidian 1.14.5、Python 3.12、marimo 0.25.2，尚非可发布的完整插件。

## 已验证能力

- 文件列表点击 `.py` 直接打开；先以只读单元格预览，不运行 Notebook。普通 Python 脚本显示只读源码。
- 原生 CodeMirror 单元格编辑，字体与代码颜色使用 Obsidian 主题变量。
- 修改并运行上游单元格，由官方后端自动重算下游。
- 基础文本、Markdown/HTML 与错误输出；静态过滤脚本、远程资源和上游样式。
- 调用官方服务生成标准 marimo `.py`，由适配层原子保存，保留名称和单元格配置；拒绝静默覆盖外部修改。
- 显式允许执行后启动仅本机认证服务；关闭页面清理自身进程。

## 文档

- 当前设计、计划、验证与界面规范：`docs/`（入口 `docs/README.md`）
- 已废弃的网页嵌入路线：`docs/history/`，仅作历史参考，不得据此实施
- 宿主验证脚本、截图与证据：工作区 `../assets/`（生成物不入库）

## 在 Temp 中试用

已安装至 Temp 的 `.obsidian/plugins/marimo-notebook/`。在文件列表点击 `marimo-native-demo.py` 即可打开并预览单元格；点击“连接并运行”后可编辑。若其他插件已关联 `.py`，会保留原关联，可用文件右键菜单“以原生 marimo 视图打开”或命令面板入口。设置中的 Python 文件关联开关在重新加载插件后生效。修改 `x` 后运行该块，查看数值和 Markdown 输出一起更新。保存需点击工具栏“保存”。

首次连接会运行可信 Notebook 的代码。Python 虚拟环境不构成安全沙箱。

## 当前限制

- 静态预览仅支持标准 `@app.cell` 结构（包括 import 别名）。语法错误、setup 等暂未适配的结构会显示原因并保留完整源码，不展示不完整的单元格列表。
- 锁定 marimo 0.25.2 内部协议；未经验证的版本会被拒绝，不跟随上游自动升级。
- 暂无单元格新增/删除、复杂交互组件、数据库/AI界面、图片输出、自动重连、原生 Properties 等功能。未支持的输出只显示类型说明，不放置空按钮。
- Markdown 单元格当前编辑其 `mo.md(...)` Python 表达式，输出区呈现排版；尚未制作专门 Markdown 编辑模式。
- 未保存内容关闭或会话失败时写入本机持久草稿目录 `~/.local/state/obsidian-marimo/drafts/`。重新连接后可点击“恢复草稿”；草稿基线与原文件不同时保留供手动恢复，不覆盖文件。
- 原型遇到运行等待超时或输出超限会结束会话，需重新连接；暂不用于长任务。带独立布局文件的 Notebook 暂不支持保存。
- Windows/Linux尚未实机验证；源码中的跨平台路径不等于已支持。

## 开发与验证

```bash
npm test
npm run typecheck
npm run build
# 使用安装了 marimo 0.25.2 的 Python：
/Users/tiyukains/.local/share/uv/tools/marimo/bin/python -m unittest discover -s tests -v
```

本项目的 `node_modules` 目前是指向 `obsidian-ipynb-workspace/obsidian-ipynb/node_modules` 的符号链接，复用对方工具链，因此不要在对方项目里增删依赖。该路径已被 `.gitignore` 忽略，不进入版本库。要独立开发，先删除该符号链接再运行 `npm install`。

`dist/` 为本地插件产物（不入库）。工作区 `../assets/verify-native-opening.py` 为 Temp 文件点击、预览、运行保存及文件切换回归脚本，使用独立验证文件，不改写用户 demo；旧 `verify-host.py` / `verify-lifecycle.py` 会修改 demo，不应直接用于用户编辑后的文件。原有 Jupyter 项目不受此项目影响。
