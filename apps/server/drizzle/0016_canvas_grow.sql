ALTER TABLE "users" ADD COLUMN "canvas_grow" text DEFAULT 'down' NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_canvas_grow_check" CHECK ("canvas_grow" IN ('up', 'down', 'left', 'right'));
