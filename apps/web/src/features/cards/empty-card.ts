import type { CardType, CreateCardBody, OwnerKind } from '@unfold/dto';

export function emptyCard(ownerKind: OwnerKind, ownerId: string, type: CardType): CreateCardBody {
  switch (type) {
    case 'note':
      return { ownerKind, ownerId, type, content: { body: '' } };
    case 'code':
      return { ownerKind, ownerId, type, content: { language: 'JavaScript', source: '' } };
    case 'formula':
      return { ownerKind, ownerId, type, content: { latex: '' } };
    case 'person':
      return { ownerKind, ownerId, type, content: { identity: '', note: '' } };
    case 'event':
      return { ownerKind, ownerId, type, content: { when: '', where: '', summary: '' } };
    case 'place':
      return { ownerKind, ownerId, type, content: { note: '' } };
    case 'period':
      return { ownerKind, ownerId, type, content: { start: '', end: '', note: '' } };
    case 'group':
      return { ownerKind, ownerId, type, content: { note: '' } };
    case 'rich':
      return {
        ownerKind,
        ownerId,
        type,
        content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      };
  }
}
