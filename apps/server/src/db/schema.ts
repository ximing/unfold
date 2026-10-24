import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('domains_user_id_name_active_unique')
      .on(table.userId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ownerType: text('owner_type').notNull(),
    // 合集表阶段 3 才建，对象或合集二选一，这里不设外键。
    ownerId: uuid('owner_id').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    contentJson: jsonb('content_json').notNull(),
    plainText: text('plain_text').notNull().default(''),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check('documents_owner_type_check', sql`${table.ownerType} IN ('object', 'collection')`),
  ],
);

export const knowledgeObjects = pgTable(
  'knowledge_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domains.id),
    canonicalName: text('canonical_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    aliases: jsonb('aliases').notNull().default(sql`'[]'::jsonb`),
    coreStatement: text('core_statement').notNull().default(''),
    coreVersion: integer('core_version').notNull().default(1),
    // 创建时先有点再有文档，服务层再回填。
    documentId: uuid('document_id').references(() => documents.id),
    status: text('status').notNull().default('active'),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => knowledgeObjects.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'knowledge_objects_type_check',
      sql`${table.type} IN ('concept', 'principle', 'method', 'model', 'problem')`,
    ),
    check('knowledge_objects_status_check', sql`${table.status} IN ('active', 'merged')`),
    uniqueIndex('knowledge_objects_user_domain_normalized_name_active_unique')
      .on(table.userId, table.domainId, table.normalizedName)
      .where(sql`${table.status} = 'active' AND ${table.deletedAt} IS NULL`),
  ],
);

export const documentRevisions = pgTable('document_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  contentJson: jsonb('content_json').notNull(),
  savedAt: timestamp('saved_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const blockIndex = pgTable('block_index', {
  blockId: uuid('block_id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  parentBlockId: uuid('parent_block_id'),
  position: integer('position').notNull(),
  blockType: text('block_type').notNull(),
  textPreview: text('text_preview').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    kind: text('kind').notNull(),
    locator: text('locator').notNull().default(''),
    plainFallback: text('plain_fallback').notNull().default(''),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [check('sources_kind_check', sql`${table.kind} IN ('paste', 'import', 'manual')`)],
);

export const relations = pgTable(
  'relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    fromId: uuid('from_id')
      .notNull()
      .references(() => knowledgeObjects.id),
    toId: uuid('to_id')
      .notNull()
      .references(() => knowledgeObjects.id),
    type: text('type').notNull(),
    distinction: text('distinction').notNull().default(''),
    whatChanged: text('what_changed').notNull().default(''),
    condition: text('condition').notNull().default(''),
    boundary: text('boundary').notNull().default(''),
    note: text('note').notNull().default(''),
    status: text('status').notNull().default('suggested'),
    origin: text('origin').notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'relations_type_check',
      sql`${table.type} IN ('evolves_from', 'prerequisite', 'applies', 'implements', 'contrasts', 'analogous', 'variant', 'fails_when')`,
    ),
    check(
      'relations_status_check',
      sql`${table.status} IN ('suggested', 'accepted', 'deferred', 'rejected')`,
    ),
    check('relations_origin_check', sql`${table.origin} IN ('user', 'rule', 'model')`),
    check('relations_no_self_loop_check', sql`${table.fromId} <> ${table.toId}`),
    check(
      'relations_analogous_boundary_check',
      sql`${table.type} <> 'analogous' OR ${table.boundary} <> ''`,
    ),
    // 无向类型按排序两端去重；有向类型不设唯一索引。
    uniqueIndex('relations_user_undirected_pair_active_unique')
      .on(
        table.userId,
        sql`LEAST(${table.fromId}, ${table.toId})`,
        sql`GREATEST(${table.fromId}, ${table.toId})`,
      )
      .where(sql`${table.deletedAt} IS NULL AND ${table.type} IN ('contrasts', 'analogous')`),
  ],
);

export const annotations = pgTable(
  'annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    targetType: text('target_type').notNull(),
    // capability 表尚未建立，target_id 不设外键。
    targetId: uuid('target_id').notNull(),
    kind: text('kind').notNull(),
    body: text('body').notNull().default(''),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'annotations_target_type_check',
      sql`${table.targetType} IN ('relation', 'capability')`,
    ),
  ],
);

export const indexOutbox = pgTable(
  'index_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    payload: jsonb('payload').notNull(),
    lastError: text('last_error').notNull().default(''),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('index_outbox_user_active')
      .on(table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domains.id),
    title: text('title').notNull(),
    intent: text('intent').notNull().default(''),
    parentCollectionId: uuid('parent_collection_id').references((): AnyPgColumn => collections.id),
    position: integer('position').notNull().default(0),
    documentId: uuid('document_id').references(() => documents.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('collections_root_position_active')
      .on(table.userId, table.domainId, table.position)
      .where(sql`${table.parentCollectionId} IS NULL AND ${table.deletedAt} IS NULL`),
    uniqueIndex('collections_child_position_active')
      .on(table.userId, table.domainId, table.parentCollectionId, table.position)
      .where(sql`${table.parentCollectionId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  ],
);

export const revisions = pgTable(
  'revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    command: text('command').notNull(),
    payload: jsonb('payload').notNull(),
    inverse: jsonb('inverse').notNull(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('revisions_user_open')
      .on(table.userId)
      .where(sql`${table.deletedAt} IS NULL AND ${table.undoneAt} IS NULL`),
  ],
);

// §4 表清单没有 suggestions；§7 与 POST /api/suggest/:id/resolve 要逐条接受/延后/忽略。个人理解块建议不是 relations 行，忽略后同片段不重提需要稳定键。
export const suggestions = pgTable(
  'suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    objectId: uuid('object_id')
      .notNull()
      .references(() => knowledgeObjects.id),
    fragmentKey: text('fragment_key').notNull(),
    kind: text('kind').notNull(),
    origin: text('origin').notNull(),
    status: text('status').notNull().default('pending'),
    summary: text('summary').notNull().default(''),
    acceptLabel: text('accept_label').notNull().default(''),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check('suggestions_kind_check', sql`${table.kind} IN ('relation', 'personal_note')`),
    check('suggestions_origin_check', sql`${table.origin} IN ('rule', 'model')`),
    check(
      'suggestions_status_check',
      sql`${table.status} IN ('pending', 'accepted', 'deferred', 'rejected')`,
    ),
    uniqueIndex('suggestions_object_fragment_active')
      .on(table.userId, table.objectId, table.fragmentKey)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

// 模型建议这次的托盘文案。无 key 或开关关闭时写空字符串，不写失败句。
export const suggestionNotices = pgTable(
  'suggestion_notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    objectId: uuid('object_id').notNull().references(() => knowledgeObjects.id),
    notice: text('notice').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('suggestion_notices_object_active')
      .on(table.userId, table.objectId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const capabilities = pgTable(
  'capabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    statement: text('statement').notNull(),
    kind: text('kind').notNull(),
    prompt: text('prompt').notNull().default(''),
    hints: jsonb('hints').notNull().default(sql`'[]'::jsonb`),
    hintThreshold: integer('hint_threshold').notNull().default(3),
    referenceNote: text('reference_note').notNull().default(''),
    primaryObjectId: uuid('primary_object_id')
      .notNull()
      .references(() => knowledgeObjects.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'capabilities_kind_check',
      sql`${table.kind} IN ('explain', 'derive', 'discriminate', 'vary', 'counter', 'implement', 'transfer', 'tradeoff')`,
    ),
    check('capabilities_hint_threshold_check', sql`${table.hintThreshold} >= 1`),
  ],
);

export const capabilityObjects = pgTable(
  'capability_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capabilities.id),
    objectId: uuid('object_id')
      .notNull()
      .references(() => knowledgeObjects.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('capability_objects_capability_id_object_id_active_unique')
      .on(table.capabilityId, table.objectId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const evidence = pgTable(
  'evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capabilities.id),
    mode: text('mode').notNull(),
    hintLevel: integer('hint_level').notNull().default(0),
    rating: text('rating').notNull(),
    obstacle: text('obstacle').notNull().default(''),
    body: text('body').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'evidence_mode_check',
      sql`${table.mode} IN ('recall', 'derive', 'practice', 'review', 'self_report_failure', 'reread')`,
    ),
    check(
      'evidence_rating_check',
      sql`${table.rating} IN ('fail', 'partial', 'with_hint', 'independent', 'saw_material')`,
    ),
    check('evidence_hint_level_check', sql`${table.hintLevel} >= 0`),
  ],
);

export const reviewStates = pgTable(
  'review_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capabilities.id),
    stability: doublePrecision('stability').notNull(),
    difficulty: doublePrecision('difficulty').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('review_states_capability_id_active_unique')
      .on(table.capabilityId)
      .where(sql`${table.deletedAt} IS NULL`),
    check('review_states_reps_check', sql`${table.reps} >= 0`),
    check('review_states_lapses_check', sql`${table.lapses} >= 0`),
  ],
);
