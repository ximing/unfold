import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  avatarKey: text('avatar_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const nodes = pgTable(
  'nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    kind: text('kind').notNull().default('text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [check('nodes_kind_check', sql`${table.kind} IN ('text', 'image')`)],
);

export const memberships = pgTable(
  'memberships',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    x: doublePrecision('x'),
    y: doublePrecision('y'),
    z: integer('z'),
    imageWidth: integer('image_width'),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.nodeId] }),
    check(
      'memberships_image_width_check',
      sql`${table.imageWidth} IS NULL OR (${table.imageWidth} >= 120 AND ${table.imageWidth} <= 480)`,
    ),
  ],
);

export const edges = pgTable(
  'edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    fromId: uuid('from_id')
      .notNull()
      .references(() => nodes.id),
    toId: uuid('to_id')
      .notNull()
      .references(() => nodes.id),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check('edges_no_self_loop', sql`${table.fromId} <> ${table.toId}`),
    check('edges_label_not_blank', sql`btrim(${table.label}) <> ''`),
    uniqueIndex('edges_user_from_to_label_active')
      .on(table.userId, table.fromId, table.toId, table.label)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const collectionEdges = pgTable(
  'collection_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    fromId: uuid('from_id')
      .notNull()
      .references(() => collections.id),
    toId: uuid('to_id')
      .notNull()
      .references(() => collections.id),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check('collection_edges_no_self_loop', sql`${table.fromId} <> ${table.toId}`),
    check('collection_edges_label_not_blank', sql`btrim(${table.label}) <> ''`),
    uniqueIndex('collection_edges_user_from_to_label_active')
      .on(table.userId, table.fromId, table.toId, table.label)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ownerKind: text('owner_kind').notNull(),
    ownerId: uuid('owner_id').notNull(),
    cardType: text('card_type').notNull(),
    position: integer('position').notNull().default(0),
    content: jsonb('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'cards_owner_kind_check',
      sql`${table.ownerKind} IN ('node', 'edge', 'collection_edge')`,
    ),
    check(
      'cards_card_type_check',
      sql`${table.cardType} IN ('note', 'code', 'formula', 'person', 'event', 'place', 'period', 'group', 'rich')`,
    ),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ownerKind: text('owner_kind').notNull(),
    ownerId: uuid('owner_id').notNull(),
    mime: text('mime').notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('assets_owner_kind_check', sql`${table.ownerKind} IN ('node', 'card')`),
    uniqueIndex('assets_node_owner_unique')
      .on(table.ownerId)
      .where(sql`${table.ownerKind} = 'node'`),
  ],
);
