export const SCHEMA_VERSION = 1 as const;

export type PmMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type PmNode = {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: PmMark[];
  content?: PmNode[];
};

export type UnfoldDocument = {
  schemaVersion: typeof SCHEMA_VERSION;
  content: PmNode;
};
