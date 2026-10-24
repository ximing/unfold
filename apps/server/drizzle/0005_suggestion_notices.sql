CREATE TABLE "suggestion_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"notice" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "suggestion_notices" ADD CONSTRAINT "suggestion_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_notices" ADD CONSTRAINT "suggestion_notices_object_id_knowledge_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."knowledge_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_notices_object_active" ON "suggestion_notices" USING btree ("user_id","object_id") WHERE "suggestion_notices"."deleted_at" IS NULL;