# Unfold 项目指令

## 项目概览

- **仓库类型**：基于 `pnpm` workspace 的全栈 TypeScript Monorepo（Node >= 22，ESM）。
- **产品定位**：单用户桌面 Web 知识图谱工具（中文界面），用于梳理概念和关系。核心结构严格限定为**四个名词**：**合集（Collection）**、**点（Node）**、**边（Edge / CollectionEdge）**、**卡片（Card，九种：原八种加富文本 `rich`）**。
- **关键子系统**：
  - `apps/server`：Fastify 5 + Drizzle ORM + PostgreSQL 服务端，提供会话认证与图谱 CRUD / 搜索 API。
  - `apps/web`：React 19 + Vite 6 + `@rabjs/react` 前端应用，使用自定义 SVG 渲染全貌图与合集画布。
  - `packages/dto`：前后端共用的 Zod 4 契约与类型定义。
  - `apps/desktop`：Tauri 2 桌面壳。开发加载 `http://localhost:5173`，生产加载 `https://unfold.aimo.plus`。不打包前端产物。

## 全局规则

- **语言与模块约束**：全仓开启 TypeScript `strict` 与 `verbatimModuleSyntax`。类型导入必须使用 `import type`，包内相对导入必须显式携带 `.js` 后缀。
- **代码质量**：遵循 ESLint 9 配置，禁止遗留调试日志（`no-console: warn`）。
- **概念边界**：不为特定领域新增结构名词，新内容形态只通过扩展或复用九种卡片承接（原八种加富文本 `rich`）。严禁按已废弃历史方案恢复“领域、点类型、扇区、固定关系词表、能力、证据、FSRS 复习、一跳星图”等概念。
- **文档与实现同步**：
  - 现行产品与技术基准为 `docs/prd/2026-10-25-graph.md` 与 `docs/tech/2026-10-25-graph.md`。
  - 待落地目标规格在实现时需先并入现行 PRD 与技术方案，再同步修改代码。
- **密钥安全**：环境变量仅存放在 `apps/server/.env`，代码、测试与文档中只引用变量名（如 `DATABASE_URL`、`SESSION_SECRET`、`SEED_USERNAME`、`SEED_PASSWORD`），严禁硬编码真实凭据。

## 开发入口

- **启动开发服务**：`pnpm dev`（并行启动 `@unfold/server` 端口 `3000` 与 `@unfold/web` 端口 `5173`）
- **桌面壳**：`pnpm --filter @unfold/desktop dev`（本机需有 Rust。先让 `pnpm dev` 把 3000 和 5173 拉起来）
- **运行全部测试**：`pnpm test`
- **全仓类型检查**：`pnpm typecheck`
- **代码规范检查**：`pnpm lint`
- **数据库迁移与种子**：
  - `pnpm --filter @unfold/server migrate`
  - `pnpm --filter @unfold/server seed`

## 局部规则导航

- **目录级指令（进入对应子树时按需加载）**：
  - `apps/server/CLAUDE.md`：Fastify 路由分片、Drizzle 事务与软删除规则、多租户隔离与 HTTP 错误契约。
  - `apps/web/CLAUDE.md`：`foundation / shared / features` 分层边界、`@rabjs/react` 状态管理与自定义 SVG 画布约定。
  - `packages/dto/CLAUDE.md`：Zod 4 共享契约规范与新旧 schema 边界。
  - `apps/desktop/CLAUDE.md`：Tauri 2 壳的远程 URL、Cookie 会话与导航约束。
- **路径级横切规则（按文件模式匹配加载）**：
  - `.claude/rules/testing.md`：单元与服务端集成测试规范（`**/*.test.ts`、`**/__tests__/**/*.ts`）。
  - `.claude/rules/react-components.md`：React 组件、响应式状态绑定与同目录样式规范（`apps/web/src/**/*.{tsx,css}`）。
  - `.claude/rules/docs.md`：PRD 与技术方案演进维护规范（`docs/**/*.md`）。
