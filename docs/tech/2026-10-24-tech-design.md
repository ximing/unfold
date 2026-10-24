# Unfold 技术方案

日期：2026-10-24。对应产品文档：`docs/prd/2026-10-24-unfold-prd.md`（焦点扇形模型，下称 PRD）。
本文是开发的唯一技术依据。PRD 管「做什么、为什么」，本文管「怎么实现」。产品语义以 PRD 为准，本文不重复论证。

读者：执行开发的 Agent 或工程师。不要求读过旧版 PRD（已作废）。

---

## 1. 系统拓扑

单用户、桌面 Web 优先。一个服务端进程，无微服务、无队列集群、无独立 worker。

```
浏览器 SPA (Vite/React, 同源 Cookie)
   │ HTTP + JSON（同源，开发期 Vite proxy → :3000）
   ▼
Fastify 5 (apps/server, :3000)
   ├── PostgreSQL  222.128.65.91:25432   权威存储（Drizzle + pg）
   ├── Meilisearch 222.128.65.91:7700    关键词召回（Bearer key）
   ├── Qdrant      222.128.65.91:6333    向量召回（待部署，见 3.3）
   └── DashScope   阿里云百炼            embedding / 精排 / 模型建议（HTTPS，key 在服务端）
```

图片等文件存服务端本地磁盘 `data/uploads/`，不进数据库。

## 2. 仓库结构（pnpm workspace）

现有仓库已是 pnpm workspace（Node ≥ 22、TypeScript 5.9、ESM、Vitest 3）。已有包：

- `packages/doc-schema`：自有短文档 schema（Tiptap/ProseMirror 节点白名单）、粘贴解析管道（`parse-paste.ts`、`prepare-html.ts`）、夹具与测试。**这是阶段 0 的既有管道，不是产品界面。**
- `packages/markdown`:remark-gfm/remark-math 的 Markdown 解析。
- `apps/web`：目前只有粘贴夹具页（`paste-bench.tsx`），将被产品界面取代。

目标结构：

```
apps/
  server/        Fastify、Drizzle、认证、事务、搜索管线、AI 接入
  web/           React SPA
packages/
  dto/           Zod 契约（server/web 共享，新增）
  doc-schema/    已有：文档 schema + 粘贴管道 + 块类型注册（扩展）
  markdown/      已有：Markdown 解析与导出
  search/        新增：召回/融合/精排的纯函数与客户端封装（可单测）
```

依赖方向：`apps/*` → `packages/*`;`packages/*` 互不依赖（doc-schema 依赖 markdown 除外）。`packages/search` 不依赖 Fastify，便于纯函数测试。

### 2.1 关键依赖版本

| 层 | 选择 | 备注 |
| --- | --- | --- |
| 仓库 | pnpm 10 workspace，Node ≥ 22，TS 5.9，ESM | 已确认，不动 |
| Web | Vite 6、React 19、React Router 7、`@rabjs/react`、普通 CSS | 状态集中在 service；不用 Next.js/Tailwind |
| API | Fastify 5 + Zod（经 `packages/dto`） | 路由做认证与入参校验，事务在 service 层 |
| 数据 | PostgreSQL 16+、Drizzle ORM、`pg` | 关系与文档 JSONB 都在这里 |
| 调度 | `ts-fsrs` | 纯函数，固定时钟可测 |
| 编辑器 | Tiptap 3.31（doc-schema 已锁定该版本，根 package.json 有 overrides） | 学科块作为自定义节点 |
| 渲染 | KaTeX（已有）、Mermaid、lowlight 代码高亮（已有） | Mermaid 渲染失败保留源码块 |
| 测试 | Vitest 3 | 逻辑不连库；粘贴/搜索融合是纯函数夹具 |
| Lint | ESLint 9 flat config（新增，根级） | 规则从简：`@typescript-eslint` recommended + `no-console` warn |

## 3. 环境、密钥与外部服务

### 3.1 环境变量（唯一约定）

密钥只出现在 `.env`（gitignored），文档与代码里只有变量名。`apps/server/.env.example` 提交占位符。

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | `postgres://postgres:***@222.128.65.91:25432/unfold_dev`（dev/test 同库，用户明确要求） |
| `DATABASE_URL_PROD` | 同主机 `unfold_prod` 库，仅部署时使用 |
| `MEILI_URL` | `http://222.128.65.91:7700`（公网）/ `http://192.168.9.109:7700`（内网优先） |
| `MEILI_SEARCH_KEY` | 查询用（前端永不直连，服务端代理） |
| `MEILI_ADMIN_KEY` | 建索引、写文档用 |
| `QDRANT_URL` | `http://222.128.65.91:6333` |
| `QDRANT_API_KEY` | 部署时设置 |
| `DASHSCOPE_API_KEY` | 阿里云百炼；**用户尚未提供，缺失时所有模型能力降级（见 6.4、7.3）** |
| `SESSION_SECRET` | Cookie 签名 |
| `UNfold_ENV` | `development` / `production` |

真实值已写入本地 `apps/server/.env`（未提交）。换机器时按 `.env.example` 重填。

### 3.2 PostgreSQL

用户已提供超级用户。初始化一次性执行（阶段 0 任务）：

```sql
CREATE DATABASE unfold_dev;
CREATE DATABASE unfold_prod;
```

迁移用 Drizzle Kit(`drizzle-kit generate` 产出 SQL,`migrate` 在启动前单独执行，可重复）。测试连 `unfold_dev`，每个集成测试文件用事务回滚或清表，不建第三个库。

### 3.3 Qdrant 部署（阶段 0 任务）

用户只确认了 Meilisearch 已就绪；Qdrant 需要部署。在同主机 Docker 执行（若无 SSH 权限，请用户执行）：

```bash
docker run -d --name qdrant --restart unless-stopped \
  -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant
```

集合 `unfold_chunks`:1024 维（DashScope text-embedding-v4 默认维度），cosine。payload 存 `object_id / block_id / owner_type / user_id` 用于过滤。

### 3.4 Meilisearch 索引（阶段 0/2）

索引 `unfold`:`searchableAttributes = [title, aliases, core, text]`（权重递减）,`filterableAttributes = [user_id, kind, domain]`，中文分词用户已验证。文档粒度 = 「点」+「块文本」+「注解/能力原句」，`kind` 字段区分，搜索结果按点分组（PRD 查找旅程要求）。

## 4. 数据模型（PostgreSQL + Drizzle）

对应 PRD 第八节。所有业务表带 `user_id`、`created_at`、`updated_at`；删除默认软删（`deleted_at`)。ID 一律 UUID(`gen_random_uuid()`)。

| 表 | 关键字段 | 约束/说明 |
| --- | --- | --- |
| `users` | `username, password_hash(argon2)` | 迁移种一个用户；注册关闭 |
| `domains` | `name` | 每用户内 name 唯一 |
| `knowledge_objects` | `type, domain_id, canonical_name, normalized_name, aliases jsonb, core_statement, core_version, document_id, status(active/merged), merged_into_id` | `type ∈ concept/principle/method/model/problem`;`normalized_name` = NFKC + trim + 折叠空白 + 小写；`(user_id, domain_id, normalized_name)` 在 `status='active'` 上部分唯一；别名全局（每用户）唯一指向活跃对象 |
| `documents` | `owner_type ∈ object/collection, owner_id, schema_version, content_json jsonb, plain_text, saved_at` | `content_json` 只接受 schema 白名单；服务端用同一 schema 再校验 |
| `document_revisions` | `document_id, content_json, saved_at` | 每文档保留最近 30 次 |
| `block_index` | `block_id, document_id, parent_block_id, position, block_type, text_preview` | 保存文档时重建；块 ID 发放后不复用；外部粘贴 ID 全换新 |
| `collections` | `domain_id, title, intent, parent_collection_id, position, document_id` | 嵌套最多一层（`parent` 的 parent 必须为空）；同一父下 position 唯一 |
| `relations` | `from_id, to_id, type, distinction, what_changed, condition, boundary, note, status, origin` | `type` 十一种词表见 PRD;`status ∈ suggested/accepted/deferred/rejected`;`origin ∈ user/rule/model`；无向类型（contrasts/analogous）唯一键用排序两端；禁自环；`analogous` 边界非空（CHECK：`type<>'analogous' OR boundary <> ''`） |
| `capabilities` | `statement, kind, prompt, hints jsonb, hint_threshold default 3, reference_note, primary_object_id` | `kind ∈ explain/derive/discriminate/vary/counter/implement/transfer/tradeoff` |
| `capability_objects` | `capability_id, object_id` | 多对多 |
| `evidence` | `capability_id, mode, hint_level, rating, obstacle, body` | **无更新接口**;`mode ∈ recall/derive/practice/review/self_report_failure/reread`;`rating ∈ fail/partial/with_hint/independent/saw_material`；应用层拒绝 `hint_level>=3 且 rating='independent'`（阈值取 capabilities.hint_threshold） |
| `review_states` | `capability_id unique, stability, difficulty, due_at, reps, lapses` | 缓存，可由 evidence 整表重放 |
| `sources` | `document_id, kind, locator, plain_fallback(≤1MB), content_hash` | `kind ∈ paste/import/manual` |
| `revisions` | `command, payload jsonb, inverse jsonb, undone_at` | 结构命令日志；未撤销保留最近 50 条 |
| `annotations` | `target_type ∈ relation/capability, target_id, kind, body, resolved_at` | 对象/块级内容走学习块，不用这张表 |

**已废止实体**（对比旧版，防止误建）:`knowledge_systems`、`outline_nodes`、`expressions` 不建表。PRD「一个身份多份上下文」由 `collections` 文档里的 `object_ref` 引用块 + 上下文段落承担。

## 5. 文档与块

权威格式：带 `schemaVersion` 的 ProseMirror JSON，块节点带稳定 UUID。

**块类型注册表**(`packages/doc-schema/src/block-types.ts`，新增）:每种块类型登记 `name / pmNode / renderHint / parsePaste / toMarkdown / searchableText`。三层：

- 基础块：heading、paragraph、list、blockquote、table、code、math、image、divider（现有 schema 已覆盖大部分）。
- 学习块：`derivation_steps`（推导步骤）、`tiered_hints`（分级提示，默认折叠）、`personal_note`（个人理解）、`question`、`counterexample`、`decision`。
- 引用块：`object_ref(object_id)`（活引用）、`collection_ref(collection_id)`。复制断开生成新块并记 `derived_from_block_id`。
- 学科块（阶段 5):`algo_problem`（题面/约束/样例/复杂度）、`theorem`（命题/条件/证明/推论）、`lang_pattern`（句型/例句/对照/易混点）。

粘贴规则沿用现有管道：富 HTML 保表格/代码走 HTML；纯文本含 Markdown 特征走 Markdown；剥离脚本、事件属性、不安全 URL；解析是纯函数，服务端同 schema 复核。图片限 PNG/JPEG/WebP/GIF,≤10MB，拒绝 SVG 上传。

导出包：JSON + 文件；Markdown 由 JSON 派生；对象引用导出为 `[[object:<uuid>|显示名]]`，导入按 ID 还原。

## 6. 搜索（混合检索）

对应 PRD 查找旅程与场景 E（同名跨域并列返回）。

### 6.1 索引管线（保存即同步）

文档保存成功 → 从事务里拿到重建后的 `block_index` → 产出索引条目：

- 点条目：`{ kind:'object', id, title, aliases, core, domain, user_id }`
- 块条目：`{ kind:'block', id, object_id/collection_id, text }`（经块类型的 `searchableText`)
- 注解/能力条目：疑问、决定、能力原句

条目 → ① Meili `addDocuments`(admin key);② DashScope embedding → Qdrant upsert(1024 维，payload 同上）。失败：记录 `index_outbox` 表（待重试），主流程不回滚——**搜索可短暂滞后，正文不能丢**。

### 6.2 查询管线（`packages/search`)

```
query ──┬─ Meili 搜索(top 20)        ──┐
        └─ embedding → Qdrant(top 20)─┴─ RRF 融合(k=60) → 取 top 20 → DashScope gte-rerank(top 20 → top 10)
```

- RRF:`score = Σ 1/(k + rank)`，纯函数，夹具测试。
- 精排输入是条目标题+摘要，不是正文全文；单次 ≤ 20 条。
- 结果按点分组（对象条目 + 其命中块），同名跨域并列不合并（场景 E 验收）。

### 6.3 降级矩阵

| 故障 | 行为 |
| --- | --- |
| DashScope 不可用/无 key | 跳过精排与向量（无 embedding)，只用 Meili 结果 |
| Qdrant 不可用 | 同上（仅关键词） |
| Meili 不可用 | PostgreSQL `ILIKE` 兜底（`normalized_name`、别名、核心陈述、块 text_preview) |
| 全部不可用 | 仍返回 ILIKE 结果；界面标注「检索降级中」 |

### 6.4 成本控制

embedding 只在内容变更时计算；查询期 embedding 每查询一次；精排每查询一次。单用户规模可忽略，但代码里写死上限（top 20 / 单次 ≤ 4KB 文本）。

## 7. AI 能力（建议托盘）

对应 PRD 第十节。

- **规则**(`apps/server/src/suggest/rules.ts`，纯函数）：保存后立即运行——别名/标题命中已有点、第一人称判断句 → `personal_note` 块建议、同段两原理 → 对比建议（禁止合并）、跨域同名 → 类比建议（禁止合并）。
- **模型**:DashScope qwen-plus(OpenAI 兼容端点），仅当配置 key 且规则未填满 5 条时调用。输入 = 本次正文纯文本 + 当前点标题 + ≤30 个候选点（名称+核心陈述）。输出 JSON 经 Zod 校验后落入 `relations(status='suggested', origin='model')` 与建议会话。接口只允许人把 `suggested` 改成 `accepted/deferred/rejected`。
- 每次保存最多一次模型调用；超时/解析失败 → 托盘保留规则结果并标注「模型建议这次没有生成」;无 key → 产品完整可用。

## 8. 学习闭环

- `ts-fsrs` 封装为纯函数 `nextReview(prevState, rating, now)`:rating 映射（`independent`→成功、`with_hint/partial`→较难、`fail`→遗忘、`saw_material`→不推进）；默认权重、目标保持率 0.9、最长间隔 180 天；测试用固定时钟。
- 结构变化触发：点 `core_version` 增加 → 引用该点的合集（经 `block_index` 反查 `object_ref`）标待确认。
- 迁移门槛（应用层断言）:`transfer` 能力创建练习前，其主对象关联的非迁移能力至少一条 `rating='independent'` 证据。
- 被动浏览（打开点、图投影游走）不写 evidence——没有对应 API 路径。

## 9. API 设计（Fastify，`/api` 前缀）

路由只做：认证 → Zod 解析 → 调 service → 序列化。事务与业务规则在 `apps/server/src/services/`。

```
POST   /api/login                 argon2 校验,Set-Cookie(HttpOnly, SameSite=Lax)
POST   /api/logout
GET    /api/today                 今日聚合(当前点、到期能力、游离数、未处理建议、未解疑问)
GET    /api/domains               领域树(合集 + 游离点计数)
POST   /api/objects               建点(一句话核心陈述即可)
GET    /api/objects/:id           点详情(含扇区关系、能力、归位)
PATCH  /api/objects/:id           改名/核心陈述(core_version +1)/别名
POST   /api/objects/:id/merge     合并(仅同域,类比两端拒绝)
DELETE /api/objects/:id           有引用/已接受关系时拒绝并返回计数
GET    /api/objects/:id/doc  PUT /api/objects/:id/doc   文档读写(30 保存点)
POST   /api/objects/:id/paste     粘贴入口(HTML/MD/纯文本 → 块)
GET    /api/collections  POST /api/collections
GET    /api/collections/:id/doc  PUT ...
POST   /api/collections/:id/refs  编入/移出/排序(结构命令 → revisions)
POST   /api/relations             建边(按类型校验必填字段)
PATCH  /api/relations/:id         状态机 suggested→accepted/deferred/rejected
GET    /api/objects/:id/chain     链投影(纯查询)
GET    /api/objects/:id/graph     图投影(一跳邻居,≤50)
GET    /api/capabilities  POST ...
POST   /api/capabilities/:id/evidence   写证据(应用层校验提示阈值/迁移门槛)
GET    /api/review/due            到期能力
POST   /api/suggest               粘贴后建议(规则必有,模型可缺)
POST   /api/suggest/:id/resolve   逐条接受/延后/忽略
GET    /api/search?q=             混合检索(6.2)
GET    /api/export                导出包
POST   /api/undo                  revisions 逆操作
```

错误格式统一 `{ error: { code, message } }`;`code` 供前端区分「拒绝删除：有 N 处引用」这类业务错误。

## 10. 前端架构（apps/web)

- React Router 7 路由：`/today`、`/o/:id`(焦点页，`?proj=content|graph|chain|contrast|caps`)、`/c/:id`(合集)、`/free/:domain`、`/practice/:capabilityId`、`/login`。
- `@rabjs/react` service 划分：`SessionService`、`WorkbenchService`（当前点/投影/扇区）、`TrayService`（建议）、`PracticeService`。组件只读 service，不各自 fetch。
- 编辑器：Tiptap，节点来自 `packages/doc-schema` 注册表；学习块（提示）默认折叠；块 hover 显示类型标记（对齐原型）。
- 图投影：自绘 SVG，坐标 = 扇区方位 + 序号（纯函数，可单测）；链投影同理。
- 样式：普通 CSS，沿用 `docs/prototype/index.html` 的设计语言（变量、衬线正文、钴蓝强调）。**原型是视觉与交互的唯一参照。**

## 11. 安全

- 查询一律带 `user_id`；Cookie HttpOnly + SameSite=Lax，生产加 Secure。
- 粘贴 HTML 清洗（现有 `prepare-html.ts`)；渲染只走 schema JSON，永不 `innerHTML` 原始 HTML。
- Meili/Qdrant/DashScope key 只在 server;SPA 不直连三者。
- 模型调用范围 = 本次正文 + 候选名单，界面可查「这次会送出的范围」。
- 速率限制登录接口；argon2id 参数默认。

## 12. 备份、部署、本地开发

- 本地：`pnpm dev`（并行起 server + web,Vite proxy `/api` → :3000)；迁移 `pnpm --filter @unfold/server migrate`。
- 备份：用户自管 `pg_dump`；应用内「导出包」是用户级备份。
- 生产：单一镜像（构建后的 SPA 由 Fastify 静态托管），前置反向代理终止 HTTPS，连 `unfold_prod`。启动前先跑迁移。

## 13. 测试策略

四层，逐层都有明确归属：

1. **纯函数单测**(Vitest，不连库）：粘贴解析（现有夹具）、RRF 融合、链/图投影坐标、FSRS 封装、关系必填校验、名称规范化。
2. **集成测试**(Vitest + `unfold_dev`)：对象唯一键、合并/删除拒绝、文档保存点、引用完整性、证据约束（提示阈值/迁移门槛）、撤销恢复。
3. **API 契约**:`packages/dto` 的 Zod schema 同时喂 server 校验与 web 类型，契约漂移直接 typecheck 失败。
4. **浏览器验收（金标准）**：每个阶段用 csi skill 驱动真实 Chrome 走该阶段的用户流程（见开发计划各阶段「浏览器验收」）。自动化测试全绿但浏览器里点不通，阶段不算完成。

命令约定：`pnpm test`（全部 Vitest)、`pnpm typecheck`、`pnpm lint`，根级脚本已串好（`pnpm -r`)。

## 14. 主要风险与规避

| 风险 | 规避 |
| --- | --- |
| 粘贴损坏表格/代码 | 现有夹具先行；新块类型先写夹具再写渲染 |
| Qdrant 未部署/超时 | 6.3 降级矩阵；索引写走 outbox 不阻塞保存 |
| DashScope key 缺失 | 模型建议与精排/向量全降级，规则建议与 Meili 不受影响 |
| 图投影滑向全库图 | 一跳、≤50 节点，坐标纯函数 |
| 块类型膨胀 | 新类型评审：没有独立字段/渲染差异就不注册新类型 |
| 复习日被当成分数 | API 只返回证据语言文案需要的数据，不返回合成分数 |
| 密钥进仓库 | `.env*` 已加入 .gitignore;文档只写变量名 |
