import type { CreateRelationBody, RelationStatus, RelationType } from '@unfold/dto';

export type RelationSector = 'origin' | 'destination' | 'contrast' | 'change';

export type RelationValidation =
  | { ok: true }
  | { ok: false; code: 'invalid_relation'; message: string };

function text(value: string | undefined): string {
  return value ?? '';
}

function requiredMessage(input: CreateRelationBody): string | null {
  const whatChanged = text(input.whatChanged);
  const condition = text(input.condition);
  switch (input.type) {
    case 'evolves_from':
      return whatChanged === '' ? '演化要写清变化了什么' : null;
    case 'contrasts':
      return text(input.distinction) === '' ? '对比要写清区别' : null;
    case 'analogous':
      return text(input.boundary) === '' ? '类比要写清边界' : null;
    case 'variant':
    case 'fails_when':
      return whatChanged === '' || condition === ''
        ? '变化要写清变成了什么，以及在什么条件下'
        : null;
    case 'prerequisite':
    case 'applies':
    case 'implements':
      return null;
  }
}

export function validateRelation(input: CreateRelationBody): RelationValidation {
  if (input.fromId === input.toId) {
    return { ok: false, code: 'invalid_relation', message: '不能连接自己' };
  }
  const message = requiredMessage(input);
  if (message !== null) return { ok: false, code: 'invalid_relation', message };
  return { ok: true };
}

export function sectorFor(
  focusId: string,
  relation: { fromId: string; toId: string; type: RelationType },
): RelationSector | null {
  const fromFocus = relation.fromId === focusId;
  const toFocus = relation.toId === focusId;
  if (!fromFocus && !toFocus) return null;

  switch (relation.type) {
    case 'evolves_from':
      return fromFocus ? 'origin' : 'destination';
    case 'prerequisite':
      return toFocus ? 'origin' : 'destination';
    case 'applies':
    case 'implements':
      return fromFocus ? 'destination' : null;
    case 'contrasts':
    case 'analogous':
      return 'contrast';
    case 'variant':
    case 'fails_when':
      return 'change';
  }
}

export function canTransition(from: RelationStatus, to: RelationStatus): boolean {
  if (from !== 'suggested') return false;
  return to === 'accepted' || to === 'deferred' || to === 'rejected';
}

export function needsCrossDomainConfirm(type: RelationType, sameDomain: boolean): boolean {
  return sameDomain === false && type !== 'analogous';
}
