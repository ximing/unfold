import type { RichDoc, RichNode } from '@unfold/dto';

export type ExplainTemplateId = 'concept' | 'algorithm' | 'theorem' | 'history' | 'work' | 'source';

export type ExplainTemplate = {
  id: ExplainTemplateId;
  title: string;
  extra: boolean;
};

export const EXPLAIN_TEMPLATES: readonly ExplainTemplate[] = [
  { id: 'concept', title: '概念解释', extra: false },
  { id: 'algorithm', title: '算法 / 机制', extra: false },
  { id: 'theorem', title: '定理 / 例题', extra: true },
  { id: 'history', title: '史料', extra: true },
  { id: 'work', title: '作品细读', extra: true },
  { id: 'source', title: '出处', extra: true },
];

const SECTIONS: Record<ExplainTemplateId, readonly string[]> = {
  concept: ['自己的解释', '边界与不适用'],
  algorithm: ['步骤', '取舍'],
  theorem: ['条件', '依据'],
  history: ['原文', '推断'],
  work: ['篇章', '意象'],
  source: ['标题', '作者或版本', '链接或页码 / 章节', '原文摘录', '自己的说明'],
};

/** 模板格的小节提示：小节名用「 · 」连接；出处小节多，只列前三个再加省略号。 */
export const TEMPLATE_HINTS: Record<ExplainTemplateId, string> = Object.fromEntries(
  (Object.keys(SECTIONS) as ExplainTemplateId[]).map((id) => [
    id,
    id === 'source' ? `${SECTIONS[id].slice(0, 3).join(' · ')}…` : SECTIONS[id].join(' · '),
  ]),
) as Record<ExplainTemplateId, string>;

function paragraph(text: string): RichNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function blankParagraph(): RichNode {
  return { type: 'paragraph' };
}

/** 一张可删改的富文本。每个标题是普通段落，下面留一行空段落。 */
export function explainTemplateDoc(id: ExplainTemplateId): RichDoc {
  const content: RichNode[] = [];
  for (const title of SECTIONS[id]) {
    content.push(paragraph(title));
    content.push(blankParagraph());
  }
  return { type: 'doc', content };
}
