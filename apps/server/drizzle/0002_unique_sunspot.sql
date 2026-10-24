CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "annotations_target_type_check" CHECK ("annotations"."target_type" IN ('relation', 'capability'))
);
--> statement-breakpoint
CREATE TABLE "relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"type" text NOT NULL,
	"distinction" text DEFAULT '' NOT NULL,
	"what_changed" text DEFAULT '' NOT NULL,
	"condition" text DEFAULT '' NOT NULL,
	"boundary" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "relations_type_check" CHECK ("relations"."type" IN ('evolves_from', 'prerequisite', 'applies', 'implements', 'contrasts', 'analogous', 'variant', 'fails_when')),
	CONSTRAINT "relations_status_check" CHECK ("relations"."status" IN ('suggested', 'accepted', 'deferred', 'rejected')),
	CONSTRAINT "relations_origin_check" CHECK ("relations"."origin" IN ('user', 'rule', 'model')),
	CONSTRAINT "relations_no_self_loop_check" CHECK ("relations"."from_id" <> "relations"."to_id"),
	CONSTRAINT "relations_analogous_boundary_check" CHECK ("relations"."type" <> 'analogous' OR "relations"."boundary" <> '')
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_from_id_knowledge_objects_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."knowledge_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_to_id_knowledge_objects_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."knowledge_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relations_user_undirected_pair_active_unique" ON "relations" USING btree ("user_id",LEAST("from_id", "to_id"),GREATEST("from_id", "to_id")) WHERE "relations"."deleted_at" IS NULL AND "relations"."type" IN ('contrasts', 'analogous');