# 服务端指令 (`apps/server`)

## 这个目录负责什么

- 承载 `@unfold/server` 单进程后端服务（Fastify 5 + Drizzle ORM + PostgreSQL）。
- 提供 Cookie 会话认证（`/api/register`、`/api/login`、`/api/logout`、`/api/me`）、账号管理（改名、头像）以及合集、点、边、卡片、搜索（PostgreSQL `ILIKE`）的 HTTP API。
- 管理 PostgreSQL 表结构（`src/db/schema.ts`）、SQL 迁移（`drizzle/`）与种子用户脚本（`src/seed.ts`）。

## 放置约束

- **放什么**：
  - `src/app.ts`：Fastify 实例组装、Cookie/限流插件注册、登录会话校验与路由模块挂载。
  - `src/web-static.ts`：`UNFOLD_ENV=production` 且 `apps/web/dist/index.html` 存在时托管前端构建结果。开发与测试不注册。
  - `src/http.ts`：路由公共参数 schema、统一错误响应构造器与数据库唯一约束冲突判断。
  - `src/<domain>/routes.ts`：按领域拆分的 HTTP 路由注册函数（`avatar`、`collections`、`nodes`、`edges`、`cards`、`search`）。
  - `src/avatar/`：头像 multipart 解析、S3 读写与预签名临时地址（`ATTACHMENT_S3_*`，私有桶每次现签）。
  - `src/graph/db.ts`：跨表图谱查询、卡片位置计算与级联删除事务（合集、点、边、卡片的组合读写）。
  - `src/db/`：数据库连接池（`client.ts`）与 Drizzle 表定义（`schema.ts`）。
- **不放什么**：
  - 前后端共享的请求体/响应体 Zod schema（应放在 `packages/dto/src/graph.ts`）。
  - 外部检索引擎、向量召回或定时复习任务逻辑（服务端搜索仅使用 `src/search/` 下的 PostgreSQL `ILIKE`）。

## 开发偏好

- **用户隔离与存在性校验**：所有业务表查询与变更必须同时限定 `eq(table.userId, user.id)` 且 `isNull(table.deletedAt)`。跨用户访问或已软删除资源统一返回 `404`（`not_found`），不泄露资源存在性。
- **删除语义**：
  - `collections`、`nodes`、`edges`、`collection_edges`、`cards` 统一使用软删除（同时更新 `deletedAt` 与 `updatedAt`）。
  - `memberships`（点与合集的多对多关系）使用**物理删除**。
  - 删除合集、点或边时，必须复用或遵循 `src/graph/db.ts` 中的事务级联逻辑（如删点需同步软删关联边、边上卡片、点上卡片，并物理清理 `memberships`；删合集不删点）。
- **HTTP 与错误契约**：
  - 请求体统一使用 `@unfold/dto` 的 schema 做 `safeParse`，校验失败通过 `http.ts` 的 `invalidBody(bodyMessage(parsed.error))` 返回 `400 invalid_body`。
  - 自环返回 `400`（「不能连到自己」）；重复有效边捕获唯一索引冲突或预检后返回 `409 conflict`（「这条关系已经有了」）。
  - 状态码约定：创建 `201`，读取/更新 `200`，删除/成员变更 `204`（重复加入成员幂等返回 `204`）。
- **数据库迁移**：新增或修改表结构需保持 `drizzle/meta/_journal.json` 顺序一致，确保 `pnpm --filter @unfold/server migrate` 具备幂等性（可连续执行两次）。
