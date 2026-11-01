# Obsidian marimo Notebook 项目规则

- 独立于 obsidian-ipynb；不修改该项目源码、依赖或已安装插件。
- marimo 0.25.2 / Python 3.12 为首个锁定验证环境。内部协议集中在适配层 `python/backend.py`。
- 原生 Obsidian 视图；禁止以 iframe/webview 代替原生验证。
- 测试先行；真实协议测试和宿主验证单独报告，不得互相冒充。
- 仅 loopback、保持认证；不输出 token；关闭自身进程与临时资源。
- 文档在仓库内 `docs/`（当前设计 `docs/superpowers/`，历史路线 `docs/history/`）；宿主验证素材在工作区 `../assets/`，不提交生成的大文件。
- `docs/history/` 为已废弃的网页嵌入路线，禁止据此实施。
- 前端界面规范见 `docs/superpowers/specs/2026-11-01-native-ui-design.md`；主题色一律走 Obsidian 变量，不硬编码。
- 提交需用户明确指令；不自动 push、tag 或 release。

## 目录

| 路径 | 用途 |
| --- | --- |
| `src/` | TypeScript 插件源码（视图、协议、生命周期） |
| `python/` | 适配层与标准库静态解析器，作为文本打包进 main.js |
| `tests/` | Node 与 Python 测试 |
| `docs/` | 当前设计/计划/验证与历史归档 |
| `../assets/` | 宿主验证脚本、截图与证据 JSON（不入库） |
| `dist/` | 本地构建产物（不入库） |
