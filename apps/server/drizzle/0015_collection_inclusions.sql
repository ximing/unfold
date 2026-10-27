CREATE TABLE "collection_inclusions" (
  "parent_id" uuid NOT NULL REFERENCES "collections"("id"),
  "child_id" uuid NOT NULL REFERENCES "collections"("id"),
  "x" double precision NOT NULL,
  "y" double precision NOT NULL,
  "collapsed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "collection_inclusions_pkey" PRIMARY KEY ("parent_id", "child_id"),
  CONSTRAINT "collection_inclusions_no_self" CHECK ("parent_id" <> "child_id")
);
CREATE INDEX "collection_inclusions_child_idx" ON "collection_inclusions" ("child_id");
