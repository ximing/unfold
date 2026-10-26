import { z } from 'zod';

const textAlignSchema = z.enum(['left', 'center', 'right']);

const colorSchema = z.string().regex(/^(|#[0-9A-Fa-f]{6})$/);

const fontSizeSchema = z.enum([
  '',
  '12',
  '13',
  '14',
  '15',
  '16',
  '18',
  '20',
  '22',
  '24',
  '28',
  '32',
  '36',
]);

const alignAttrsSchema = z.strictObject({
  textAlign: textAlignSchema.optional(),
});

const headingAttrsSchema = z.strictObject({
  level: z.int().min(1).max(6),
  textAlign: textAlignSchema.optional(),
});

const codeAttrsSchema = z.strictObject({
  language: z.string().max(40).optional(),
  textAlign: textAlignSchema.optional(),
});

const cellAttrsSchema = z.strictObject({
  colspan: z.int().min(1).max(20).optional(),
  rowspan: z.int().min(1).max(20).optional(),
  backgroundColor: colorSchema.optional(),
});

const taskAttrsSchema = z.strictObject({
  checked: z.boolean(),
  textAlign: textAlignSchema.optional(),
});

const imageAttrsSchema = z.strictObject({
  src: z.uuid(),
  alt: z.string().max(200).optional(),
  width: z.number().min(32).max(1200).nullable().optional(),
});

const mathAttrsSchema = z.strictObject({
  latex: z.string().max(8000),
});

const mermaidAttrsSchema = z.strictObject({
  source: z.string().max(20000),
});

const markSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({ type: z.literal('strike') }),
  z.strictObject({ type: z.literal('code') }),
  z.strictObject({ type: z.literal('underline') }),
  z.strictObject({ type: z.literal('subscript') }),
  z.strictObject({ type: z.literal('superscript') }),
  z.strictObject({
    type: z.literal('link'),
    attrs: z.strictObject({ href: z.string().max(2000) }),
  }),
  z.strictObject({
    type: z.literal('textStyle'),
    attrs: z
      .strictObject({
        color: colorSchema.optional(),
        fontSize: fontSizeSchema.optional(),
        backgroundColor: colorSchema.optional(),
      })
      .optional(),
  }),
]);

export type RichMark = {
  type: string;
  attrs?: {
    href?: string;
    color?: string;
    fontSize?: string;
    backgroundColor?: string;
  };
};

export type RichNode = {
  type: string;
  text?: string;
  attrs?: {
    level?: number;
    textAlign?: 'left' | 'center' | 'right';
    language?: string;
    src?: string;
    alt?: string;
    width?: number | null;
    latex?: string;
    source?: string;
    checked?: boolean;
    colspan?: number;
    rowspan?: number;
    color?: string;
    fontSize?: string;
    backgroundColor?: string;
    href?: string;
  };
  marks?: RichMark[];
  content?: RichNode[];
};

export type RichDoc = {
  type: 'doc';
  content?: RichNode[];
};

export const richNodeSchema: z.ZodType<RichNode> = z.lazy(() => {
  const content = z.array(richNodeSchema).optional();

  function loose<const T extends string>(type: T) {
    return z.strictObject({
      type: z.literal(type),
      attrs: alignAttrsSchema.optional(),
      content,
    });
  }

  function looseWith<const T extends string, A extends z.ZodType>(type: T, attrs: A) {
    return z.strictObject({
      type: z.literal(type),
      attrs: attrs.optional(),
      content,
    });
  }

  function tight<const T extends string, A extends z.ZodType>(type: T, attrs: A) {
    return z.strictObject({
      type: z.literal(type),
      attrs,
      content,
    });
  }

  return z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('doc'), content }),
    loose('paragraph'),
    tight('heading', headingAttrsSchema),
    z.strictObject({
      type: z.literal('text'),
      text: z.string(),
      marks: z.array(markSchema).optional(),
    }),
    loose('bulletList'),
    loose('orderedList'),
    loose('listItem'),
    loose('taskList'),
    tight('taskItem', taskAttrsSchema),
    loose('blockquote'),
    looseWith('codeBlock', codeAttrsSchema),
    z.strictObject({ type: z.literal('horizontalRule') }),
    z.strictObject({ type: z.literal('hardBreak') }),
    loose('table'),
    loose('tableRow'),
    looseWith('tableHeader', cellAttrsSchema),
    looseWith('tableCell', cellAttrsSchema),
    z.strictObject({ type: z.literal('image'), attrs: imageAttrsSchema }),
    z.strictObject({ type: z.literal('inlineMath'), attrs: mathAttrsSchema }),
    z.strictObject({ type: z.literal('blockMath'), attrs: mathAttrsSchema }),
    z.strictObject({ type: z.literal('mermaid'), attrs: mermaidAttrsSchema }),
  ]);
});

export const richDocSchema: z.ZodType<RichDoc> = z.strictObject({
  type: z.literal('doc'),
  content: z.array(richNodeSchema).optional(),
});

export const richWriteContentSchema = z.strictObject({
  doc: richDocSchema,
});

/** 更新时丢掉客户端的 plain，其它多余字段仍拒绝。 */
export const richPatchContentSchema = z
  .strictObject({
    doc: richDocSchema,
    plain: z.unknown().optional(),
  })
  .transform(({ doc }) => ({ doc }));

export const richStoredContentSchema = z.strictObject({
  doc: richDocSchema,
  plain: z.string(),
});
