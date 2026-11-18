ALTER TABLE "collections" ADD COLUMN "layout_direction" text DEFAULT 'right' NOT NULL;
ALTER TABLE "collections" ADD CONSTRAINT "collections_layout_direction_check" CHECK ("layout_direction" IN ('right', 'left', 'both'));

ALTER TABLE "memberships" ADD COLUMN "layout_side" text;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_layout_side_check" CHECK ("layout_side" IS NULL OR "layout_side" IN ('left', 'right'));
