CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"title" text NOT NULL,
	"intent" text DEFAULT '' NOT NULL,
	"parent_collection_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"command" text NOT NULL,
	"payload" jsonb NOT NULL,
	"inverse" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"fragment_key" text NOT NULL,
	"kind" text NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"accept_label" text DEFAULT '' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "suggestions_kind_check" CHECK ("suggestions"."kind" IN ('relation', 'personal_note')),
	CONSTRAINT "suggestions_origin_check" CHECK ("suggestions"."origin" IN ('rule', 'model')),
	CONSTRAINT "suggestions_status_check" CHECK ("suggestions"."status" IN ('pending', 'accepted', 'deferred', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_parent_collection_id_collections_id_fk" FOREIGN KEY ("parent_collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_object_id_knowledge_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."knowledge_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_root_position_active" ON "collections" USING btree ("user_id","domain_id","position") WHERE "collections"."parent_collection_id" IS NULL AND "collections"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_child_position_active" ON "collections" USING btree ("user_id","domain_id","parent_collection_id","position") WHERE "collections"."parent_collection_id" IS NOT NULL AND "collections"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "revisions_user_open" ON "revisions" USING btree ("user_id") WHERE "revisions"."deleted_at" IS NULL AND "revisions"."undone_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "suggestions_object_fragment_active" ON "suggestions" USING btree ("user_id","object_id","fragment_key") WHERE "suggestions"."deleted_at" IS NULL;