DROP TABLE "review_states" CASCADE;--> statement-breakpoint
DROP TABLE "evidence" CASCADE;--> statement-breakpoint
DROP TABLE "capability_objects" CASCADE;--> statement-breakpoint
DROP TABLE "capabilities" CASCADE;--> statement-breakpoint
DROP TABLE "suggestion_notices" CASCADE;--> statement-breakpoint
DROP TABLE "suggestions" CASCADE;--> statement-breakpoint
DROP TABLE "revisions" CASCADE;--> statement-breakpoint
DROP TABLE "collection_reads" CASCADE;--> statement-breakpoint
DROP TABLE "collections" CASCADE;--> statement-breakpoint
DROP TABLE "index_outbox" CASCADE;--> statement-breakpoint
DROP TABLE "annotations" CASCADE;--> statement-breakpoint
DROP TABLE "relations" CASCADE;--> statement-breakpoint
DROP TABLE "sources" CASCADE;--> statement-breakpoint
DROP TABLE "block_index" CASCADE;--> statement-breakpoint
DROP TABLE "document_revisions" CASCADE;--> statement-breakpoint
DROP TABLE "knowledge_objects" CASCADE;--> statement-breakpoint
DROP TABLE "documents" CASCADE;--> statement-breakpoint
DROP TABLE "domains" CASCADE;--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"collection_id" uuid NOT NULL REFERENCES "collections"("id"),
	"node_id" uuid NOT NULL REFERENCES "nodes"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_collection_id_node_id_pk" PRIMARY KEY("collection_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"from_id" uuid NOT NULL REFERENCES "nodes"("id"),
	"to_id" uuid NOT NULL REFERENCES "nodes"("id"),
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "edges_no_self_loop" CHECK ("from_id" <> "to_id"),
	CONSTRAINT "edges_label_not_blank" CHECK (btrim("label") <> '')
);
--> statement-breakpoint
CREATE TABLE "collection_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"from_id" uuid NOT NULL REFERENCES "collections"("id"),
	"to_id" uuid NOT NULL REFERENCES "collections"("id"),
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collection_edges_no_self_loop" CHECK ("from_id" <> "to_id"),
	CONSTRAINT "collection_edges_label_not_blank" CHECK (btrim("label") <> '')
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"card_type" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cards_owner_kind_check" CHECK ("owner_kind" IN ('node', 'edge', 'collection_edge')),
	CONSTRAINT "cards_card_type_check" CHECK ("card_type" IN ('note', 'code', 'formula', 'person', 'event', 'place', 'period', 'group'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "edges_user_from_to_label_active" ON "edges" USING btree ("user_id","from_id","to_id","label") WHERE "edges"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_edges_user_from_to_label_active" ON "collection_edges" USING btree ("user_id","from_id","to_id","label") WHERE "collection_edges"."deleted_at" IS NULL;
