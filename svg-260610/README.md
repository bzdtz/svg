# AI SVG 二次优化编辑器

一个面向 AI 生成 SVG 的轻量编辑器。它可以把 Gemini、ChatGPT 或其他工具生成的 SVG 导入到画布中，进行文本、位置、尺寸、颜色、层级和画布范围的二次整理，然后导出干净的 SVG 文件。

## 功能概览

- 粘贴或上传 SVG，自动解析并进入编辑器。
- 在画布中点击、拖拽、框选元素，支持多选。
- 通过左侧图层列表快速定位、选择和锁定元素。
- 选中画布元素后，左侧图层列表会自动滚动到对应图层。
- 锁定元素后，画布交互会把它视为空白区域，方便从其上方继续框选其他元素。
- 支持撤销、重做、复制、删除、置顶、置底、上移、下移。
- 支持对齐、等距分布、统一字体、统一颜色和整体缩放。
- 支持编辑文本内容、字体、字号、字重、对齐、填充、描边、透明度和圆角。
- 支持归整画布，根据内容重新计算 `viewBox`。
- 导出时会清理编辑器内部属性，并对 SVG 做基础安全清洗。

## 开发

```bash
npm install
npm run dev
```

开发服务器默认使用 Vite，并监听 `0.0.0.0`，便于在局域网或容器环境中访问。

## 常用命令

```bash
npm run typecheck
npm test
npm run build
npm run build:single
npm run preview
```

- `npm run typecheck`：运行 TypeScript 类型检查。
- `npm test`：先运行类型检查，再编译并执行单元测试。
- `npm run build`：构建生产产物到 `dist/`。
- `npm run build:single`：构建并生成可分享的单文件 HTML。
- `npm run preview`：本地预览构建后的产物。

## 项目结构

```text
src/
  main.ts       编辑器主交互、图层、属性面板和命令绑定
  svg.ts        SVG 解析、清洗、序列化和导出辅助
  geometry.ts   元素移动、缩放和包围盒计算
  pathData.ts   path 的 d 属性解析、平移和缩放
  state.ts      编辑器状态初始化
  types.ts      共享类型
  styles.css    编辑器样式
tests/
  unit.test.ts  路径变换和 transform 合并的单元测试
legacy-html/    旧版单文件 HTML 备份
dist/           构建产物
```

## 测试覆盖

当前自动化测试主要覆盖纯逻辑部分：

- path 绝对命令平移。
- path 相对命令平移。
- path 缩放。
- 连续 `translate(...)` 合并。
- 移动已有 transform 的元素时避免重复堆叠平移。

SVG 清洗和画布交互依赖浏览器 DOM，当前通过 `typecheck` 和 `build` 做基础校验。后续如果引入浏览器测试环境，可以继续补充锁定框选、图层自动定位、导入清洗和导出结果的端到端测试。

## 构建分发

```bash
npm run build
```

构建产物会输出到 `dist/`，可以部署到任意静态文件服务。旧的单文件版本统一放在 `legacy-html/`，可作为历史参考或回退版本。

如果需要发送给别人直接打开，可以生成独立 HTML：

```bash
npm run build:single
```

生成文件为 `dist/svg-editor-standalone.html`，其中会内联构建后的 CSS 和 JavaScript，适合直接分享或离线打开。

## 维护备注

- `data-editor-id` 和 `data-editor-locked` 是编辑器内部属性，导出时会被清理。
- 历史记录会保留内部 ID，用于保证撤销、重做后选中和锁定状态不串位。
- 滚轮缩放使用会话式累计缩放，避免连续操作时不断堆叠 transform。
