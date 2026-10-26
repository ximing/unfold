# Unfold 项目指令

## 项目与全局基线

- pnpm workspace；TypeScript 使用 Node >= 22、ESM、`strict` 与 `verbatimModuleSyntax`。类型用 `import type`，TS/TSX 包内相对模块导入带 `.js`；样式等资源保留实际后缀。
- 中文界面的多用户知识图谱工具，账号数据隔离。结构只有合集、点、边、卡片；点的 `kind: text | image` 是呈现形式，不恢复历史领域分类、扇区、固定关系词表、能力、证据、FSRS 复习或一跳星图。
- `apps/server` 提供 Fastify / Drizzle / PostgreSQL API；`apps/web` 提供 React 页面；`apps/desktop` 是 Tauri 远程页面壳；`packages/dto` 是共享 Zod 契约。
- 产品与技术基准分别是 `docs/prd/2026-10-25-graph.md`、`docs/tech/2026-10-25-graph.md`。实现增量需求前先更新对应基准，确保代码与文档同步。
- 本地真实凭据只写入 `apps/server/.env`，不提交、不写入代码、测试或文档；部署从环境注入。变量说明见 `.env.example` 与 `docs/README.md`。
- 遵循根 ESLint 配置，不遗留调试日志。
- 仓库有 `.codegraph/` 时，理解或定位代码先用 `codegraph explore "文件、符号或问题"`；未覆盖的内容再用文件搜索与读取。

## 开发入口

- 安装与配置：见 `docs/README.md`；`pnpm dev` 启动服务端 3000 与前端 5173。
- 桌面开发：`pnpm --filter @unfold/desktop dev`，需要 Rust 与已启动的后端。
- 检查：`pnpm test`、`pnpm typecheck`、`pnpm lint`；单包用 `pnpm --filter <包名> test`。服务端测试需要配置好的 PostgreSQL 与种子账号。
- 构建：`pnpm --filter @unfold/web build`；桌面安装包用 `pnpm --filter @unfold/desktop build`。
- 数据库：`pnpm --filter @unfold/server migrate`、`pnpm --filter @unfold/server seed`。

## 按需规则导航

- Codex 使用各目录的 `AGENTS.md`，Claude 使用同目录的 `CLAUDE.md`；处理目标文件前，读取从仓库根到目标目录之间尚未加载的局部指令。下列 `CLAUDE.md` 均有同目录的 `AGENTS.md`。
- 各包入口：`apps/server/CLAUDE.md`、`apps/web/CLAUDE.md`、`apps/desktop/CLAUDE.md`、`packages/dto/CLAUDE.md`。
- 前端深层边界：`apps/web/src/features/{library,board,cards}/CLAUDE.md`。
- 路径规则统一维护在 `.claude/rules/`，两类 Agent 共用，不复制出第二套。处理文件前按规则的 `paths` 读取命中的正文；若运行环境未自动加载，必须主动读取：
  - 测试文件（`.test.ts`、`.test.tsx`、`.test.mjs` 及对应 `__tests__/` 文件）：`.claude/rules/testing.md`。
  - `apps/web/src/` 下 TSX / CSS：`.claude/rules/react-components.md`。
  - `docs/` 下 Markdown：`.claude/rules/docs.md`。
  - 桌面发布 workflow、包版本与 Tauri / Cargo 配置：`.claude/rules/desktop-release.md`。
- 新增或修改路径规则的适用范围时，同步更新根 `AGENTS.md` 与 `CLAUDE.md` 的导航；不通过 `@` 全量导入局部规则。

## 指令文件双向同步

- 同目录的 `AGENTS.md` 与 `CLAUDE.md` 是同一份项目规则，内容必须保持完全一致。
- 后续 Agent 修改任意一方时，必须在同一次变更中同步更新另一方；新增、移动或删除项目级指令文件时也要成对处理。
- 完成前逐对检查内容一致；若已有差异，先核对实际代码与用户要求再合并，不能直接覆盖另一方独有的有效规则。
