---
paths:
  - "**/*.test.{ts,tsx,mjs}"
  - "**/__tests__/**/*.{ts,tsx,mjs}"
---

# 测试编写与执行规范

## 测试分层

- **纯函数与契约单测**（`packages/**`、`apps/web/src/**/*.test.ts`、`apps/server/src/search/text.test.ts`）：
  - 使用 Vitest 直接测试输入输出或 Service 状态流转（前端 Service 测试通过 mock `fetch` 验证状态与竞态序号 `jobs`）。
  - 保持零外部 I/O 依赖，可离线快速执行。
- **服务端集成测试**（`apps/server/src/**/*.integration.test.ts`）：
  - 通过 `buildApp()` 与 `app.inject()` 直接请求 Fastify 实例并读写 `DATABASE_URL` 指向的真实 PostgreSQL。
  - 登录凭证从环境变量 `SEED_USERNAME` 与 `SEED_PASSWORD` 读取，严禁在测试中硬编码账号密码。

- **桌面壳契约测试**（`apps/desktop/__tests__/*.test.mjs`）：
  - 使用 Node 内置 `node:test`；运行 `pnpm --filter @unfold/desktop test`，无需 Rust，不改用 Vitest。

## 关键约束

- **测试数据隔离与清理**：服务端集成测试创建合集、点、边、卡片时，必须使用 `randomUUID()` 生成唯一标识或词元，并在 `finally` 或测试清理钩子中通过 DELETE 接口清理本用例创建的合集与点，避免污染共享开发库。
- **错误契约断言**：验证异常分支时，同时断言 HTTP 状态码与 `{ error: { code, message } }` 中的 `code`（如 `unauthenticated`、`invalid_body`、`conflict`、`not_found`）。
- **运行命令**：
  - 全仓测试：`pnpm test`
  - 单包测试：`pnpm --filter <pkg-name> test`
