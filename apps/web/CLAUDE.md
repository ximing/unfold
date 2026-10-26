# 前端应用指令 (`apps/web`)

## 这个目录负责什么

- 承载 `@unfold/web` 桌面端单页应用（React 19 + Vite 6 + React Router 7 + `@rabjs/react`）。
- 实现应用壳层（`/library` 全貌页与 `/c/:id` 合集页）、自定义 SVG 交互画布、右侧玻璃检查器面板、九种卡片编辑器（原八种加富文本 `rich`）与 `⌘K` 搜索面板。

## 放置约束

- **放什么**：
  - `src/foundation/`：全局 CSS 变量令牌、基础重置、通用工具类与动效定义（`base.css`、`utilities.css`、`motion.css`）。
  - `src/shared/ui/<name>/`：与业务解耦的基础 UI 组件（`UButton`、`UField`、`USelect`、`UModal`、`UDateField`、`Toast` 等）及其同名样式 `<name>.css`。
  - `src/shared/panel/` 与 `src/shared/name-field/`：跨页面复用的检查器外壳（`PanelShell`）与内联名称编辑组件。
  - `src/shared/save/`：保存总线。草稿登记、写入计数、停下两秒提交、⌘S。`shared/ui` 可以登记草稿，不要从这里引用 `LibraryService`。
  - `src/shared/live/`：这一页的客户端标识，写请求带给服务端。
  - `src/features/<feature>/`：按业务功能划分的模块：
    - `session/`：登录页、注册页、首页路由分流与 `SessionService`（含改名与头像上传）。
    - `shell/`：浮在画布顶部的操作区（保存状态、头像账号菜单、合集切换、搜索、设置导航）、全局快捷键（`⌘K` 搜索、`⌘N` 新建合集、`⌘S` 保存）、停下两秒的静默保存。
    - `live/`：登录后连接 `/api/live`，另一处写入时拉取当前页；页面可见时约每 5 秒再拉一次。
    - `save/`：`SaveService`，订阅 `shared/save/` 的写入状态。
    - `library/`：全貌页及 `LibraryService`（状态壳层在 `library.service.ts`，领域操作按 `api`、`collections`、`graph`、`nodes`、`edges`、`collection-edges`、`cards`、`search` 拆分）。
    - `collection/`：合集详情页及点/边的右侧检查器面板與悬停预览（`NodePeek`）。
    - `board/`：自定义 SVG 视口（`GraphViewport`）、画布渲染（`BoardCanvas`、`BoardNodes`、`BoardEdges`）与图布局算法（`board-layout.ts`）。
    - `cards/`：九种卡片组件（原八种加富文本 `rich`）、Tiptap 笔记编辑器、highlight.js 代码卡、KaTeX 公式卡及卡片元数据注册表（`card-meta.ts`）。
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
  - 九种卡片（原八种加富文本 `rich`）的颜色与标签统一以 `features/cards/card-meta.ts` 为准，点本身不设类型色标。
  - 卡片内容停下输入大约两秒后保存，失焦也会保存，⌘S 立刻保存。创建后不可更改卡片 `type`。
