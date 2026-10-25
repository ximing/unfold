import { describe, expect, it } from 'vitest';
import { documentToMarkdown, getBlockType, parsePaste } from '../src/index.js';
import type { PmNode } from '../src/types.js';

const workFrameAttrs = {
  author: '某某',
  edition: '中译本 2019',
  year: '2019',
  genre: '历史',
  premise: '财政能力是否足以解释这场战争的胜负',
  whyRead: '要核对「有钱就能打赢」',
  nextPassage: '第3章',
};

const workFrameMarkdown = `作者: 某某
版本: 中译本 2019
年份: 2019
体裁: 历史
前提: 财政能力是否足以解释这场战争的胜负
为何读: 要核对「有钱就能打赢」
下一段: 第3章`;

const sourcedClaimAttrs = {
  claim: '财政能力决定胜负',
  claimKind: '因果',
  locator: '第3章 p.42',
  excerpt: '有钱就能打赢',
  attribution: '作者',
  narratorReliable: '',
  anchorKind: '',
  anchorLabel: '滑铁卢',
  tieKind: '',
  otherLabel: '甲某',
  workTitle: '某某书',
};

const sourcedClaimMarkdown = `主张: 财政能力决定胜负
种类: 因果
位置: 第3章 p.42
原文: 有钱就能打赢
归属: 作者
叙述: 
锚类: 
锚: 滑铁卢
关系: 
对方: 甲某
书: 某某书`;

function attrsOf(node: PmNode | null | undefined): Record<string, unknown> | undefined {
  return node?.attrs;
}

describe('reading blocks', () => {
  it('round-trips a work frame pasted with full-width colons', () => {
    const spec = getBlockType('work_frame');
    const parsed = spec?.parsePaste(
      '作者：某某\n版本：中译本 2019\n年份：2019\n体裁：历史\n前提：财政能力是否足以解释这场战争的胜负\n为何读：要核对「有钱就能打赢」\n下一段：第3章',
    );
    expect(attrsOf(parsed)).toEqual(workFrameAttrs);
    expect(attrsOf(spec?.parsePaste(spec.toMarkdown(parsed!)))).toEqual(workFrameAttrs);
    expect(spec?.searchableText(parsed!)).toBe(
      '某某 财政能力是否足以解释这场战争的胜负 中译本 2019 2019 历史 要核对「有钱就能打赢」 第3章',
    );
    const partial = spec?.parsePaste('作者：某某\n随便\n\n  前提：财政');
    expect(attrsOf(partial)).toEqual({
      author: '某某',
      edition: '',
      year: '',
      genre: '',
      premise: '财政',
      whyRead: '',
      nextPassage: '',
    });
    expect(spec?.searchableText(partial!)).toBe('某某 财政');
    expect(spec?.toMarkdown(partial!)).toBe('作者: 某某\n版本: \n年份: \n体裁: \n前提: 财政\n为何读: \n下一段: ');

    const doc = parsePaste('', workFrameMarkdown);
    const block = doc.content.content?.[0];
    expect(block?.type).toBe('work_frame');
    expect(block?.attrs?.author).toBe('某某');
    expect(block?.attrs?.premise).toBe('财政能力是否足以解释这场战争的胜负');
    expect(documentToMarkdown(doc.content)).toBe(workFrameMarkdown);

    const withHtml = parsePaste('<p>丢掉这段 html</p>', workFrameMarkdown);
    expect(withHtml.content.content?.[0]?.type).toBe('work_frame');
    expect(withHtml.content.content?.[0]?.attrs?.genre).toBe('历史');
  });

  it('parses a reading role and exports the chinese role word', () => {
    const spec = getBlockType('reading_role');
    const parsed = spec?.parsePaste('角色：人物');
    expect(parsed?.type).toBe('reading_role');
    expect(parsed?.attrs?.role).toBe('人物');
    expect(spec?.searchableText(parsed!)).toBe('人物');
    expect(spec?.toMarkdown(parsed!)).toBe('角色: 人物');
    expect(spec?.parsePaste('普通段落')).toBeNull();

    const doc = parsePaste('', '角色: 情节');
    const block = doc.content.content?.[0];
    expect(block?.type).toBe('reading_role');
    expect(block?.attrs?.role).toBe('情节');
    expect(documentToMarkdown(doc.content)).toBe('角色: 情节');
    expect(spec?.searchableText({ type: 'reading_role', attrs: { role: '情节' } })).toBe('情节');
  });

  it('round-trips a sourced claim and keeps claim, locator, and excerpt apart', () => {
    const spec = getBlockType('sourced_claim');
    const parsed = spec?.parsePaste(
      '主张：财政能力决定胜负\n种类：因果\n位置：第3章 p.42\n原文：有钱就能打赢\n归属：作者\n叙述：\n锚类：\n锚：滑铁卢\n关系：\n对方：甲某\n书：某某书',
    );
    expect(parsed?.type).toBe('sourced_claim');
    expect(parsed?.attrs?.claim).toBe('财政能力决定胜负');
    expect(parsed?.attrs?.locator).toBe('第3章 p.42');
    expect(parsed?.attrs?.excerpt).toBe('有钱就能打赢');
    expect(parsed?.attrs?.claim).not.toBe(parsed?.attrs?.excerpt);
    expect(parsed?.attrs?.locator).not.toBe(parsed?.attrs?.excerpt);
    expect(parsed?.attrs).not.toHaveProperty('aboutObjectId');
    expect(parsed?.attrs).not.toHaveProperty('relationId');
    expect(attrsOf(parsed)).toEqual(sourcedClaimAttrs);
    expect(attrsOf(spec?.parsePaste(spec.toMarkdown(parsed!)))).toEqual(sourcedClaimAttrs);
    expect(spec?.toMarkdown(parsed!)).toBe(sourcedClaimMarkdown);

    const partial = spec?.parsePaste('主张：只有这一句\n随便\n\n  位置：第3章');
    expect(attrsOf(partial)).toEqual({
      claim: '只有这一句',
      claimKind: '',
      locator: '第3章',
      excerpt: '',
      attribution: '',
      narratorReliable: '',
      anchorKind: '',
      anchorLabel: '',
      tieKind: '',
      otherLabel: '',
      workTitle: '',
    });
    expect(spec?.toMarkdown(partial!)).toBe(
      '主张: 只有这一句\n种类: \n位置: 第3章\n原文: \n归属: \n叙述: \n锚类: \n锚: \n关系: \n对方: \n书: ',
    );
    expect(spec?.parsePaste('种类: 因果')).toBeNull();

    const doc = parsePaste('', sourcedClaimMarkdown);
    const block = doc.content.content?.[0];
    expect(block?.type).toBe('sourced_claim');
    expect(block?.attrs?.claim).toBe('财政能力决定胜负');
    expect(block?.attrs?.locator).toBe('第3章 p.42');
    expect(block?.attrs?.excerpt).toBe('有钱就能打赢');
    expect(block?.attrs).not.toHaveProperty('aboutObjectId');
    expect(documentToMarkdown(doc.content)).toBe(sourcedClaimMarkdown);

    const withHtml = parsePaste('<p>丢掉这段 html</p>', sourcedClaimMarkdown);
    expect(withHtml.content.content?.[0]?.type).toBe('sourced_claim');
    expect(withHtml.content.content?.[0]?.attrs?.excerpt).toBe('有钱就能打赢');
  });

  it('searchableText of a sourced claim leads with the claim and the locator', () => {
    const spec = getBlockType('sourced_claim');
    const parsed = spec?.parsePaste(sourcedClaimMarkdown);
    expect(spec?.searchableText(parsed!)).toBe(
      '财政能力决定胜负 第3章 p.42 滑铁卢 甲某 有钱就能打赢 因果',
    );
    expect(spec?.searchableText(parsed!).startsWith('财政能力决定胜负 第3章 p.42')).toBe(true);

    const withIds = spec?.searchableText({
      type: 'sourced_claim',
      attrs: {
        ...sourcedClaimAttrs,
        aboutObjectId: '11111111-1111-4111-8111-111111111111',
        relationId: '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(withIds).toBe('财政能力决定胜负 第3章 p.42 滑铁卢 甲某 有钱就能打赢 因果');
    expect(withIds).not.toContain('11111111');
    expect(withIds).not.toContain('22222222');
    expect(spec?.searchableText({ type: 'sourced_claim', attrs: { claim: '只有这一句' } })).toBe('只有这一句');
  });
});
