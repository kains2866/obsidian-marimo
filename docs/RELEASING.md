# 发行流程

当前版本为 `0.0.1`。创建 GitHub 仓库不等于发布 Release，也不等于完成社区目录审核。

## 版本与预检

1. 同步 `manifest.json`、`package.json`、`package-lock.json` 的版本；在 `versions.json` 新增版本与最低 Obsidian 版本的映射，保留历史条目。
2. 更新中英文 README 和 `docs/releases/<version>.md`。两个 README 的一级标题必须与 manifest 的 `name` 完全一致。
3. 使用 Node.js 24+、Python 3.12 和 `requirements-dev.txt` 中的固定运行时执行：

```sh
npm ci
npm audit --omit=dev
npm test
npm run typecheck
python -m unittest discover -s tests -p 'test_*.py'
npm run build
npm run check:release -- --artifacts --tag 0.0.1
```

以上命令末尾版本需替换为实际发行版本。自动检查覆盖版本一致性、英文首页、标题、许可、版本映射、发行说明、产物与源码清单／样式一致，以及遗漏的运行时 npm 依赖；不替代人工宿主验证或官方审核。

若更新运行时 npm 依赖，请重建并核对 `build/third-party-notices.md`，再同步根目录 `THIRD_PARTY_NOTICES.md`。预打包引擎的子库需按 [vendored 许可说明](licenses/README.md) 单独复核；升级版本会要求更新许可映射。完整许可嵌入 `main.js`，无需增加发行附件。

## GitHub Release

获得发布授权后，提交并推送源码，再推送与 manifest **完全一致**的 tag，例如 `0.0.1`，不加 `v`。标签工作流会重新安装、测试、构建、预检，并创建 **draft Release**；人工检查后再发布。

工作流的发行附件严格为：

- `main.js`
- `manifest.json`
- `styles.css`

不上传 ZIP、校验文件、测试证据或源码生成目录。GitHub 自动附带的源码归档不是插件安装包。普通 main 分支 push 只触发 CI，不创建 Release。

如工作流在创建草稿后中断，先查看现有草稿，不要重复创建相同 tag 的发行。

## 本地直装 ZIP

```sh
npm run package
```

需要 Python 3；可用 `MARIMO_TEST_PYTHON` 指定其路径。生成的 `release/marimo-notebook-<version>.zip` 内含 `marimo-notebook/` 文件夹及三个插件文件，可解压到 `<vault>/.obsidian/plugins/`。不会递归清空已有 release 目录；ZIP 不提交、不作为商店 Release 附件。

## 提交 Obsidian 社区目录

先发布匹配 tag 的正式 Release，再使用 [Obsidian 社区目录](https://community.obsidian.md/) 的开发者提交流程。字段与文案见 [SUBMISSION.md](SUBMISSION.md)。当前流程和要求以官方文档为准：

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Manifest](https://docs.obsidian.md/Reference/Manifest)
- [Versions](https://docs.obsidian.md/Reference/Versions)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)

准备文件和预检通过不代表已获官方上架批准。
