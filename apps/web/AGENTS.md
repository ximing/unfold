# 前端应用指令

## 职责与放置边界

- React 19 + Vite 6 + React Router 7 + `@rabjs/react`；`/library` 是全貌页，`/c/:id` 是合集页。
- `src/foundation/` 放全局 CSS 令牌、重置、工具类与动效。组件和功能样式就近共置，不恢复根级巨型样式表。
- `src/shared/ui/` 放无业务耦合的基础组件；`shared/panel/`、`shared/name-field/` 放跨页面检查器与名称编辑。
- `src/shared/save/` 放草稿登记、提交与写入计数；基础 UI 可以登记草稿，不能依赖 `LibraryService`、`SessionService` 或图谱业务类型。
- `src/shared/live/` 提供页面客户端标识；`features/live/` 连接 `/api/live` 并拉取变化；`features/save/` 订阅保存状态。
- `src/features/` 按业务归属组织。`session/` 管账号，`shell/` 管操作区、路由壳与全局快捷键，`collection/` 管合集详情和检查器。
- `library/`、`board/`、`cards/` 分别管理共享图谱状态、SVG 画布、卡片编辑，各自有局部 `CLAUDE.md`。

## 跨功能约定

- `SessionService` 在 `main.tsx` 全局注册；`LibraryService` 绑定在 `Shell`，由全貌页和合集页共享。组件订阅方式见路径规则 `react-components.md`。
- 页面私有逻辑留在所属 feature；不要仅为复用一个函数就把业务状态移入 `shared/ui/`。
- 保存通过 `shared/save/` 接入统一草稿与写入状态，保留失焦和 ⌘S 提交；同步回声不得覆盖用户更新的本地草稿。
- Web 不检测 Tauri、不依赖桌面 IPC；同一份页面服务浏览器与桌面壳。

## 指令文件双向同步

- 同目录的 `AGENTS.md` 与 `CLAUDE.md` 是同一份项目规则，内容必须保持完全一致。
- 后续 Agent 修改任意一方时，必须在同一次变更中同步更新另一方；新增、移动或删除项目级指令文件时也要成对处理。
- 完成前逐对检查内容一致；若已有差异，先核对实际代码与用户要求再合并，不能直接覆盖另一方独有的有效规则。
