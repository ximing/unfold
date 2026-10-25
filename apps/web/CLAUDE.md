# 前端应用指令 (`apps/web`)

## 这个目录负责什么

- 承载 `@unfold/web` 桌面端单页应用（React 19 + Vite 6 + React Router 7 + `@rabjs/react`）。
- 实现应用壳层（`/library` 全貌页与 `/c/:id` 合集页）、自定义 SVG 交互画布、右侧玻璃检查器面板、8 种卡片编辑器与 `⌘K` 搜索面板。

## 放置约束

- **放什么**：
  - `src/foundation/`：全局 CSS 变量令牌、基础重置、通用工具类与动效定义（`base.css`、`utilities.css`、`motion.css`）。
  - `src/shared/ui/<name>/`：与业务解耦的基础 UI 组件（`UButton`、`UField`、`USelect`、`UModal`、`UDateField`、`Toast` 等）及其同名样式 `<name>.css`。
  - `src/shared/panel/` 与 `src/shared/name-field/`：跨页面复用的检查器外壳（`PanelShell`）与内联名称编辑组件。
  - `src/features/<feature>/`：按业务功能划分的模块：
    - `session/`：登录页、首页路由分流与 `SessionService`。
    - `shell/`：左侧图标栏、合集目录侧栏、全局快捷键（`⌘K` 搜索、`⌘N` 新建合集）。
    - `library/`：全貌页及 `LibraryService`（状态壳层在 `library.service.ts`，领域操作按 `api`、`collections`、`graph`、`nodes`、`edges`、`collection-edges`、`cards`、`search` 拆分）。
    - `collection/`：合集详情页及点/边的右侧检查器面板與悬停预览（`NodePeek`）。
    - `board/`：自定义 SVG 视口（`GraphViewport`）、画布渲染（`BoardCanvas`、`BoardNodes`、`BoardEdges`）与图布局算法（`board-layout.ts`）。
    - `cards/`：8 种卡片组件、Tiptap 笔记编辑器、highlight.js 代码卡、KaTeX 公式卡及卡片元数据注册表（`card-meta.ts`）。
    - `paste-bench/`：独立于产品壳层之外的粘贴调测夹具页（`/paste-bench`）。
- **不放什么**：
  - 不要在 `src/shared/ui/` 中引入 `LibraryService`、`SessionService` 或具体图谱业务类型。
  - 不要在 `src/` 根目录堆放巨型全局样式表（原先的 `styles.css` 与 `workspace.css` 已拆解下沉，样式应跟随所属组件或功能目录放置）。
  - 不要引入 React Flow 等第三方图渲染库替代 `features/board/` 的自定义 SVG 实现。

## 开发偏好

- **状态流转**：
  - `SessionService` 在 `main.tsx` 全局注册；`LibraryService` 绑定在 `Shell` 上，由 `/library` 与 `/c/:id` 共享。
  - 扩展 `LibraryService` 能力时，保持 `library.service.ts` 作为轻量方法委托层，具体异步请求与竞态计数（`jobs`）写在 `features/library/` 下的对应领域模块中。
  - 节点悬停预览通过 `loadPeek` 更新 `peek` 状态，严禁污染当前选中的 `nodeDetail`。
- **画布与坐标**：
  - 画布世界坐标与屏幕坐标换算统一通过 `GraphViewport` 内层 `<g>` 的 `getScreenCTM()` 完成。
  - 自动排布逻辑集中在 `features/board/board-layout.ts`（`layoutBoard` 纯函数），保持可独立单测。
- **卡片扩展与渲染**：
  - 8 种卡片的颜色与标签统一以 `features/cards/card-meta.ts` 为准，点本身不设类型色标。
  - 卡片内容采用失焦自动保存（blur save），创建后不可更改卡片 `type`。
