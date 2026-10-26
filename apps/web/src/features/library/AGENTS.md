# 图谱状态与全貌页

- 本目录承载 `LibraryService`、全貌页及合集／合集边面板。视口交互归 `../board/`，卡片编辑器归 `../cards/`。
- `library.service.ts` 保持状态与方法委托层；请求和状态更新放入 `collections.ts`、`graph.ts`、`nodes.ts`、`edges.ts`、`collection-edges.ts`、`cards.ts`、`search.ts`、`placements.ts` 等领域模块。
- 复用 `api.ts` 的请求处理；异步读取沿用 `jobs` 竞态序号，防止旧响应覆盖当前选择。
- 悬停读取通过 `loadPeek` 更新 `peek`，不得污染当前选中的 `nodeDetail`。
- `pull.ts` 管当前视图的同步拉取；更新同步逻辑时同时考虑当前合集、选择详情与本地写入。
- 修改已有内容的方法沿用 `watchWrite` 保存计数；不要在底层请求模块维护另一套保存状态。

## 指令文件双向同步

- 同目录的 `AGENTS.md` 与 `CLAUDE.md` 是同一份项目规则，内容必须保持完全一致。
- 后续 Agent 修改任意一方时，必须在同一次变更中同步更新另一方；新增、移动或删除项目级指令文件时也要成对处理。
- 完成前逐对检查内容一致；若已有差异，先核对实际代码与用户要求再合并，不能直接覆盖另一方独有的有效规则。
