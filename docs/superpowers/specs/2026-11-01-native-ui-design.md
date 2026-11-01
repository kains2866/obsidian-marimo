---
title: 原生 marimo 界面方案
created: 2026-11-01
updated: 2026-11-01
version: "0.1"
status: implemented
scope:
  - obsidian-marimo-notebook
---

# 原生界面方案

面向 Obsidian 原生视图的界面规范。目标不是复刻 marimo 网页编辑器，而是在 Obsidian 的排版与主题体系内，把「连接 → 编辑 → 运行 → 保存」这条链路表达清楚。

参考项目 `obsidian-ipynb` 只提供视觉与交互经验（紧凑工具栏、左侧运行入口、悬停条、状态组合），不复制其 Jupyter 后端协议，也不修改该项目。

## 设计原则

1. **状态必须无歧义。** 未连接时不允许出现「运行结束」这类暗示已经执行过的文案；连接前运行/保存不可用，而不是点了没反应。
2. **颜色只来自主题。** 所有颜色走 `var(--…)`，不写死十六进制；浅色、深色、第三方主题都跟随 Obsidian。
3. **原生语义优先。** 用 `setIcon`、原生 `button`、`aria-label`、`role="status"`；键盘可达，焦点可见。
4. **局部作用域。** 全部选择器挂在 `.marimo-native` 下，不用全局标签选择器，避免影响其他插件与笔记渲染。
5. **不给假入口。** 不支持的能力（图片、交互组件、新增单元格）不显示按钮，只显示一行说明。

## 一、顶部工具栏

单行紧凑布局，左侧动作、右侧环境与状态。粘性置顶，滚动时保持可见。

| 位置 | 控件 | 图标 | 可用条件 |
| --- | --- | --- | --- |
| 左 1 | 连接并允许运行 | `plug-zap` | 已识别为 marimo 且未连接 |
| 左 2 | 新增单元格 | `plus` | 已连接且未在运行（在选中单元格后或末尾插入） |
| 左 3 | 运行全部 | `play` | 已连接且未在运行 |
| 左 3 | 保存 | `save` | 已连接且未在运行 |
| 左 4 | 中断运行 | `circle-stop` | 已连接且正在运行；取消当前周期但保留会话与编辑 |
| 左 5 | 停止并断开 | `square` | 已连接或连接中 |
| 左 6 | 恢复草稿 | `history` | 存在本机草稿且已连接 |
| 右侧 | 环境标签 | `terminal` | 常显，`title` 显示完整 Python 路径 |
| 右侧 | 状态 | — | 常显，`role="status"`、`aria-live="polite"` |

- 连接按钮在连接成功后隐藏，由「停止并断开」接管，避免两个互斥入口同时出现。
- 运行全部、保存使用「图标 + 文字」；保存、停止为图标按钮，必须带 `aria-label` 与 `title`，避免只有图形没有名称。
- 忙（连接中、运行中、断开中）时所有动作按钮禁用，重复点击不产生第二次请求。
- 工具栏不显示 token、端口、完整路径；环境只显示可读名（如 `marimo (uv)`）。

### 状态文案

状态 = 阶段 + 修饰。阶段与修饰之间用 ` · ` 连接，修饰顺序固定，避免位置跳动。

| 阶段 | 中文 | 英文 | 语气 |
| --- | --- | --- | --- |
| disconnected | 未连接 | Not connected | 中性 |
| connecting | 连接中… | Connecting… | 强调 |
| stopping | 正在断开… | Disconnecting… | 强调 |
| running | 运行中… | Running… | 强调 |
| finished | 运行结束 | Run finished | 中性 |
| failed | 运行失败 | Run failed | 错误 |
| interrupted | 已中断 | Interrupted | 中性 |
| none | 尚未运行 | Not run yet | 中性 |

修饰：运行后又改过代码追加「代码已修改 / Code modified」；内容尚未写回文件追加「未保存 / Unsaved」，否则在已运行后追加「已保存 / Saved」。

运行中只显示「运行中…」，不叠加修饰。原因：运行期间单元格编辑与输出刷新会频繁触发状态更新，叠加修饰会造成文字抖动。

## 二、单元格

```
┌ 竖条 ┬ 运行 ┬──────────────────────────┐
│      │  ▶   │  代码区（灰底）            │
│      │      ├──────────────────────────┤
│      │      │  输出区（仅在有输出时出现）│
└──────┴──────┴──────────────────────────┘
```

- 左侧 34px 竖槽放运行按钮，网格列固定宽度，隐藏按钮时列宽不变，正文不左右跳动。
- 竖条贴在单元格左缘：悬停为中性灰（`--background-modifier-border-hover`），选中为强调色（`--interactive-accent`）。
- 代码区底色 `var(--background-secondary)`，可读性优先；不铺不透明纯色，避免深色主题下发灰。
- 代码区最小高度按字体尺寸计算，短单元格不塌陷；内容多时自然增高，不出现内部滚动条。
- 输出区与代码区分隔（上边框），仅在存在输出时显示内边距与边框，空输出不占位。
- 容器不使用 `overflow: hidden`，避免裁掉 CodeMirror 的焦点环与光标。
- 只读状态（连接前预览、普通脚本）隐藏运行按钮，但仍保留源码与行号，可选中复制。

### 可访问性

- 运行按钮：`setIcon('play')`，`aria-label` 为「运行此块 / Run this cell」，同时设 `title`。
- 单元格聚焦或点击即选中，选中态可被视觉识别，键盘 Tab 依次进入每个运行按钮与编辑器。
- `:focus-visible` 使用 2px 强调色描边 + 2px 偏移；不使用 `outline: none` 抹掉焦点。
- 状态与错误提示使用 `role="status"` / `role="alert"`，屏幕阅读器可感知变化。

## 三、输出渲染

| 类型 | 处理 |
| --- | --- |
| `text/plain` | `<pre>` 保留换行，`overflow-wrap: anywhere` |
| `text/markdown` / `text/html` | 经 `sanitizeHTMLToDom` 清洗后插入 |
| `image/png` `image/jpeg` `image/gif` `image/webp` | base64 校验后以 `data:` URL 渲染 `<img>`，SVG 与远程图片一律拒绝 |
| HTML 内 `<img>` | 仅保留 `data:image/(png\|jpeg\|gif\|webp);base64` 来源，其余删除 |
| stdin 通道（`input()`） | 渲染等宽输入框与发送按钮；回答后行内替换为 `> 回答`，值经 `POST /api/kernel/stdin` 送回内核 |
| `application/vnd.marimo+traceback` | 同 HTML 路径，错误用 `--text-error` 着色 |
| `application/vnd.marimo+error` | 纯文本，逐条错误信息 |
| 其他（交互组件、JSON、音视频等） | 一行说明「此输出类型尚未适配：<mime>」，不渲染空容器、不放按钮 |

安全过滤保持不变：脚本、样式、iframe、图片、音视频、表单控件、SVG、MathML 一律移除；`style`、`class`、`id`、`name`、`src`、`href`、`action` 与 `on*` 属性移除；`colspan`/`rowspan` 等表格属性保留。

表格处理：外层容器 `overflow-x: auto`，表格自身 `max-width: none` 并按内容撑开，横向滚动发生在输出区内部，不撑破 Obsidian 视图宽度。

## 四、布局与主题

- 视图根容器 `overflow-y: auto`、`overflow-x: hidden`、`box-sizing: border-box`。
- 字号使用 `--font-text-size`、`--code-size`、`--font-ui-small`、`--font-ui-smaller`，不写 px 固定字号。
- 窄窗口（`max-width: 650px`）：左右内边距减到 8px，竖槽减到 28px，工具栏允许换行，环境标签截断。
- 深色主题：不使用任何浅色假设；对比度依赖主题变量，必要时用 `color-mix` 与背景混合，仍以主题色为基。
- 触屏（`hover: none`）：竖条常显，保证可发现性。

## 五、第二轮完善（已实施）

参考 `obsidian-ipynb` 的前端经验补充五项打磨，全部不触碰后端协议与保存流程：

1. **单元格焦点环。** 选中或键盘聚焦的单元格在强调色边框外再加 1px 强调色光晕（`box-shadow: 0 0 0 1px var(--interactive-accent)`），选中感比仅换边框色更明确。单元格 DOM 重建（如连接后重渲染）会恢复此前的选中态。
2. **活动行高亮。** 代码编辑器启用 `highlightActiveLine`/`highlightActiveLineGutter`；仅在编辑器持有焦点时以 `--background-primary` 提亮当前行，非聚焦时透明，与代码区灰底区分。
3. **错误输出着色。** 控制台 `marimo-error` 通道与 `application/vnd.marimo+traceback`、`application/vnd.marimo+error` 输出加 `is-error` 类，统一使用 `--text-error`，与普通输出区分。
4. **单元格运行状态。** `cell-op` 事件的 `status`/`stale_inputs` 映射为单元格状态：`running` 时运行按钮图标换为旋转的 loader；`queued`/`disabled-transitively` 减淡；`stale_inputs` 仅把空闲单元格标记为过期（运行按钮变灰）。断开或停止会清除全部状态并恢复 play 图标，动画遵守 `prefers-reduced-motion`。
5. **原型提示收纳。** 「实验原型 · 连接会启动本地 Python…」提示仅在文件已识别为 marimo 且未连接时显示；连接后隐藏，断开后恢复；普通 Python 脚本永不显示。

## 六、不改动的部分

- 不嵌 iframe/webview，不引入 marimo 网页资源。
- 不做拖拽排序与交互组件；单元格新增/下方插入/上移/下移/删除与图片输出已实现，交互组件、数据库/AI/Agent/Properties 功能仍不做。
- 不改变后端协议、文件格式与保存流程（仍由官方服务生成标准 `.py`）。
- 不接管其他插件的 `.py` 关联；普通 Python 脚本永不自动执行。
- 生命周期修复（静态解析可取消、generation 隔离、writer lease 精确释放、无关 rename 不影响当前文件、换页清理自身进程）保持原样。

## 修订记录

- 2026-11-01：建立本方案，作为原生前端 UI 完善的实施依据。
- 2026-11-01：状态改为 inProgress；方案已定，宿主验证仍在进行。
- 2026-11-01：宿主验证与截图完成（含会话守卫 U2b），状态改为 implemented。
- 2026-11-01：第二轮完善（参考 obsidian-ipynb 样式）：焦点环、活动行、错误色、单元格状态与提示收纳，见「第二轮完善」。
- 2026-11-01：第三轮运行时能力：图片输出（含 HTML 内 data URL 白名单）、`input()` 输入框、中断运行按钮与 `interrupted` 状态；工具栏与输出表已同步。
- 2026-11-01：第四轮单元格结构编辑：工具栏「新增单元格」与悬停操作组（下方插入/上移/下移/删除，按位置禁用），结构变化只改动单个行，不清空其它单元格的输出；草稿恢复按单元格身份重建，不再按下标对位。
