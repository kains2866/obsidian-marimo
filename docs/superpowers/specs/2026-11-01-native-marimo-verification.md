---
title: 原生 marimo P0 验证与接口边界
created: 2026-11-01
updated: 2026-11-01
version: "0.1"
status: prototypeVerifiedPendingFollowupReview
scope:
  - obsidian-marimo
---

# 验证记录

## 环境与当前阶段

独立项目 obsidian-marimo；原 Jupyter 项目未修改。macOS / Obsidian 1.14.5 / Python 3.12 / marimo 0.25.2。本轮只交付核心链路原型，不代表完整 marimo 前端。TypeScript 依赖临时复用既有工具链，未另外安装。

## 已执行

- Node 测试21项通过：消息与输出、持久草稿、配置回退、进程组关闭（含真实忽略SIGTERM的进程）。
- Python 测试32项通过，包含真实 marimo 后端与stdio端到端：指定单元格输出6、只修改上游后下游输出12，官方加载保存后的文件执行得到12，错误消息与关闭均通过。
- typecheck 与 build 通过。
- Temp 宿主真实连接，4个原生 CodeMirror 单元格，无 iframe/webview。
- 实际修改上游：数值输出与 Markdown 排版结果同时由6变12。
- 故意运行 ValueError：显示具体错误并标记运行失败；恢复代码后继续运行、保存成功。
- 静态输出过滤：脚本、远程图片、事件处理器、硬编码样式均移除。
- 标签页关闭后适配进程退出；Python集成测试另验证服务进程退出。
- 保存后的marimo文件可由官方CLI重新导出为ipynb（不执行输出）。

证据：../assets/host-verification.json、verify-host.py、native-marimo-temp.png、native-demo-roundtrip.ipynb（均以工作区assets目录为准）。宿主脚本仅操作Temp的marimo-native-demo.py。

## 协议核对结论

WorkBuddy 对安装源码进行了独立只读调查，提供了路由、通知和请求模型的定位。实测与进一步源码核对修正了报告中的三处差异：

1. REST保存实际为 `/api/kernel/save`，而非 `/api/files/save`。
2. 除认证Token外，POST还需主页 `marimo-server-token` 提供的 `Marimo-Server-Token`，保留版本保护。
3. WS通知字段使用snake_case；REST请求体使用camelCase。

另经宿主实测确认，实时 `mo.md()` 使用 `text/markdown` MIME但内容为预渲染HTML；不能再次按Markdown源码转义。详见固定版本 `_output/md.py` 的 `_mime_`。

后端接口为内部契约，不承诺跨版本兼容。版本检查、认证、请求与事件集中在python/backend.py；固定版本更新应重新运行真实协议与宿主回归。

## 尚未完成或未验证

- WorkBuddy首轮独立代码复核已完成，关键问题已修复。本次另由code-reviewer复核文件视图生命周期及写入锁、python-reviewer复核静态预览，两者无剩余HIGH/CRITICAL。TypeScript专业审查受原型尚无ESLint配置阻断，未给出完整审查通过结论；类型检查与21项Node测试通过。初轮因额度未完成的审查不计为通过。
- 自动化覆盖率未统计，不宣称达到80%。
- Windows/Linux实机、长时间运行、图片/交互组件、数据库/AI、单元格增删、完整撤销/恢复UI、外部编辑器并行写入协调，均不属于本轮通过项。
- 不覆盖现有Bridge插件的运行行为；只明确保持其文件关联不被接管。
- 暂无可发布发行包、Git提交、push或Release。

## 修订记录

- 2026-11-01：记录真实协议和Temp宿主验证，保留未通过/未验证项。

## 界面完善第二轮（参考 ipynb 样式）

针对「焦点环 / 活动行 / 错误色 / 单元格状态 / 提示收纳」五项的原生宿主实证（专用 fixture，不改用户 demo）：

- 连接、运行（含故意 ValueError）、停止全部通过；错误输出颜色实测等于主题 `--text-error`（浅/深两套主题均核对）。
- 宿主实时观察到单元格 `running` 状态与 `lucide-loader-2` 旋转图标（sleep 1.2s 的单元格）；停止后无残留状态与图标。
- 焦点环与活动行以真实鼠标点击验证（后台窗口无法获得 DOM 焦点，`view.focus()` 不可靠，须用受信输入事件）。
- 期间发现并修复一个缺陷：连接重渲染单元格后选中态丢失，现已在重建后恢复。
- 证据：`assets/verify-ui-polish.py`、`assets/ui-polish-verification.json`、`assets/ui2-light-connected.png`、`assets/ui2-dark-error.png`、`assets/ui2-narrow.png`。
- 附带发现：连接时 marimo 可能创建 `<notebook>.py.json` 布局旁车文件；带布局文件时保存仍按既有规则拒绝。

最终本机验证：Node 53 项、Python 32 项测试通过；typecheck/build 通过；`verify-native-opening.py` 全量回归通过；最新 dist 三文件与 Temp 安装目录 sha256 一致。

## 审查处理与补充实测

使用 receiving-code-review 核对 WorkBuddy 返回的12项问题，未照搬存在技术风险的建议。

- 保存：官方persist:false只生成源码，适配层在同目录写临时文件、fsync、原子replace。测试注入replace失败，确认原文件内容未变、无临时残留。带独立布局文件暂拒绝保存，避免上游额外写盘。
- 超时/输出限额：终止旧会话并要求重连，不采用盲目排空事件队列，避免丢弃合法输出或复用未完成周期。测试覆盖超时关闭。
- 关闭：Node独立POSIX进程组包含适配器、marimo及内核；TERM后设10秒强制KILL兜底，并等待close。真实忽略TERM进程的强制退出测试通过。Python单独集成测试仍管理自己的服务组。
- 会话异常：释放锁、重置按钮、隔离旧会话回调；重连保留未保存编辑。宿主注入断线后x=9仍保留；关页重开可恢复草稿，运行输出27，最终还原x=4并保存，草稿移除。
- 草稿：同步原子写至 ~/.local/state/obsidian-marimo/drafts/<vault-hash>/，权限700/600；有恢复入口，基线变化时拒绝自动覆盖。
- 同文件编辑：重复原生打开复用标签页，其他Obsidian编辑视图存在时拒绝新开。外部变化保存前再次核对。文件系统监听由Obsidian处理，不额外使用vault.process进行第二次写入。跨应用并发写入并不作为已支持能力。
- 初始事件：仅ready后发送一次，stdio端到端测试通过。
- EPIPE与协议异常：监听stdin错误、结构化报错并结束会话。
- 删除/移动：release使用claim时返回的lease精确释放，不再对消失的文件realpath；旧异步claim的清理不能释放新文件的锁。构造失败返回结构化错误。
- 配置：空Python路径在加载和实际连接时均回退；最低Obsidian修正为1.13.0以匹配声明式设置。
- 输出：移除id/name，保留静态过滤。不采用“text/markdown一律交MarkdownRenderer”的建议：固定版本live输出已经是HTML，且宿主已验证。输出不会调用Markdown插件处理器。

宿主脚本 assets/verify-lifecycle.py 与 lifecycle-verification.json 为恢复/重连新增证据。不宣称跨平台与完整功能验收通过。

## 追加修订记录

- 2026-11-01：根据WorkBuddy独立审查补强原子保存、运行失败隔离、进程组清理、持久草稿与重连；新增边界及宿主回归。

## 文件点击与连接前预览修复

- 根因：原型只有命令/右键打开入口，未注册 `.py`；原 ItemView 使用 `filename` 自定义状态，未接入原生 FileView 文件关联。
- 改为 EditableFileView 和公开 registerExtensions API，使用标准 `state.file`；兼容旧 `filename`。已有其他 `.py` 关联时保留原关联。关联开关重载插件后生效。
- WorkBuddy交付标准库AST/tokenize解析器与18项测试。随后复核补3项回归：注释单元格保留、紧凑单行结构明确回退、非标准顶层业务代码不静默省略。解析不执行或导入用户源码。
- 连接前只读单元格预览；普通脚本只读源码。错误/不支持结构显示完整源码和原因，不展示部分Notebook。只有显式连接才启动marimo服务并解锁编辑。
- 预览进程使用 `-I -S`、15秒超时、输入5MiB/输出8MiB上限；换文件/关页取消解析。旧结果不更新新页。
- 修复无关文件重命名误触发当前Notebook处理；修复延迟claim回调错误释放新文件锁；修复Obsidian主题按钮样式覆盖hidden属性。

最终本机验证：21项Node、32项Python测试通过；typecheck/build通过。最新dist三文件已与Temp安装目录同步。

宿主回归脚本 `assets/verify-native-opening.py` 使用唯一命名的专用文件，通过后移入本机回收站；原demo只读打开，不改写。实际点击文件列表验证：预览4块且无后端；普通脚本无运行按钮；重复点击同文件仅1页；无关rename保持当前文件；点击连接、编辑运行上游后输出由12变21、点击保存成功；换文件后旧PID退出；旧filename状态恢复4块成功。最终返回原demo只读预览。完整结果：`assets/native-opening-verification.json`。宿主错误面板无错误。

本轮未commit、push或发布；不作为Windows/Linux或完整marimo功能通过的证据。
