# 后续优化清单

这份清单记录当前 SVG 编辑器后续可以继续推进的优化点。优先级按“稳定性和维护收益”排序。

## P0：功能回迁（旧版有、当前缺失）

> 来源：与旧版本（v1.0 ~ v6）逐文件对比，并用关键词反向核验（`localStorage`、`MathJax`、`rotate`、`PathEditor`、`clipboard`、`clipPath` 等在 `src/` 命中数均为 **0**）。
>
> ⚠️ **参考代码已删除**（`archive/` 已于 2026-10-07 清理）。下表中的 `v3:1612`、`v4:1447`、`v6 draft-manager.js` 等是历史指针，仅供定位当时的实现思路，**代码已不可访问**。
> - **P0 五项已于 2026-10-07 全部完成**，见下方表格；相关实现位置一并列出，方便日后改动。
> - **P1 项需要从零实现**：路径控制点编辑（原 ~250 行）、圈选（原 ~200 行）、旋转的 transform 解析、MathJax 集成。没有现成参考，成本已包含在下面的难度评估里。

### P0：必须修（卡核心场景 / 现存 bug）—— 已完成（2026-10-07）

| # | 缺口 | 实现位置 |
|---|---|---|
| 1 | **SVG 片段自动包裹导入** | `src/svg.ts` `extractSvgMarkup`：无 `<svg>` 根节点时，从第一个 SVG 图元（`SVG_ELEMENT_START`）截取并补上带 `viewBox="0 0 800 600"` 的根节点。片段仍走 `sanitizeSvg` 清洗 |
| 2 | **定义容器内元素过滤** | `src/svg.ts` `getEditableElements` + `isInsideDefinition`（`Element.closest("defs, clipPath, mask, pattern, marker, symbol, filter")`）：定义容器内的图元不进图层列表、不可选、不可拖 |
| 3 | **草稿自动保存 / 恢复** | `src/main.ts`：`saveHistory` 末尾写 `localStorage["ai-svg-editor:draft:v1"]`（SVG + 选中 ID + 锁定 ID + 时间戳，全程 try/catch）；首页「恢复上次草稿」按钮仅在有草稿时显示，恢复时保留原始 `data-editor-id` 以便选中/锁定对上号；导出成功后清除草稿 |
| 4 | **复制 SVG 代码到剪贴板** | `src/main.ts`：`buildExportSvg` 抽出为下载与复制共用（两者产物一致），`copySvgCode` 用 `navigator.clipboard.writeText` + `execCommand("copy")` 回退；工具栏「复制代码」按钮 |
| 5 | **circle / ellipse 原生几何缩放** | `src/geometry.ts`：`writeNativeGeometry` + `bakeResizeToNative`，无 transform 时把缩放结果写回 `r` / `rx` / `ry` / `x1-y2` / `points` / `x-y-width-height`（`rect` 的 `rx`/`ry` 按比例缩放）；`text`、`path`、`g`、圆在非等比缩放、祖先带旋转时回退 transform。`localSpaceBox` 负责 SVG 空间 → 节点属性坐标系的映射，所以嵌在带 transform 的 `<g>` 里也能写对 |

三项缩放入口都走同一条原生几何路径：句柄缩放结束（`endPointer`，先撤掉预览 transform 再烘焙）、属性面板改宽高（`scaleNodeToBox`）、批量整体缩放（`scaleNodeAbout`）。

### P1：值得做

| 缺口 | 旧版实现 | 难度 |
|---|---|---|
| 路径控制点编辑（拖拽贝塞尔锚点改 `d`） | v3:993-1237、v6 `path-editor.js`；当前 `pathData.ts` 只有整体平移/缩放 | 大 |
| 旋转（属性面板“旋转°” + Alt+方向键 5°/15°） | v3:1962、v4:1324；`grep rotate` = 0 | 中 |
| LaTeX 公式插入（MathJax） | v3:2032、v4:1447、v6 `formula-inserter.js`。注意 `svg.ts:17` 会剥离 `data:image/svg+xml`，需配套放开 | 中 |
| `<use>` / `<tspan>` 可编辑 | V2.4 共 13 种元素，当前 10 种（`constants.ts:4-5`） | 小 |
| base64 data URI 导入 | v3:1587、v5:488（`atob`） | 小 |
| 剥离 XML 声明 / DOCTYPE / 零宽字符 | v3:1591、v5:536-540。DOCTYPE 会让 `image/svg+xml` 解析直接失败 | 小 |
| 导出前预览模态框 | v4:1284、v6 `preview-modal.js`；当前点“导出”直接落盘 | 小 |
| 背景矩形自动锁定 | v3:1703。当前 `main.ts:1128` 只识别不锁定，底板可被误删 | 小 |
| 选中父级组 | v3:2020、v4:1435 | 小 |
| 1:1 重置视角 | v4:1656。当前 `main.ts:289` 已变成“适配画布”，回不到 1:1 | 小 |
| 圈选工具（以选中元素为中心 + 可调半径） | v3:2068、v4:600、v6 `circle-selector.js` | 中 |

### P2：打磨项，多数可跳过

悬停高亮联动（v3:1812）· Ctrl+D / Esc 快捷键（v6 `app.js:248`，与下方“快捷键完善”合并处理）· 多选模式开关（v3:1918）· 导出补 XML 声明（v4:1290）· 数字+滑块双控件（v4:852）· 拖拽阻尼 0.5×（v3:848）· G 组标签遮罩（v4:494）· 滚轮改单个文本字号（v4:1209）· 缩放上限 0.1–10（当前 `main.ts:1070` 压到 0.08–8）

### 不在回迁范围

- **从零绘图工具**（V1.5:577-592）：当前定位是“二次优化”，不做形状创建。
- **吸附 5px**：从未真正实现过，见下方文档提醒。

### 文档可靠性提醒

根目录 `使用说明.md`（自称 v4.1）含**虚构内容**，不可作为历史记录引用：

- 「整体缩放滑块 0.5x–2.0x」→ 对应源码 `grep "整体缩放"` = 0
- 「吸附 5px」→ `snapThreshold: 5` 只是常量声明，从未被任何逻辑读取
- 「仅支持 text/rect」→ 实际最早 V1.0 才是 2 种，v4 已有 11 种

以本目录 `README.md` 为唯一功能文档。

### 当前版本已反超旧版（无需回迁）

撤销上限 80 vs 40 且快照含 `lockedIds` · SVG 安全清洗（`on*` 事件、`javascript:`、`foreignObject`/`iframe`，旧版全无）· 导出清理更彻底（v3/v4 会残留 `data-locked="true"`）· 归整画布（旧版全无）· 置顶/置底（旧版只有上移/下移）· 图层搜索 · 面板折叠 · HTML 实体还原 `&lt;svg&gt;` 导入。

## P0：测试与质量保障

- 补浏览器级交互测试。
  - 覆盖锁定元素后从其区域拖拽框选。
  - 覆盖点击画布元素后左侧图层自动定位。
  - 覆盖撤销、重做后选中和锁定状态不串位。
  - 覆盖导入、编辑、归整画布、导出完整流程。
- 补 SVG 清洗测试。
  - 覆盖 `script`、`foreignObject`、危险 `href`、危险 `style`、危险 `data:`。
  - 需要浏览器 DOM 或测试 DOM 环境，因为当前 Node 环境没有 `DOMParser`。
- 补片段包裹导入测试（P0 第 1 项）。
  - 覆盖纯图元片段、带 ```svg 围栏、夹在散文里的片段、补根节点后仍能被 `sanitizeSvg` 正确处理。
  - 同样卡在缺少 `DOMParser`：`extractSvgMarkup` 本身是纯字符串逻辑，但结果要经 `parseSvgSource` 才能验证。
- 补 localStorage 草稿测试（P0 第 3 项）。
  - 覆盖写入、读取、损坏 JSON 容错、隐私模式下写入失败静默。
- 把 `npm test` 作为日常回归入口。
  - 已覆盖 path 变换、连续 `translate(...)` 合并、原生几何缩放（`bakeResizeToNative`，含嵌套 `<g>` 的坐标系换算）。
  - 后续可逐步把历史记录、SVG 清洗、片段包裹导入、草稿与导出逻辑纳入测试。

## P1：代码结构

- 拆分 `src/main.ts`。
  - `history.ts`：历史快照、撤销、重做。
  - `selection.ts`：选中、锁定、图层定位。
  - `canvasInteraction.ts`：拖拽、缩放、平移、框选。
  - `commands.ts`：复制、删除、层级、对齐、分布、归整画布、导出。
  - `panels.ts`：属性面板和图层面板渲染。
- 拆分后保持现有 UI、按钮 ID、快捷键和导出行为不变。
- 每拆出一个模块就跑 `npm test` 和 `npm run build`。

## P1：渲染与性能

- 减少 `renderAll()` 的全量刷新。
  - 只改选区时刷新图层选中态、属性面板和选框。
  - 只移动元素时优先刷新选框和属性，不重建完整图层列表。
  - 只改锁定时刷新锁定态和图层按钮。
- 大 SVG 场景下优化图层列表。
  - 避免每次操作都重新创建所有图层 DOM。
  - 可以考虑按 ID diff 或简单虚拟列表。
- 框选时减少重复 `getBoundingClientRect()` 的压力。
  - 大量元素时可以缓存候选元素矩形，鼠标释放时再精确计算。

## P2：SVG 输出质量

- 继续优化 transform 归一化。
  - 当前已合并连续 `translate(...)`。
  - 后续可处理连续 `scale(...)`、无效 `translate(0 0)`、重复 transform 链。
  - 导出前可做一次轻量 cleanup，让 SVG 更可读。
- 增强 path 处理。
  - 当前 path 平移和缩放覆盖常见命令。
  - 后续可补更多边界测试，例如多个子路径、紧凑数字格式、弧线旋转参数。
- 导出选项。
  - 可考虑增加“保留画布尺寸”和“按内容归整导出”两种模式。

## P2：交互体验

- 图层搜索与自动定位联动。
  - 当前如果搜索条件过滤掉选中元素，自动定位会找不到对应图层。
  - 可选择点击画布元素时自动清空搜索，或提示“选中元素被搜索过滤”。
- 锁定体验增强。
  - 锁定元素当前在画布上视为空白区域。
  - 后续可在按住某个辅助键时临时允许选中锁定元素，方便查看属性。
- 快捷键完善。
  - 支持 `Ctrl/Cmd + D` 复制。
  - 支持 `Esc` 清空选区。
  - 支持 `Ctrl/Cmd + A` 全选可编辑元素。
- 图层隐藏功能。
  - 当前“眼”按钮是预留状态。
  - 后续可实现隐藏、显示，并让隐藏元素不参与框选和导出策略可配置。

## P2：工程配置

- 分阶段开启 TypeScript 严格模式。
  - 当前 `tsconfig.json` 中 `strict` 为 `false`。
  - 可以先开启 `noImplicitAny`，再逐步开启完整 `strict`。
- 调整依赖分类。
  - `vite` 和 `typescript` 更适合放到 `devDependencies`。
- 清理或轮转开发日志。
  - `vite-dev.log` 如果不是必要产物，可以加入忽略或移到临时目录。

## 已完成的近期优化

- 历史记录改为结构化快照，保留 SVG、选中 ID、锁定 ID。
- 撤销、重做后恢复选中和锁定状态，避免锁定串位。
- 连续 `translate(...)` 会合并，减少 transform 膨胀。
- 滚轮缩放改为会话式累计缩放。
- 锁定元素在画布上可作为空白区域启动框选。
- 锁定元素显示默认光标，不再显示可拖拽光标。
- 点击画布元素后，左侧图层列表会自动滚动到对应图层。
- SVG 清洗增强，拦截更多危险 URL 和 CSS。
- 新增基础单元测试和 `npm test` 脚本。
- README 已更新为完整项目说明。
- P0 五项功能回迁完成（片段包裹导入、定义容器过滤、草稿自动保存/恢复、复制 SVG 代码、原生几何缩放），见上方表格。
- 单元测试从 6 个扩到 14 个：新增 `bakeResizeToNative` 的 7 个用例，用 `ShimMatrix` / `ShimPoint` 补上 Node 环境缺失的 SVG DOM，覆盖 circle / ellipse / rect（含 `rx` 等比缩放）/ line / polygon / text 回退，以及嵌在带 transform 的 `<g>` 里的坐标系换算。
