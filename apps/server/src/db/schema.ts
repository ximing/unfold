import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  index,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  avatarKey: text('avatar_key'),
  canvasRoute: text('canvas_route').notNull().default('straight'),
  canvasGrid: boolean('canvas_grid').notNull().default(true),
  canvasSnap: boolean('canvas_snap').notNull().default(false),
  canvasLabels: text('canvas_labels').notNull().default('always'),
  canvasMarkers: boolean('canvas_markers').notNull().default(true),
  canvasMinimap: boolean('canvas_minimap').notNull().default(true),
  canvasGrow: text('canvas_grow').notNull().default('down'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  check('users_canvas_route_check', sql`${table.canvasRoute} IN ('straight', 'curve', 'orthogonal')`),
  check('users_canvas_labels_check', sql`${table.canvasLabels} IN ('always', 'focus')`),
  check('users_canvas_grow_check', sql`${table.canvasGrow} IN ('up', 'down', 'left', 'right')`),
]);

export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  edgeDash: text('edge_dash').notNull().default('solid'),
  edgeWidth: text('edge_width').notNull().default('thin'),
  edgeColor: text('edge_color').notNull().default('gray'),
  edgeArrow: text('edge_arrow').notNull().default('end'),
  outlineVersion: integer('outline_version').notNull().default(0),
  outlineInitialized: boolean('outline_initialized').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  check('collections_edge_dash_check', sql`${table.edgeDash} IN ('solid', 'dashed', 'dotted')`),
  check('collections_edge_width_check', sql`${table.edgeWidth} IN ('thin', 'medium', 'thick')`),
  check('collections_edge_color_check', sql`${table.edgeColor} IN ('gray', 'blue', 'green', 'red')`),
  check('collections_edge_arrow_check', sql`${table.edgeArrow} IN ('end', 'none')`),
]);

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
    parentNodeId: uuid('parent_node_id').references(() => nodes.id, { onDelete: 'set null' }),
    outlineOrder: integer('outline_order').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.nodeId] }),
    check(
      'memberships_image_width_check',
      sql`${table.imageWidth} IS NULL OR (${table.imageWidth} >= 120 AND ${table.imageWidth} <= 480)`,
    ),
    check(
      'memberships_parent_not_self_check',
      sql`${table.parentNodeId} IS NULL OR ${table.parentNodeId} <> ${table.nodeId}`,
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

export const collectionInclusions = pgTable(
  'collection_inclusions',
  {
    parentId: uuid('parent_id')
      .notNull()
      .references(() => collections.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => collections.id),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    collapsed: boolean('collapsed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.parentId, table.childId] }),
    check('collection_inclusions_no_self', sql`${table.parentId} <> ${table.childId}`),
    index('collection_inclusions_child_idx').on(table.childId),
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
