CREATE TABLE "collection_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"seen_core_version" integer NOT NULL,
	"seen_statement" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collection_reads_seen_version_check" CHECK ("collection_reads"."seen_core_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "collection_reads" ADD CONSTRAINT "collection_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_reads" ADD CONSTRAINT "collection_reads_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_reads" ADD CONSTRAINT "collection_reads_object_id_knowledge_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."knowledge_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_reads_pair_active" ON "collection_reads" USING btree ("collection_id","object_id") WHERE "collection_reads"."deleted_at" IS NULL;