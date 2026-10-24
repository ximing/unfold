export type SearchKind = 'object' | 'block' | 'question' | 'decision' | 'collection_sentence';

export type SearchEntry = {
  id: string;
  kind: SearchKind;
  entityId: string;
  userId: string;
  objectId: string | null;
  collectionId: string | null;
  domain: string;
  title: string;
  aliases: string[];
  core: string;
  text: string;
  promote: boolean;
};

export type IndexedBlock = {
  blockId: string;
  blockType: string;
  text: string;
};

export function objectEntry(input: {
  userId: string;
  objectId: string;
  domain: string;
  title: string;
  aliases: readonly string[];
  core: string;
}): SearchEntry {
  return {
    id: `object:${input.objectId}`,
    kind: 'object',
    entityId: input.objectId,
    userId: input.userId,
    objectId: input.objectId,
    collectionId: null,
    domain: input.domain,
    title: input.title,
    aliases: [...input.aliases],
    core: input.core,
    text: '',
    promote: false,
  };
}

export function blockEntries(input: {
  userId: string;
  ownerType: 'object' | 'collection';
  ownerId: string;
  domain: string;
  title: string;
  core: string;
  blocks: readonly IndexedBlock[];
}): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const objectId = input.ownerType === 'object' ? input.ownerId : null;
  const collectionId = input.ownerType === 'collection' ? input.ownerId : null;

  for (const block of input.blocks) {
    const text = block.text.trim();
    if (text === '') {
      continue;
    }
    if (block.blockType === 'object_ref' || block.blockType === 'collection_ref') {
      continue;
    }

    const shaped = shapeBlock(block.blockType, block.blockId, input.ownerType);
    entries.push({
      id: shaped.id,
      kind: shaped.kind,
      entityId: block.blockId,
      userId: input.userId,
      objectId,
      collectionId,
      domain: input.domain,
      title: input.title,
      aliases: [],
      core: input.core,
      text,
      promote: shaped.promote,
    });
  }

  return entries;
}

function shapeBlock(
  blockType: string,
  blockId: string,
  ownerType: 'object' | 'collection',
): { id: string; kind: SearchKind; promote: boolean } {
  if (blockType === 'question') {
    return { id: `question:${blockId}`, kind: 'question', promote: false };
  }
  if (blockType === 'decision') {
    return { id: `decision:${blockId}`, kind: 'decision', promote: false };
  }
  if (ownerType === 'collection') {
    return {
      id: `collection_sentence:${blockId}`,
      kind: 'collection_sentence',
      promote: true,
    };
  }
  return { id: `block:${blockId}`, kind: 'block', promote: false };
}
