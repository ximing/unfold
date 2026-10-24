CREATE TABLE "capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"kind" text NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"hints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hint_threshold" integer DEFAULT 3 NOT NULL,
	"reference_note" text DEFAULT '' NOT NULL,
	"primary_object_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "capabilities_kind_check" CHECK ("capabilities"."kind" IN ('explain', 'derive', 'discriminate', 'vary', 'counter', 'implement', 'transfer', 'tradeoff')),
	CONSTRAINT "capabilities_hint_threshold_check" CHECK ("capabilities"."hint_threshold" >= 1)
);
--> statement-breakpoint
CREATE TABLE "capability_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"hint_level" integer DEFAULT 0 NOT NULL,
	"rating" text NOT NULL,
	"obstacle" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "evidence_mode_check" CHECK ("evidence"."mode" IN ('recall', 'derive', 'practice', 'review', 'self_report_failure', 'reread')),
	CONSTRAINT "evidence_rating_check" CHECK ("evidence"."rating" IN ('fail', 'partial', 'with_hint', 'independent', 'saw_material')),
	CONSTRAINT "evidence_hint_level_check" CHECK ("evidence"."hint_level" >= 0)
);
--> statement-breakpoint
CREATE TABLE "review_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "review_states_reps_check" CHECK ("review_states"."reps" >= 0),
	CONSTRAINT "review_states_lapses_check" CHECK ("review_states"."lapses" >= 0)
);
--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_primary_object_id_knowledge_objects_id_fk" FOREIGN KEY ("primary_object_id") REFERENCES "public"."knowledge_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_objects" ADD CONSTRAINT "capability_objects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_objects" ADD CONSTRAINT "capability_objects_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_objects" ADD CONSTRAINT "capability_objects_object_id_knowledge_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."knowledge_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_objects_capability_id_object_id_active_unique" ON "capability_objects" USING btree ("capability_id","object_id") WHERE "capability_objects"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_states_capability_id_active_unique" ON "review_states" USING btree ("capability_id") WHERE "review_states"."deleted_at" IS NULL;