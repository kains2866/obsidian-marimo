
> **历史文档（已归档）**：本文记录的是「在 Obsidian 中嵌入官方 marimo 网页编辑器」路线，**已由原生 Obsidian 前端 + marimo 后端路线取代**，不再执行。原文内容保持原样，仅添加本状态标注；归档说明见同级 `history/README.md`。

# marimo 嵌入与 Agent 接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 代码变更完成后按项目规则执行独立代码审查；不自动启用并行开发。

**Goal:** 在保持现有 ipynb 行为的基础上，新增可选的 marimo 官方编辑器视图，并让已授权 Agent 通过官方能力连接正确运行会话。

**Architecture:** 独立 marimo 环境、服务会话和视图；使用官方本地编辑器和 pair。所有权、路径、认证、保存和关闭保护由插件适配层管理；不建立通用执行服务器。

**Tech Stack:** 现有 TypeScript/Obsidian API、Node 子进程、Python 3.12、P0 验证后固定的 marimo 正式版本；Vitest、Python unittest、真实 Obsidian 宿主。

## Global Constraints

- 设计真源：[开发文档索引](../specs/2026-11-01-marimo-integration/README.md)。候选 marimo 0.25.2 尚未经验证，不能写死滚动文档里的全部能力。
- 保持插件当前 0.7.6 和最低 Obsidian 1.8.7；若需提高版本要求另行确认。
- 不修改 Jupyter 的文件模型、内核协议或输出过滤；不注册接管全部 `.py`。
- 不关闭安全保护或认证；不自动执行不可信代码；应用权限与 venv 不等于 OS 沙箱。
- 默认本机私有发现记录，不同步令牌；没有外部 Agent 自动启动插件服务的首版承诺。
- 不擅自 commit、push、tag、Release；每个阶段停在可核查结果，等待用户明确后续指令。
- 文档在工作区 ../docs，测试产物在 ../assets。新模块集中 src/marimo；未来修改构建后安装 Temp，不能重载用户未保存的文档。

## P0：先验证再锁定实现

### Task 0. 固定版本与真实嵌入报告

**Files:** Create `tests/marimo/host.integration.mjs`、`../assets/marimo-host-verification/capabilities.json`、`../docs/superpowers/specs/2026-11-01-marimo-integration/P0-验证记录.md`（执行时创建）。

**Consumes:** 候选正式版本 0.25.2、独立临时环境、标准 marimo 示例文件。
**Produces:** `MarimoCapabilities` 实测值、宿主版本与 G01–G07 的证据；不是产品代码。

- [ ] 在独立临时虚拟环境安装固定版本，不触碰主仓库或系统 Python。
- [ ] 保存下列探测的 stdout/stderr/exit code。pair 不存在属于能力结果，不是通过条件。

```text
<python> -I -m marimo --version
<python> -I -m marimo edit --help
<python> -I -m marimo pair --help
```

- [ ] 使用最小官方格式示例验证编辑、响应式运行、保存和标准文件再次打开：

```python
import marimo
app = marimo.App()

@app.cell
def _():
    import marimo as mo
    slider = mo.ui.slider(1, 5, value=2)
    slider
    return slider,

@app.cell
def _(slider):
    slider.value * 2
    return

if __name__ == '__main__':
    app.run()
```

- [ ] 真实 Obsidian 中验证认证 WebSocket、保存/未保存关闭、剪贴板/下载、隔离容器和进程停止；测试库先写断言再实现适配。
- [ ] 记录失败的响应头/握手/关闭行为，不输出 token。对照 G02–G07 作 go/no-go 判断，编辑运行交互与进程清理不能被省略。
- [ ] 只有 P0 通过，才把实际 marimo 版本、CLI 参数和保存信号写成下一任务的固定输入。未通过时提交阻断报告供用户审阅，不实现其余任务。

## P1：本地官方编辑器

### Task 1. 文件与版本能力边界

**Files:** Create `src/marimo/types.ts`、`src/marimo/file.ts`、`src/marimo/capabilities.ts`；Test `tests/marimo/file.test.ts`、`tests/marimo/capabilities.test.ts`。

**Consumes:** P0 报告；设计 03 中的 MarimoTarget、MarimoCapabilities。
**Produces:** `resolveMarimoTarget(vaultRoot:string,relativePath:string,environmentId:string):Promise<MarimoTarget>` 与 `probeMarimoCapabilities(python:string):Promise<MarimoCapabilities>`。

- [ ] 先写参数化失败测试：普通 `.py`、损坏内容、路径越界、目录链接、中文/空格路径、能力缺失。识别不得执行源码。
- [ ] 运行 `npx vitest run tests/marimo/file.test.ts tests/marimo/capabilities.test.ts`，保存 RED 结果。
- [ ] 实现 realpath/普通文件检查、静态 marimo 标记识别及受限 CLI 探测；无法验证来源时明确拒绝，不自动转成新文件。
- [ ] 相同命令通过；新增接口与设计契约逐项比对。

### Task 2. 可选环境安装

**Files:** Create `src/marimo/environment.ts`；Modify `src/marimo/settings.ts`（本任务创建基础设置）；Test `tests/marimo/environment.test.ts`。

**Consumes:** 固定版本能力探测，已有自有 Python provisioning 思路。
**Produces:** `ensureMarimoEnvironment(signal:AbortSignal,onProgress:(text:string)=>void):Promise<{python:string;environmentId:string;capabilities:MarimoCapabilities}>`。

- [ ] RED 覆盖未确认不安装、安装目标、下载取消/超时、半成品重试、权限与证书错误、窗口关闭后不启动后续步骤。
- [ ] 实现独立自有目录与安装确认，不自动变更 Jupyter 环境；安装过程复用已验证的跨进程 signal/进程取消处理。
- [ ] 运行 `npx vitest run tests/marimo/environment.test.ts` 至 GREEN；真实临时环境安装并检查精确版本与路径归属。
- [ ] 确认失败/取消后可重试，原文件与用户解释器不被删除。

### Task 3. 服务与会话生命周期

**Files:** Create `src/marimo/server.ts`、`src/marimo/sessions.ts`；Test `tests/marimo/server.test.ts`、`tests/marimo/sessions.test.ts`、`tests/marimo/runtime.integration.mjs`。

**Consumes:** MarimoTarget、环境信息、P0 验证的 CLI 选项。
**Produces:** 设计 03 的 `MarimoSessionManager`/`MarimoSessionHandle`；server 内部句柄不向网页暴露。

- [ ] RED 覆盖同文件启动去重、跨环境/跨窗口独占写者锁、取消、端口竞争、陌生服务、认证失败、旧 generation 晚到响应、多个标签释放、自有/外部进程区别。
- [ ] 使用 argv 和固定回环主机启动，检查真实认证响应；实现状态机、30 秒启动超时、3 秒优雅退出后自有进程树清理。
- [ ] 加入环境忙碌保护，确保运行/停止与安装卸载不能同时改写同一环境。
- [ ] 运行 `npx vitest run tests/marimo/server.test.ts tests/marimo/sessions.test.ts`；集成脚本分别模拟失败再重试，不使用用户主仓库。

### Task 4. Obsidian 标签页与保存保护

**Files:** Create `src/marimo/view.ts`；Modify `src/main.ts`、`src/marimo/settings.ts`、`src/i18n.ts`；Test `tests/marimo/view.test.ts`、`tests/marimo/host.integration.mjs`。

**Consumes:** session acquire/release、固定 origin、P0 保存与隔离方案。
**Produces:** 独立 `marimo-notebook` 视图、“新建 marimo Notebook”“用 marimo 打开”命令及中英状态。

- [ ] RED 覆盖创建不重名、普通 Python 不被接管、DeferredView、关闭中的视图、环境准备期间关闭、未保存退出、多窗口和外链导航。
- [ ] 实现薄视图与官方编辑器容器，不新增源码写入器或无权限约束的 JS bridge。
- [ ] 按 P0 得到的保存信号或明确人工确认实施关闭保护；未验证时不显示已保存。
- [ ] 运行 `npx vitest run tests/marimo/view.test.ts tests/main.test.ts tests/settings.test.ts`；在 Obsidian 实测 G02–G07 和 F06–F13。
- [ ] 审阅 P1 验证记录后，才考虑进入 Agent 首版；不把网页加载成功当作完成。

## P2：Agent 连接

### Task 5. 私有发现记录与目标核对

**Files:** Create `src/marimo/connection-store.ts`；Modify `src/marimo/sessions.ts`；Test `tests/marimo/connection-store.test.ts`、`tests/marimo/discovery.integration.test.ts`。

**Consumes:** sessionId、真实目标、PID/创建时间、能力值。
**Produces:** 设计 03 的 `MarimoConnectionStore`。

- [ ] RED 覆盖 token 不出现在 JSON/日志正文、目录权限、符号链接、过期/PID 复用、两个仓库同名 Notebook、记录原子写入。
- [ ] 实现本机应用数据中的私有记录/token 分离；过期清理只删自有文件，不终止不确定 PID。
- [ ] 将 store 接入 sessions：认证后 ready 才发布记录，状态变化更新记录，stopping 撤销可连接状态，停止/崩溃/取消时撤销记录并清理自有 token；写入失败不能把会话展示成 Agent 可连接。
- [ ] 联调验证从 manager.acquire 到 store.list 能发现正确会话，再从 manager.stop 到 store.list 无可连接旧记录。
- [ ] 运行 `npx vitest run tests/marimo/connection-store.test.ts tests/marimo/discovery.integration.test.ts`；Windows ACL 的实际结果单列，不能用 POSIX 测试替代。

### Task 6. 官方 pair 连接说明与协作核验

**Files:** Create `src/marimo/agent.ts`；Modify `src/marimo/view.ts`、`src/i18n.ts`；Test `tests/marimo/agent.test.ts`；Create `../docs/marimo-Agent使用说明.md`（实现时创建）。

**Consumes:** 已验证的 ready record、用户授权范围、官方 CLI 能力。
**Produces:** `MarimoAgentConnector.plan`、连接面板和按客户端区分的说明。

- [ ] RED 覆盖没有 pair、不存在 Notebook ID、认证失败、多个目标、external owner、命令参数空格/注入、只读授权不交付完整 pair 凭证，以及编辑可能触发响应式执行时的授权限制。
- [ ] 生成固定版本确实支持的 argv 和安全认证步骤；不启用 --no-token，也不为失败连接换目标。
- [ ] `npx vitest run tests/marimo/agent.test.ts` 至 GREEN；用实际可用 Agent 读取变量、修改并执行一个明确目标，核对保存与输出。
- [ ] 记录客户端/平台条件、用户与 Agent 同时编辑冲突；向知识库写结论使用已有工具，不能直接开放整个仓库权限。
- [ ] 没有相应客户端时记录未执行；不能宣称所有 Claude/Codex/OpenCode 已兼容。

## P1/P2 总体验收与交付

### Task 7. 回归、文档与发布准备

**Files:** Modify `tests/marimo/host.integration.mjs`、`.github/workflows/preflight.yml`、`README.md`、`README.zh-CN.md`；更新设计 04 的证据记录，不自动更改版本。

- [ ] 按 F/A 矩阵写缺失测试并确认其先失败，再补最小修复。
- [ ] 运行以下完整命令；预期全部 exit 0，跳过项必须逐项说明。

```bash
npm test
npm run lint
npm run typecheck
npm run build
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
git diff --check
```

- [ ] 新增集成测试命令由前述 Task 0/3 文件实现后执行；记录创建、保存、停止、卸载后实际 PID/端口与 token 清理结果。
- [ ] 独立代码审查重点覆盖路径/认证、保存完整性、任意代码执行边界、异常退出和对现有 ipynb 的影响。
- [ ] 备份 Temp 三文件，原子替换并验证 SHA-256；实机验证后给用户检查。
- [ ] 报告全部已执行/未执行项目和已知限制。用户未授权时，不 commit、push 或发布。

## 计划完成判定

此计划的完成不是文档里的复选框被预先勾选，而是对应代码、测试和宿主证据均存在。当前所有任务未执行。外部资料支持“可研究”，不支持提前宣布本项目已能嵌入、保存、连接或执行。
