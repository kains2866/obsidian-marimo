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

## 运行时能力（图片 / stdin / 中断）

- 协议核对：中断不是 `completed-run` 的 outcome，而是独立的 `interrupted` 事件，随后的 `completed-run` 仍为 `succeeded`——视图按此顺序处理；`input()` 走 console 的 `stdin` 通道，答案经 `POST /api/kernel/stdin`（`{text}`）返回。
- 适配层改造：run/save 移入后台任务，读取循环保持应答 `interrupt`/`stdin`；`ready` 在握手后立即发布、首个周期流式转发——启动即调用 `input()` 的笔记本不再死锁（此前会等待 90s 超时后断开）。
- 真实后端集成测试：stdin 往返（启动期提示→回答→下游 Markdown 显示答案）、中断（20s 睡眠在 1.2s 被取消、会话保留、后续 run 正常）。38 项 Python / 59 项 Node 全部通过。
- 宿主实证（独立 fixture，含纯标准库生成的 320x120 PNG，不装 matplotlib）：图片渲染、启动期 `input()` 回答、中断后状态「Interrupted · Unsaved」且可继续运行，全部通过；`verify-native-opening.py` 回归通过。期间发现并修复：`completed-run` 后未刷新按钮可用性，导致运行结束后运行按钮保持禁用。
- 证据：`assets/verify-runtime-features.py`、`assets/runtime-features-verification.json`、`assets/ui3-image-input-interrupted.png`。
- 仍属边界外：`mo.ui.*` 交互组件、数据库/AI 面板。

## 界面完善第二轮（参考 ipynb 样式）

针对「焦点环 / 活动行 / 错误色 / 单元格状态 / 提示收纳」五项的原生宿主实证（专用 fixture，不改用户 demo）：

- 连接、运行（含故意 ValueError）、停止全部通过；错误输出颜色实测等于主题 `--text-error`（浅/深两套主题均核对）。
- 宿主实时观察到单元格 `running` 状态与 `lucide-loader-2` 旋转图标（sleep 1.2s 的单元格）；停止后无残留状态与图标。
- 焦点环与活动行以真实鼠标点击验证（后台窗口无法获得 DOM 焦点，`view.focus()` 不可靠，须用受信输入事件）。
- 期间发现并修复一个缺陷：连接重渲染单元格后选中态丢失，现已在重建后恢复。
- 证据：`assets/verify-ui-polish.py`、`assets/ui-polish-verification.json`、`assets/ui2-light-connected.png`、`assets/ui2-dark-error.png`、`assets/ui2-narrow.png`。
- 附带发现：连接时 marimo 可能创建 `<notebook>.py.json` 布局旁车文件；带布局文件时保存仍按既有规则拒绝。

最终本机验证：Node 53 项、Python 32 项测试通过；typecheck/build 通过；`verify-native-opening.py` 全量回归通过；最新 dist 三文件与 Temp 安装目录 sha256 一致。

## 单元格结构编辑（新增 / 插入 / 排序 / 删除）

`assets/verify-cell-editing.py`，一次性 fixture `marimo-cells-<id>.py`，用后入回收站：

- 工具栏「新增单元格」与每个单元格的悬停操作组（下方插入/上移/下移/删除）存在且带 `aria-label`；首行禁用「上移」，末行禁用「下移」。
- 新增空单元格聚焦编辑器；输入 `10 * 4` 运行后输出 40。在首块下方插入 `x + 100`，输出 102。
- 将新增块上移一位后，DOM 与模型顺序一致；删除原依赖块后其余单元格的输出（6/102/40）保持不丢——结构操作只改动单个行，不整体重渲染。
- 保存后文件内单元格顺序与编辑器顺序一致（`x = 2` → `x + 100` → `10 * 4`），被删除的 `x * 3` 不在文件中，`dirty` 复位。
- 真实鼠标悬停（CDP `Input.dispatchMouseEvent`）后操作组 `opacity:1`、`pointer-events:auto`，截图 `ui4-cell-editing.png`。
- 未保存的结构编辑（新增块 + 改码）在「停止并断开」后重新连接自动恢复，重建的新块使用全新 id，不与旧会话冲突。

协议实证（marimo 0.25.2）：`/api/kernel/run` 对未注册 id 自动注册；`/api/kernel/delete` 对已注册 id 触发一个响应周期、对未注册 id 静默忽略——适配层只在已注册时调用并等待 `completed-run`，未注册块仅本地删除；保存顺序完全按请求中的 `cellIds`，代码签名由 codegen 从代码推导，新块名字用 `_` 即可。

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

## mo.ui 原生控件（P0）

结论：`mo.ui.*` 的输出是 `<marimo-ui-element object-id>` 包裹一个组件元素，全部状态在 `data-*` 属性里（JSON 编码，再经 HTML 实体转义）。宿主 `sanitizeHTMLToDom` 会剥掉未知自定义元素，因此控件必须在净化**之前**从原始 HTML 抽取（`extractUiElements`），以 `data-widget-slot` 占位符过净化，再挂载原生控件。已实证的交互（全部真实输入）：滑块用鼠标点击轨道（level 3→8，读数与 DOM 同步）、下拉用键盘 type-ahead（alpha→beta）、文本用真实键入加失焦提交（hi→there）、复选框用鼠标点击（False→True）；每次回写触发一轮响应周期、以 `completed-run` 结束，下游单元格输出自动更新，会话保持可用。

- 支持：slider、range-slider、number、text、text-area、checkbox、switch、radio、dropdown、multiselect、date、datetime、button、tabs、form、table（只读）。form 提交把内部元素当前值发给表单的 object id，与上游 `_convert_value`（`element._update_value`）一致；tabs 发送索引字符串；下拉/多选发送选项名数组；button 发送点击计数。
- 回写通道：`POST /api/kernel/set_ui_element_value`（`objectIds`+`values`），适配层在 `_cycle_lock` 内等待整轮周期；无依赖元素的控件同样会正常结束周期（真实内核测试覆盖，避免挂在等不到 `completed-run` 的假设上）。
- 并发：同一控件的多次改动合并为最新值后逐个发送；控件周期期间 run/save/结构操作被禁用；会话异常或断开时清空待发队列。
- anywidget 静默：marimo 会从普通 `import marimo as mo` 单元格发出一个无标签的内部 anywidget 占位（两个独立 fixture 均复现），若显示「未适配」说明，则每个笔记本都会出现噪音；其余未支持类型（file、data-editor、data-explorer、file-browser、code-editor、matrix、dict、date-range）显示类型说明，且不渲染任何死控件。
- 表格只读：按 `data-data` 双重编码的行数据渲染，超过 50 行注明总数；选择、筛选、下载未实现。
- 控件所属单元格被显式重跑时输出会重建（与输出刷新同一机制）；仅改动控件值不重发控件单元格的输出，因此输入焦点不会在回写周期中丢失。

证据：`assets/verify-ui-elements.py`、`ui-elements-verification.json`、`ui5-widgets-light.png`、`ui5-widgets-dark.png`；fixture 用后移入回收站，Temp 回到 demo 只读预览、无后台进程。测试：`tests/ui-elements.test.ts`（属性解码、抽取、标签、选项、表格、值形状）、`tests/test_widgets.py`（真实内核回写 4 项）。Node 81 项、Python 51 项全部通过；typecheck/build 通过；dist 三文件与 Temp 安装 sha256 一致。

本轮仍未验证：plotly/altair 等富交互输出、表格选择回写、`mo.ui.refresh`、Windows/Linux；多列布局（`column`）仍未渲染。

## 单元格能力（P1）

结论：`/api/kernel/set_cell_config` 每次调用都恰好关闭一轮 `completed-run`（即使没有任何单元格变得陈旧），因此适配层与控件回写同样在周期锁内等待；`disabled` 会让下游收到 `disabled-transitively`，重新启用只把下游恢复为 `idle` 并保留其上次的值（不会自动重跑）。内核几乎不会主动推送 `stale_inputs`——它只在 `autoRun=false` 的实例化等场景出现——因此"陈旧"由视图在代码变化时本地标记、在收到该单元格的执行状态时清除，这让"运行陈旧"对应真实场景（编辑过但未执行）。

- 配置回写：`POST /api/kernel/set_cell_config`（`configs: {cellId: 部分配置}`），适配层校验键与类型（`column` 拒绝布尔值——Python 里 `bool` 是 `int`），本地配置仅在内核接受后更新；`save()` 从这份本地配置生成 payload，实测 `hide_code=True`、`column=0` 均能写入文件。
- 格式化：`/api/kernel/format`（`codes` + `lineLength`）为纯服务调用，无周期；适配层对返回代码逐个 `compile`，坏 formatter 不会替换可用代码。视图用整段替换写回编辑器，保留撤销历史；格式化不执行代码，单元格保持"陈旧"。
- 补全：`/api/kernel/code_autocomplete` 只确认请求，答案以 `completion-result`（按请求 id 匹配）出现在 WebSocket 上；适配层在周期锁内等待并转发无关事件，超时返回空列表（不关会话）。CodeMirror 以 `autocompletion({override})` 接入，实测输入 `import ma` 弹出含 marimo 的选项。
- 快捷键：CodeMirror 键位映射覆盖 Shift+Enter；Cmd/Ctrl+Enter 会被 Obsidian 编辑器全局热键先行吞掉，必须注册在插件自己的 `Scope`（`app.keymap.pushScope`，仅当前视图激活时生效），`View` 本身没有 `scope` 属性。
- 单元格菜单：宿主 `Menu` 在本环境完全不渲染（右键菜单也不出现），改为自绘行内 popover（点击外部/Escape 关闭）。
- 宿主实证（`assets/verify-editing.py`，全部真实输入）：Cmd+Enter 运行（base 2 → doubled 4）、Shift+Enter 运行并聚焦下一格、编辑后出现本地陈旧标记且"运行陈旧"只跑该格（base 3 → doubled 6）、格式化把 `base    =   7` 规整为 `base = 7`、隐藏代码后编辑器高度为 0 且保存的文件含 `hide_code=True`、禁用后本格运行按钮禁用且下游 `data-cell-status="disabled"`、展开输出移除钳制、补全弹出 9 个含 marimo 的选项。截图 `ui6-editing-light.png`、`ui6-editing-dark.png`；证据 `editing-verification.json`。fixture 用后入回收站，Temp 回到 demo 只读预览、无后台进程。

测试：`tests/cell-config.test.ts`（配置解析/合并/线格式/呈现）、`tests/test_editing.py`（真实内核：配置周期与保存、禁用语义、格式化校验、补全、关闭拒绝）、`tests/cells.test.ts`（nextCellId）、`tests/status.test.ts` 与 `tests/session-guard.test.ts`（runStale/format 可用性）。Node 89 项、Python 61 项全部通过；typecheck/build 通过；dist 与 Temp 安装 sha256 一致。

本轮仍未验证：多列布局渲染、`hide_code` 单元格在未连接时的呈现、补全在长会话中的性能、Windows/Linux。

## Markdown 单元格自动渲染（P2）

结论：marimo 0.25.2 对 `mo.md()` 单元格输出 `text/markdown` MIME、内容为预渲染 HTML（`<span class="markdown prose …">`，LaTeX 包裹为 `<marimo-tex>||[…||]</marimo-tex>`）。静态 `mo.md(<字符串字面量>)` 单元格改为由 Obsidian 自己的 Markdown 引擎本地渲染，Python 包装折叠隐藏；f-string 等动态 md 单元格保持普通代码单元格，其 `text/markdown` 输出走净化 HTML 管道并先把 `||(||)` 分隔符还原为 `$…$`（`marimo-tex` 自定义元素过不了净化器）。隐式顶层字符串单元格内核按 repr 输出，不视为 markdown，视图不与其分歧。

- 解析器 `src/markdown-cell.ts`：仅接受单个 `mo.md(<literal>)` 表达式（允许前后整行注释）；支持三引号（渲染前 dedent）、转义解码、raw 前缀、f-string 无插值（`{{`→`{`）；插值、多语句、多参数、未闭合一律拒绝（保持代码单元格）。
- 视图：markdown 行预览先行、源码折叠；点击预览或 `<>` 按钮展开源码，折叠时重绘预览；编辑防抖 250ms 重解析，改为非 markdown 时回退普通单元格并清空旧预览；渲染竞态按单元格序号防护，失败兜底纯文本；连接重建行后内核 `text/markdown` 输出被抑制避免重复渲染，console/错误照常。
- 设置项「自动渲染 Markdown 单元格」（默认开，重载生效）。
- 期间发现并修复：非 markdown → markdown 往返编辑后容器注册被删，预览永久空白——现重新挂载行内预览元素。
- 宿主实证（`assets/verify-markdown-render.py`）：只读未连接即渲染（标题/粗体/列表/KaTeX 公式 `e^{iπ}+1=0`/内链 `[[demo-note]]`、编辑器高度 0）；f-string 单元格保持代码态且运行后显示 `n=2`；markdown 行内核输出抑制（display 空）；点击预览展开源码、`<>` 按钮折叠；编辑源码预览实时追加条目；改为 `x = 1\nmo.md(...)` 回退代码单元格、改回后重新渲染。截图 `ui7-markdown-light.png`、`ui7-markdown-dark.png`；证据 `markdown-verification.json`。fixture 与首次失败运行的孤儿进程/文件均已清理，Temp 回到 demo 只读预览。
- 测试：`tests/markdown-cell.test.ts` 10 项、`tests/output-policy.test.ts` 增 marimo-tex 还原。Node 100 项、Python 61 项全部通过；typecheck/build 通过；dist 三文件与 Temp 安装 sha256 一致。

本轮仍未验证：markdown 单元格内引用 vault 图片的相对路径解析、`mo.md` 多段拼接（`mo.as_html`）、Windows/Linux。

## 恢复草稿修复（报错「Recovery draft is invalid」）

结论：报错不是草稿损坏，而是读取校验与写入规则自相矛盾——结构编辑（插入/删除单元格）后的合法草稿本来就允许 cells 数与文件基线数不同（`write` 接受不对称，`read` 却强制相等），导致"结构编辑后未保存 → 重开"这条路径必然报错。

- `read()` 放宽为仅校验类型（filename 匹配、cells/baseCodes 数组、id/code 为字符串），不再比较长度；损坏数据仍抛错（测试覆盖）。
- 草稿复活修复：trash 文件后 leaf 关闭，`onClose` 里的 dirty 写回会重新生成刚被清理的草稿——新增 `persistDraft()` 守卫，文件已不在 vault 时不再写草稿。`stop`/`disconnect`/`onRename`/`releaseFileSession` 四处统一走该守卫。
- 恢复入口改进：只读预览（未连接）即读取草稿并显示「恢复草稿」按钮，点击无会话时提示"连接后可恢复"，不再静默无反应；`status.ts` 的 restore 可用性同步调整。
- 残留清理：草稿目录堆积 13 个历史草稿（fixture 已删但草稿被上述 bug 复活），备份至 `/tmp/marimo-drafts-backup-20261101` 后清空。
- 宿主回归（`assets/verify-draft-fix.py`）：结构编辑→停止→重开无报错、恢复按钮出现、点击后 3 个单元格与代码 `extra = 1` 恢复正确、trash 后草稿不复活。Node 102 项通过；typecheck/build 通过。

## 单元格菜单对齐原生（P2）

对照 marimo 原生 `...` 菜单补齐：**拆分单元格**（光标处一分为二，`splitCellCode` 纯函数保证两侧不丢字符、切口空行收敛，下半进入新建单元格并注册内核）、**单元格内格式化**（`format` 请求按单格 codes 发送）、**清除输出**（本地清空 display/console，代码与状态保留）、**移到最前/最后**（本地排序 + DOM 移动，保存时决定文件顺序）、菜单分组分隔线与快捷键提示（macOS ⌘⇧N 格式，`Platform.isMacOS` 区分）。

- 快捷键：Mod+Shift+9/0（上移/下移）、Mod+Shift+1/2（最前/最后）注册在 CodeMirror 键位；宿主实测 CDP 派发 Meta+Shift+1 后末格移至最前。
- 菜单验证（`assets/verify-cell-menu.py`）：10 个菜单项齐全、分隔线≥2、kbd 提示 ⌘⇧1/⌘⇧2、清输出后 display/console 为空、光标拆分 `a = 1`/`b = 2`、菜单移到最前/最后后 DOM 与模型一致。截图 `ui8-menu-light.png`、`ui8-menu-dark.png`；证据 `cell-menu-verification.json`。
- 未做（记录差异）：Convert to Markdown/SQL（自动渲染已覆盖 md 编辑体验；SQL 依赖 duckdb 内核，另行评估）、Name 重命名（需代码生成器支持，另行评估）、Copy link to cell（Web 专属，不适用）。
- 测试：`tests/cells.test.ts` 增 splitCellCode 8 断言。Node 102 项、Python 61 项通过；typecheck/build 通过。

## 能力演示 notebook 与新建入口

**marimo-showcase.py（`docs/examples/`，副本在 Temp vault）**：一个文件覆盖反应式数据流、16 种 `mo.ui` 控件、`mo.state`、`mo.ui.form`、`mo.ui.tabs`、`mo.ui.table`、`mo.sql`（duckdb + polars）、控制台输出、结构化返回、`mo.stop` 守卫、`mo.callout`，以及由 Obsidian 引擎渲染的静态 markdown（KaTeX 行内与块级公式、表格、任务列表、引用、内链）。已用 `marimo export html` 确认在 0.25.2 下无单元格失败；`marimo export` 环境没有 pandas/numpy/matplotlib，示例刻意只用标准库 + polars/duckdb。

- 宿主实证（`assets/verify-showcase.py`）：39 个单元格全部连接运行成功；16 种控件全部挂载为原生控件（`.marimo-native-widget` 按 kind 计数）；无 `marimo-native-unsupported`、无错误输出；SQL 结果表（region/销售额 3 行）与 `mo.ui.table`（4 行）正常；滑块 3→5 触发下游 md 重算、按钮点击 `mo.state` 0→1 次、tabs 切到「细节」面板；静态 md 折叠 9/9，KaTeX、任务列表、内链（`[[marimo-native-demo]]`）渲染。截图 `ui9-showcase-{preview,widgets,form,table,prose}-light.png` 与 dark 两张；证据 `showcase-verification.json`。

**新建 marimo notebook 入口**：侧边栏 ribbon 图标、命令面板命令、文件浏览器文件夹右键菜单三处入口；创建 `Untitled marimo[ n].py`（命名规则 `nextNotebookPath`，绝不覆盖已有文件），写入最小模板，打开原生视图并**自动连接**（`MarimoView.autoConnect()` 等预览就绪后直接 connect，超时 15s 放弃而非死等）。

- 期间修出一个真实缺陷：range-slider 分支在数组字面量初始化器里引用自身（TDZ），首个 range-slider 一渲染就把整个会话弄断，且 bridge 的 catch 会把视图层异常误报成「Invalid marimo adapter response」。修复：去掉多余 `bounds.push`；bridge 把「协议解码失败」（关会话）与「帧分发异常」（console.error，会话继续）分开。
- 宿主实证（`assets/verify-new-notebook.py`）：命令、ribbon、folder 右键菜单均注册；点菜单创建文件、模板内容正确、视图打开、内核自动启动并 `Run finished`；停止→回收→无草稿残留。证据 `new-notebook-verification.json`。
- 测试：`tests/notebook-file.test.ts`（模板结构与命名规则 5 项）。Node 109 项、Python 61 项通过；typecheck/build 通过。

**残留清理**：`__marimo__/session` 下 23 个会话缓存（fixture 已删，marimo 连接时会重建）、`/tmp` 草稿备份与探针目录；Temp 回收站内容属于其他项目，未动。

仍未验证：showcase 在 Windows/Linux、真实鼠标拖动滑块（用其 change 事件代替）。
