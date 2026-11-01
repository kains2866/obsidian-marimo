---
title: Agent 接口与协作契约
date: 2026-11-01
status: designReview
---

> **历史文档（已归档）**：本文记录的是「在 Obsidian 中嵌入官方 marimo 网页编辑器」路线，**已由原生 Obsidian 前端 + marimo 后端路线取代**，不再执行。原文内容保持原样，仅添加本状态标注；归档说明见同级 `history/README.md`。

# Agent 接口与协作契约

本文所有自定义接口是拟议 TypeScript 内部契约，并非现有 MCP 工具或开放网络端点。

## 三类官方能力的使用判断

| 官方能力 | 设计用途 | 约束 |
| --- | --- | --- |
| `marimo pair` | 外部 Agent 查看运行状态、编辑和执行 | 固定版本实际探测；使用确切 Notebook ID |
| marimo MCP | 按官方版本暴露的上下文能力连接 | 实验性；不能承诺等价于完整 pair 编辑执行 |
| 官方 AI assistant / ACP 面板 | 保留给使用官方编辑器的用户 | 不作为首版依赖；客户端和平台要求单独说明 |

首版不收集用户模型 API key，不代建云账号，不把知识库发送到模型。用户已有 Agent/模型配置继续管理其数据传输。连接 Agent 与启用 notebook→Agent 错误消息是两个授权，不默认开启后者。

## 身份和状态契约

```ts
export type MarimoState =
  | 'idle' | 'provisioning' | 'starting' | 'connecting' | 'ready'
  | 'disconnected' | 'stopping' | 'stopped' | 'canceled' | 'failed';
export interface MarimoTarget {
  vaultId: string;
  relativePath: string;
  realPath: string;
  environmentId: string;
}
export interface MarimoCapabilities {
  version: string;
  embeddedEdit: boolean;
  authenticatedConnect: boolean;
  pair: boolean;
  notebookDiscovery: boolean;
  savedState: 'supported' | 'manual-confirmation' | 'unverified';
}
export interface MarimoConnectionRecord {
  schema: 1;
  sessionId: string;
  target: MarimoTarget;
  origin: string;
  notebookId?: string;
  state: MarimoState;
  capabilities: MarimoCapabilities;
  owner: 'plugin' | 'external';
  pid: number;
  processStartedAt: string;
  updatedAt: string;
  expiresAt: string;
  tokenFile?: string;
}
export interface AgentConnectionPlan {
  sessionId: string;
  notebookId: string;
  argv: string[];
  authentication: 'private-token-file' | 'official-interactive';
  permissions: readonly ('read' | 'edit' | 'execute')[];
  limitations: readonly string[];
}
```

`record` 仅保存于设备本机应用数据目录中，POSIX 目录 0700、敏感文件 0600；Windows 使用当前用户私有目录并验证 ACL 行为。记录不放 `.obsidian`、笔记、Git 或同步目录。连接说明可显示非敏感身份；不能把 `tokenFile` 内容包含在普通输出中。

token 文件单独存储，拒绝符号链接与宽松权限；文件由当前用户拥有。清理仅针对自己创建的记录和文件，不删除用户的 CLI 配置。过期记录清理不能终止未确认所有权的 PID。

## 拟议内部 API

```ts
export interface MarimoSessionHandle {
  readonly record: MarimoConnectionRecord;
  release(): Promise<void>;
}
export interface MarimoSessionManager {
  acquire(target: MarimoTarget, signal: AbortSignal): Promise<MarimoSessionHandle>;
  list(): readonly MarimoConnectionRecord[];
  stop(sessionId: string, reason: 'user' | 'unload' | 'environment-change'): Promise<void>;
}
export interface MarimoConnectionStore {
  write(record: MarimoConnectionRecord): Promise<void>;
  list(vaultId?: string): Promise<readonly MarimoConnectionRecord[]>;
  remove(sessionId: string): Promise<void>;
}
export interface MarimoAgentConnector {
  plan(record: MarimoConnectionRecord, permissions: AgentConnectionPlan['permissions']): Promise<AgentConnectionPlan>;
}
```

`acquire` 在未授权安装、信任未通过、文件不在仓库、环境忙碌时返回明确失败，不能通过参数绕过。`stop` 不能终止 external owner；`plan` 必须拒绝未就绪、过期、没有 pair 能力或缺少 notebookId 的记录。

`permissions` 是用户授权意图，不是假设官方 token 支持这些细粒度 scope。首版只有用户接受 pair 所需的完整读取、编辑、执行能力时才交付 pair 连接；只读请求走已有静态工具或经版本验证的只读接口，不生成完整 pair 凭证。不能靠命令文案限制持有 token 的客户端。编辑本身可能触发响应式执行；未取得执行授权时，不允许把 live 编辑包装成“只改不运行”。

这些内部 API 不自动成为外部网络服务。与外部 Agent 的首版连接以官方 CLI 和已有 Obsidian 工具为边界。

## Agent 从 Obsidian 发起任务

1. 使用用户已授权的文件/Obsidian 工具发现目标，得到仓库与相对路径。
2. 若有活动会话，只选路径、环境均匹配的记录；多目标时请用户明确选择，不按“最近打开”猜测。
3. 核对进程身份、认证握手和官方 Notebook ID，不能仅凭 localhost URL 判定目标正确。
4. 用户授权实际连接能力后，生成固定版本支持的官方命令参数。程序调用使用 argv，不拼接 shell 字符串。
5. 读取单元格和当前运行状态，再修改；编辑成功、保存成功、执行成功分别记录。
6. 需要更新 Markdown 结论时，使用已有 Obsidian/文件工具；遵守原项目的笔记规范与索引规则。
7. 完成后报告源文件、改动、运行状态、关键结果和未验证事项；按用户选择断开或保留会话。

没有可用会话时，若已有 Obsidian 连接器能调用明确的打开命令则走现有连接器；否则提示用户打开文件。Agent 自行通过官方 CLI 启动的服务归 external，不暗中登记成插件拥有。

## Agent 直接操作 marimo

允许 Agent 在既定授权下使用官方 CLI，与 Obsidian 是否聚焦无关。用户关闭 Obsidian 也不能承诺会话继续：若服务由插件拥有，退出时的保留/停止规则必须明确；若 Agent 需要独立长期运行，应使用自己拥有的 external 服务。

现有 `.py` 文件可由 Agent 静态修改，但不能把文本修改当作 live kernel 已同步。活动编辑期间优先使用 pair；不支持 pair 时，不伪装为完整 Agent 模式。外部文本更新必须经官方 watch/冲突机制处理。

## 协作与结果核验

- 修改前读取当前源码/单元格状态；运行前再次核对目标和版本，发现用户同时编辑则重新读取，不覆盖旧快照。
- Agent 执行依赖官方返回的状态和实际输出，不依据按钮状态或文件更新时间宣称成功。
- 同一个调用不得在失败后自动改目标、换环境、扩大目录范围或关闭认证。
- 安装包、导出并执行输出、批量文件修改都属于独立能力；只有在用户现有授权覆盖时执行，不因为“已连接 Agent”自动开放。
- 能力未知、命令不存在、token 过期、服务重启、Notebook ID 改变都明确失败并重新发现原目标。

## 本机发现的能力边界

私有目录只隔离不同系统用户，不阻止同一用户运行的程序。Agent 连接权限属于工作流与客户端约束；持有可执行 Python 会话的 Agent 并非被文件白名单限制住的操作系统沙箱。

P2 首版交付连接信息和指南，不自动配置所有客户端。Claude Code、Codex、OpenCode 的 shell、消息入口和平台条件分别验证；普通聊天网页若无工具执行能力，不能仅靠一个链接获得同等控制。
