import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
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
