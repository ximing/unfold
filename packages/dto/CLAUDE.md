# 共享契约指令 (`packages/dto`)

## 这个目录负责什么

- 承载 `@unfold/server` 与 `@unfold/web` 共用的 Zod 4 数据校验 schema 与 TypeScript 推导类型。
- 作为前后端 HTTP 请求体、响应体及图谱核心模型（合集、点、边、8 种卡片、搜索命中）的唯一契约真相源。

## 放置约束

- **放什么**：
  - `src/graph.ts`：**现行主契约**，包含合集、点、点边、合集边、8 种卡片（`cardContentSchemas`）及搜索接口的全部 Zod schema 与导出类型。
  - `src/api.ts` 与 `src/normalize-name.ts`：登录接口契约（`loginBodySchema`）及历史遗留名称归一化工具函数。
  - 与 schema 同目录的 `.test.ts` 契约单元测试。
- **不放什么**：
  - 任何依赖 Node.js 原生模块、数据库驱动（Drizzle / `pg`）或浏览器 DOM API 的代码。
  - 仅单端使用的内部状态类型（如前端 `LibraryState` 或服务端数据库行类型）。

## 开发偏好

- **严格对象校验**：所有写操作请求体与卡片 `content` 必须使用 `z.strictObject(...)`，拒绝未知字段。
- **文本校验与中文提示**：
  - 名称、标题、边标签使用 `trim()` 后校验非空与最大长度（标题/名字 1–80 字，边标签 1–40 字，点描述 0–160 字）。
  - 必填项为空时的校验文案必须保持中文且与服务端 `http.ts` 的 `knownMessages` 对齐（如 `'标题不能是空的'`、`'名字不能是空的'`、`'关系说明不能是空的'`）。
- **字段映射约定**：API 契约中卡片类型字段统一命名为 `type`（对应服务端数据库列名 `card_type`）。
- **新旧契约边界**：现行图谱功能一律在 `src/graph.ts` 中演进；图的创建与搜索**不使用** `normalizeName`（点允许同名，仅做 `trim`）。
