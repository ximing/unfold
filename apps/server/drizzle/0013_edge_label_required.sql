UPDATE "edges" SET "label" = '-' WHERE btrim("label") = '';
--> statement-breakpoint
UPDATE "collection_edges" SET "label" = '-' WHERE btrim("label") = '';
--> statement-breakpoint
ALTER TABLE "edges" DROP CONSTRAINT IF EXISTS "edges_label_not_blank";
--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_label_not_blank" CHECK (btrim("label") <> '');
--> statement-breakpoint
ALTER TABLE "collection_edges" DROP CONSTRAINT IF EXISTS "collection_edges_label_not_blank";
--> statement-breakpoint
ALTER TABLE "collection_edges" ADD CONSTRAINT "collection_edges_label_not_blank" CHECK (btrim("label") <> '');
