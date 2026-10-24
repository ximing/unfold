import type { CreateRelationBody, RelationType } from '@unfold/dto';
import { describe, expect, it } from 'vitest';
import {
  canTransition,
  needsCrossDomainConfirm,
  sectorFor,
  validateRelation,
} from './relation-rules.js';

const fromId = '550e8400-e29b-41d4-a716-446655440000';
const toId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const outsideId = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

function relation(
  type: RelationType,
  fields: Partial<CreateRelationBody> = {},
): CreateRelationBody {
  return { fromId, toId, type, ...fields };
}

const invalid = (message: string) => ({ ok: false as const, code: 'invalid_relation' as const, message });

describe('validateRelation', () => {
  it('requires whatChanged for evolves_from', () => {
    expect(validateRelation(relation('evolves_from'))).toEqual(invalid('演化要写清变化了什么'));
    expect(validateRelation(relation('evolves_from', { whatChanged: '' }))).toEqual(
      invalid('演化要写清变化了什么'),
    );
    expect(validateRelation(relation('evolves_from', { whatChanged: '去掉了全局锁' }))).toEqual({
      ok: true,
    });
  });

  it('requires distinction for contrasts', () => {
    expect(validateRelation(relation('contrasts'))).toEqual(invalid('对比要写清区别'));
    expect(validateRelation(relation('contrasts', { distinction: '' }))).toEqual(invalid('对比要写清区别'));
    expect(validateRelation(relation('contrasts', { distinction: '一个管顺序，一个管代价' }))).toEqual({
      ok: true,
    });
  });

  it('requires boundary for analogous', () => {
    expect(validateRelation(relation('analogous'))).toEqual(invalid('类比要写清边界'));
    expect(validateRelation(relation('analogous', { boundary: '' }))).toEqual(invalid('类比要写清边界'));
    expect(validateRelation(relation('analogous', { boundary: '只在稳态时像' }))).toEqual({ ok: true });
  });

  it('requires whatChanged and condition for variant', () => {
    const message = '变化要写清变成了什么，以及在什么条件下';
    expect(validateRelation(relation('variant'))).toEqual(invalid(message));
    expect(validateRelation(relation('variant', { whatChanged: '改成迭代', condition: '' }))).toEqual(
      invalid(message),
    );
    expect(validateRelation(relation('variant', { whatChanged: '', condition: '数据进内存' }))).toEqual(
      invalid(message),
    );
    expect(
      validateRelation(relation('variant', { whatChanged: '改成迭代', condition: '数据进内存' })),
    ).toEqual({ ok: true });
  });

  it('requires whatChanged and condition for fails_when', () => {
    const message = '变化要写清变成了什么，以及在什么条件下';
    expect(validateRelation(relation('fails_when', { whatChanged: '退化为扫描' }))).toEqual(invalid(message));
    expect(validateRelation(relation('fails_when', { condition: '键无序' }))).toEqual(invalid(message));
    expect(
      validateRelation(relation('fails_when', { whatChanged: '退化为扫描', condition: '键无序' })),
    ).toEqual({ ok: true });
  });

  it('allows an empty explanation for prerequisite, applies, and implements', () => {
    for (const type of ['prerequisite', 'applies', 'implements'] as const) {
      expect(validateRelation(relation(type))).toEqual({ ok: true });
      expect(
        validateRelation(
          relation(type, { distinction: '', whatChanged: '', condition: '', boundary: '', note: '' }),
        ),
      ).toEqual({ ok: true });
    }
  });

  it('rejects a self-loop', () => {
    expect(validateRelation(relation('prerequisite', { toId: fromId }))).toEqual(invalid('不能连接自己'));
    expect(
      validateRelation(relation('evolves_from', { toId: fromId, whatChanged: '去掉了全局锁' })),
    ).toEqual(invalid('不能连接自己'));
  });
});

describe('sectorFor', () => {
  it('places evolves_from on origin and destination', () => {
    const edge = { fromId, toId, type: 'evolves_from' as const };
    expect(sectorFor(fromId, edge)).toBe('origin');
    expect(sectorFor(toId, edge)).toBe('destination');
  });

  it('places a prerequisite of the focus on origin', () => {
    const edge = { fromId, toId, type: 'prerequisite' as const };
    expect(sectorFor(toId, edge)).toBe('origin');
    expect(sectorFor(fromId, edge)).toBe('destination');
  });

  it('places analogous on contrast', () => {
    const analogous = { fromId, toId, type: 'analogous' as const };
    expect(sectorFor(fromId, analogous)).toBe('contrast');
    expect(sectorFor(toId, analogous)).toBe('contrast');
    const contrasts = { fromId, toId, type: 'contrasts' as const };
    expect(sectorFor(fromId, contrasts)).toBe('contrast');
    expect(sectorFor(toId, contrasts)).toBe('contrast');
  });

  it('places variant on change', () => {
    const variant = { fromId, toId, type: 'variant' as const };
    expect(sectorFor(fromId, variant)).toBe('change');
    expect(sectorFor(toId, variant)).toBe('change');
    const failsWhen = { fromId, toId, type: 'fails_when' as const };
    expect(sectorFor(fromId, failsWhen)).toBe('change');
    expect(sectorFor(toId, failsWhen)).toBe('change');
  });

  it('shows applies and implements only from the source', () => {
    for (const type of ['applies', 'implements'] as const) {
      const edge = { fromId, toId, type };
      expect(sectorFor(fromId, edge)).toBe('destination');
      expect(sectorFor(toId, edge)).toBeNull();
    }
  });

  it('returns null when the focus is not on the edge', () => {
    expect(sectorFor(outsideId, { fromId, toId, type: 'evolves_from' })).toBeNull();
    expect(sectorFor(outsideId, { fromId, toId, type: 'analogous' })).toBeNull();
  });
});

describe('canTransition', () => {
  it('rejects a change that starts from accepted', () => {
    expect(canTransition('accepted', 'accepted')).toBe(false);
    expect(canTransition('accepted', 'deferred')).toBe(false);
    expect(canTransition('accepted', 'rejected')).toBe(false);
    expect(canTransition('deferred', 'accepted')).toBe(false);
    expect(canTransition('rejected', 'suggested')).toBe(false);
    expect(canTransition('suggested', 'suggested')).toBe(false);
  });

  it('allows suggested to become accepted, deferred, or rejected', () => {
    expect(canTransition('suggested', 'accepted')).toBe(true);
    expect(canTransition('suggested', 'deferred')).toBe(true);
    expect(canTransition('suggested', 'rejected')).toBe(true);
  });
});

describe('needsCrossDomainConfirm', () => {
  it('is true for a cross-domain relation that is not analogous', () => {
    for (const type of [
      'evolves_from',
      'prerequisite',
      'applies',
      'implements',
      'contrasts',
      'variant',
      'fails_when',
    ] as const) {
      expect(needsCrossDomainConfirm(type, false)).toBe(true);
    }
  });

  it('is false for a cross-domain analogy', () => {
    expect(needsCrossDomainConfirm('analogous', false)).toBe(false);
  });

  it('is false for evolves_from in the same domain', () => {
    expect(needsCrossDomainConfirm('evolves_from', true)).toBe(false);
  });
});
