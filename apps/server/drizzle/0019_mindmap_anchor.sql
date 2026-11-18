ALTER TABLE "collections" ADD COLUMN "mindmap_anchored" boolean DEFAULT false NOT NULL;
ALTER TABLE "memberships" ADD COLUMN "free_x" double precision;
ALTER TABLE "memberships" ADD COLUMN "free_y" double precision;
ALTER TABLE "memberships" ADD COLUMN "free_captured" boolean DEFAULT false NOT NULL;
