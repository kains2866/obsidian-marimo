# Obsidian 社区目录提交材料

以下材料与根目录 manifest 一致。正式发行与审核状态，以 GitHub Release 和社区目录页面为准。

| 字段 | 内容 |
| --- | --- |
| Name | Marimo Native |
| ID | marimo-native |
| Author | Kains |
| Repository | kains2866/obsidian-marimo |
| Version | 0.0.2 |
| Minimum app version | 1.13.0 |
| Desktop only | true |
| License | MIT |
| Description | Edit and run reactive marimo notebooks with a native interface and a local Python runtime. |

原 ID `marimo-notebook` 与社区目录中已有的归档条目冲突，现采用 `marimo-native`／Marimo Native。公开登记表未覆盖所有归档或保留条目，最终名称与 ID 是否可提交，以社区目录的实际校验为准。

## English overview

Marimo Native brings a native marimo notebook editing interface to Obsidian desktop. Edit cells and Markdown using Obsidian's theme, run reactive Python locally, and inspect headings, variables and cell dependencies without embedding the official website in the main notebook view.

The plugin requires a separately installed Python 3.12 environment with marimo 0.25.2. New installations open files without executing notebook code until the user connects. Supported widgets, tables, images and charts render in the native view; unsupported features can be opened explicitly in the official browser editor.

AI features are optional and use a user-configured OpenAI-compatible endpoint. See the README for data transmission, plaintext API-key storage, local recovery files and execution permissions. This independent project is not affiliated with or endorsed by marimo or Obsidian.

## 提交前人工确认

- 正式 Release 的 tag、manifest、源码版本一致，包含三个独立插件文件。
- 英文 README 首先显示，中文文档可切换；安装步骤能在新环境复现。
- 本地执行、AI 联网、仓库外草稿、密钥存储与固定运行时限制均已披露。
- 原生支持范围与未验证的平台表述准确；不使用“唯一”“全面兼容”等未证实的宣传。
- 开发者账户发起实际提交；首次发布与提交流程由维护者另行授权。
