ALTER TABLE "collections" ADD COLUMN "edge_dash" text DEFAULT 'solid' NOT NULL;
ALTER TABLE "collections" ADD COLUMN "edge_width" text DEFAULT 'thin' NOT NULL;
ALTER TABLE "collections" ADD COLUMN "edge_color" text DEFAULT 'gray' NOT NULL;
ALTER TABLE "collections" ADD COLUMN "edge_arrow" text DEFAULT 'end' NOT NULL;
ALTER TABLE "collections" ADD CONSTRAINT "collections_edge_dash_check" CHECK ("edge_dash" IN ('solid', 'dashed', 'dotted'));
ALTER TABLE "collections" ADD CONSTRAINT "collections_edge_width_check" CHECK ("edge_width" IN ('thin', 'medium', 'thick'));
ALTER TABLE "collections" ADD CONSTRAINT "collections_edge_color_check" CHECK ("edge_color" IN ('gray', 'blue', 'green', 'red'));
ALTER TABLE "collections" ADD CONSTRAINT "collections_edge_arrow_check" CHECK ("edge_arrow" IN ('end', 'none'));

ALTER TABLE "users" ADD COLUMN "canvas_route" text DEFAULT 'straight' NOT NULL;
ALTER TABLE "users" ADD COLUMN "canvas_grid" boolean DEFAULT true NOT NULL;
ALTER TABLE "users" ADD COLUMN "canvas_snap" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN "canvas_labels" text DEFAULT 'always' NOT NULL;
ALTER TABLE "users" ADD COLUMN "canvas_markers" boolean DEFAULT true NOT NULL;
ALTER TABLE "users" ADD COLUMN "canvas_minimap" boolean DEFAULT true NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_canvas_route_check" CHECK ("canvas_route" IN ('straight', 'curve', 'orthogonal'));
ALTER TABLE "users" ADD CONSTRAINT "users_canvas_labels_check" CHECK ("canvas_labels" IN ('always', 'focus'));
