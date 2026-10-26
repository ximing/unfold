ALTER TABLE "nodes" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;
--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_kind_check" CHECK ("kind" IN ('text', 'image'));
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "x" double precision;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "y" double precision;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "z" integer;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "image_width" integer;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_image_width_check" CHECK ("image_width" IS NULL OR ("image_width" >= 120 AND "image_width" <= 480));
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_owner_kind_check" CHECK ("owner_kind" IN ('node', 'card'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assets_node_owner_unique" ON "assets" USING btree ("owner_id") WHERE "assets"."owner_kind" = 'node';
--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_card_type_check";
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_card_type_check" CHECK ("card_type" IN ('note', 'code', 'formula', 'person', 'event', 'place', 'period', 'group', 'rich'));
