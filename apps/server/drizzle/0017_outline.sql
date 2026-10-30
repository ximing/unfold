ALTER TABLE "collections" ADD COLUMN "outline_version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "collections" ADD COLUMN "outline_initialized" boolean DEFAULT false NOT NULL;

ALTER TABLE "memberships" ADD COLUMN "parent_node_id" uuid;
ALTER TABLE "memberships" ADD COLUMN "outline_order" integer DEFAULT 0 NOT NULL;
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_parent_node_id_nodes_id_fk"
  FOREIGN KEY ("parent_node_id") REFERENCES "nodes"("id") ON DELETE SET NULL;
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_parent_not_self_check"
  CHECK ("parent_node_id" IS NULL OR "parent_node_id" <> "node_id");
