# 开发说明

给要改这个仓库的人。怎么使用 Unfold，写在仓库根目录的 [README](../README.md)。产品行为以 [prd/2026-10-25-graph.md](prd/2026-10-25-graph.md) 为准，实现以 [tech/2026-10-25-graph.md](tech/2026-10-25-graph.md) 为准。

## 本地

需要 Node.js ≥ 22、pnpm 10.30.3、PostgreSQL。

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
```

在 `apps/server/.env` 里填写真实值。口令、密钥只放在这个文件里，不写进代码、测试和文档。启动至少要有：

- `DATABASE_URL`
- `SESSION_SECRET`
- `UNFOLD_ENV`（本地用 `development`）
- `ATTACHMENT_S3_BUCKET`
- `ATTACHMENT_S3_ACCESS_KEY_ID`
- `ATTACHMENT_S3_SECRET_ACCESS_KEY`
- `ATTACHMENT_S3_REGION`

`SEED_USERNAME` 和 `SEED_PASSWORD` 给种子账号和服务端集成测试用。变量的完整说明在[技术方案第 3 节](tech/2026-10-25-graph.md)。

```bash
pnpm --filter @unfold/server migrate
pnpm --filter @unfold/server seed
pnpm dev
```

浏览器打开 <http://localhost:5173>。页面由 Vite 提供，`/api` 代理到 `127.0.0.1:3000`。地址用 `localhost`。

桌面壳需要本机的 Rust，并且上面的页面和接口已经在跑：

```bash
pnpm --filter @unfold/desktop dev
```

开发窗口打开 `http://localhost:5173`。安装包打开 `https://unfold.aimo.plus`，不包含前端构建产物。

## 目录

```
apps/server     Fastify、Drizzle、PostgreSQL
apps/web        React、Vite、画布
apps/desktop    Tauri 2 壳
packages/dto    前后端共用的 Zod 契约
docs/prd        产品语义
docs/tech       与代码一致的实现
docs/deploy.md  发布
docs/images     根目录 README 用的界面截图
```

各目录里的 `CLAUDE.md` 是改那一块代码时的约束。

## 文档

| 文件 | 写什么 |
| --- | --- |
| [prd/2026-10-25-graph.md](prd/2026-10-25-graph.md) | 现在的产品行为：合集、点、边、卡片、交互 |
| [prd/2026-10-26-canvas-settings.md](prd/2026-10-26-canvas-settings.md) | 待确认的画布设置。未落地前，行为仍以上一份为准 |
| [tech/2026-10-25-graph.md](tech/2026-10-25-graph.md) | 拓扑、表、HTTP、前端、检查 |
| [deploy.md](deploy.md) | 主机、镜像、迁移、桌面安装包 |

改产品语义或接口时，先改前两份，再改代码。

结构只有合集、点、边、卡片。新的内容做成一种卡片。已经去掉的领域、点类型、扇区、固定关系词表、能力、证据、复习、一跳星图，不再写回文档和代码。

## 检查

```bash
pnpm test
pnpm typecheck
pnpm lint
```

服务端集成测试打到 `DATABASE_URL` 指向的库，登录用 `SEED_USERNAME` 和 `SEED_PASSWORD`。用例创建的合集和点在结束前删掉。

桌面壳的契约测试不要求本机安装 Rust：

```bash
pnpm --filter @unfold/desktop test
```
