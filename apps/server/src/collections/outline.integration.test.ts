import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { indent, moveSibling, outdent } from '@unfold/dto';
import type { OutlineItem } from '@unfold/dto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../app.js';
import { createDb, createPool } from '../db/client.js';
import { collections, memberships } from '../db/schema.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

function cookiePair(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('missing set-cookie');
  const pair = header.split(';')[0];
  if (!pair) throw new Error('missing set-cookie');
  return pair;
}

function errorOf(body: { error?: { code?: string; message?: string } }) {
  return body.error ?? { code: '', message: '' };
}

type GNode = {
  id: string;
  name: string;
  parentId: string | null;
  outlineOrder: number;
  x: number | null;
  y: number | null;
  z: number | null;
};

type Graph = {
  outlineVersion: number;
  nodes: GNode[];
  edges: { id: string }[];
  inclusions: { childId: string; nodes: { id: string }[]; labels: string[] }[];
};

type CreatedNode = {
  id: string;
  name: string;
  parentId: string | null;
  outlineOrder: number;
  outlineVersion: number;
  duplicates: { id: string; collections: { id: string }[] }[];
};

type MemberBody = {
  status: 'joined' | 'exists';
  parentId: string | null;
  outlineOrder: number;
  outlineVersion: number;
};

function itemsOf(nodes: readonly GNode[]): OutlineItem[] {
  return nodes.map((node) => ({ nodeId: node.id, parentId: node.parentId, order: node.outlineOrder }));
}

function parentOrder(nodes: readonly GNode[]) {
  return [...nodes]
    .map((node) => ({ id: node.id, parentId: node.parentId, order: node.outlineOrder, x: node.x, y: node.y, z: node.z }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

describe('outline', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let db: ReturnType<typeof createDb>;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    pool = createPool();
    db = createDb(pool);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
    expect(login.statusCode).toBe(200);
    cookie = cookiePair(login.headers['set-cookie']);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
    withCookie: string | false = cookie,
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method,
      url,
      payload,
      headers: withCookie ? { cookie: withCookie } : undefined,
    });
  }

  async function makeCollection(title: string): Promise<string> {
    const res = await call('POST', '/api/collections', { title });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  async function makeNode(collectionId: string, name: string, extra?: { parentId?: string | null; afterNodeId?: string }) {
    const res = await call('POST', `/api/collections/${collectionId}/nodes`, { name, ...extra });
    return res;
  }

  async function graphOf(collectionId: string): Promise<Graph> {
    const res = await call('GET', `/api/collections/${collectionId}/graph`);
    expect(res.statusCode).toBe(200);
    return res.json() as Graph;
  }

  async function cleanup(created: { nodes: string[]; collections: string[] }) {
    for (const id of created.nodes) await call('DELETE', `/api/nodes/${id}`);
    for (const id of created.collections) await call('DELETE', `/api/collections/${id}`);
  }

  it('keeps a three-level outline and places a node after its sibling', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const collectionId = await makeCollection(`三级${token}`);
      created.collections.push(collectionId);
      const rootRes = await makeNode(collectionId, `根${token}`);
      const midRes = await makeNode(collectionId, `中${token}`, { parentId: (rootRes.json() as CreatedNode).id });
      expect(rootRes.statusCode).toBe(201);
      expect(midRes.statusCode).toBe(201);
      const root = rootRes.json() as CreatedNode;
      const mid = midRes.json() as CreatedNode;
      created.nodes.push(root.id, mid.id);
      const leafRes = await makeNode(collectionId, `叶${token}`, { parentId: mid.id });
      expect(leafRes.statusCode).toBe(201);
      const leaf = leafRes.json() as CreatedNode;
      created.nodes.push(leaf.id);
      expect(leaf.parentId).toBe(mid.id);

      const first = await graphOf(collectionId);
      const again = await graphOf(collectionId);
      expect(again.outlineVersion).toBe(first.outlineVersion);
      expect(parentOrder(again.nodes)).toEqual(parentOrder(first.nodes));
      expect(again.nodes.find((node) => node.id === mid.id)?.parentId).toBe(root.id);
      expect(again.nodes.find((node) => node.id === leaf.id)?.parentId).toBe(mid.id);

      const before = again.outlineVersion;
      const beside = await makeNode(collectionId, `旁${token}`, { parentId: null, afterNodeId: root.id });
      expect(beside.statusCode).toBe(201);
      const besideNode = beside.json() as CreatedNode;
      created.nodes.push(besideNode.id);
      expect(besideNode.parentId).toBeNull();
      expect(besideNode.outlineOrder).toBe(root.outlineOrder + 1);
      expect(besideNode.outlineVersion).toBe(before + 1);
      const edgesAfter = await graphOf(collectionId);
      expect(edgesAfter.edges).toEqual([]);

      const count = edgesAfter.nodes.length;
      const version = edgesAfter.outlineVersion;
      const badAfter = await makeNode(collectionId, `坏${token}`, { afterNodeId: randomUUID() });
      expect(badAfter.statusCode).toBe(400);
      expect(errorOf(badAfter.json()).code).toBe('invalid_body');
      const badParent = await makeNode(collectionId, `坏父${token}`, { parentId: randomUUID() });
      expect(badParent.statusCode).toBe(400);
      const afterBad = await graphOf(collectionId);
      expect(afterBad.nodes).toHaveLength(count);
      expect(afterBad.outlineVersion).toBe(version);
    } finally {
      await cleanup(created);
    }
  });

  it('indents, outdents, and reorders without touching edges, coordinates, or another outline', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const left = await makeCollection(`左${token}`);
      const right = await makeCollection(`右${token}`);
      created.collections.push(left, right);
      const names = [`甲${token}`, `乙${token}`, `丙${token}`];
      const ids: string[] = [];
      for (const name of names) {
        const res = await makeNode(left, name);
        expect(res.statusCode).toBe(201);
        ids.push((res.json() as CreatedNode).id);
      }
      created.nodes.push(...ids);
      const [first, second, third] = ids as [string, string, string];
      const placed = await call('PATCH', `/api/collections/${left}/placements`, {
        placements: [{ nodeId: first, x: 3, y: 4, z: 1 }],
      });
      expect(placed.statusCode).toBe(204);
      const edge = await call('POST', '/api/edges', { fromId: first, toId: second, label: `边${token}` });
      expect(edge.statusCode).toBe(201);
      const edgeId = (edge.json() as { id: string }).id;
      const otherRes = await makeNode(right, `另${token}`);
      const otherChild = await makeNode(right, `另子${token}`, { parentId: (otherRes.json() as CreatedNode).id });
      expect(otherChild.statusCode).toBe(201);
      const otherId = (otherRes.json() as CreatedNode).id;
      const otherChildId = (otherChild.json() as CreatedNode).id;
      created.nodes.push(otherId, otherChildId);

      const origin = await graphOf(left);
      const otherOrigin = parentOrder((await graphOf(right)).nodes);
      const original = itemsOf(origin.nodes);

      async function put(version: number, items: OutlineItem[]) {
        const res = await call('PUT', `/api/collections/${left}/outline`, { expectedVersion: version, items });
        expect(res.statusCode).toBe(200);
        return (res.json() as { outlineVersion: number }).outlineVersion;
      }

      async function expectStable(graph: Graph) {
        expect(graph.edges.map((item) => item.id)).toContain(edgeId);
        expect(graph.nodes.find((node) => node.id === first)).toMatchObject({ x: 3, y: 4, z: 1 });
        expect(parentOrder((await graphOf(right)).nodes)).toEqual(otherOrigin);
      }

      const indented = indent(original, second);
      let version = await put(origin.outlineVersion, indented);
      let graph = await graphOf(left);
      expect(graph.nodes.find((node) => node.id === second)?.parentId).toBe(first);
      expect(graph.nodes.find((node) => node.id === third)?.parentId).toBeNull();
      await expectStable(graph);

      version = await put(version, outdent(itemsOf(graph.nodes), second));
      graph = await graphOf(left);
      expect(graph.nodes.find((node) => node.id === second)?.parentId).toBeNull();
      await expectStable(graph);

      version = await put(version, original);
      graph = await graphOf(left);
      expect(parentOrder(graph.nodes)).toEqual(parentOrder(origin.nodes));

      const moved = moveSibling(itemsOf(graph.nodes), first, 'down');
      version = await put(graph.outlineVersion, moved);
      graph = await graphOf(left);
      expect(graph.nodes.find((node) => node.id === first)?.outlineOrder).toBe(1);
      expect(graph.nodes.find((node) => node.id === second)?.outlineOrder).toBe(0);
      await expectStable(graph);

      version = await put(graph.outlineVersion, original);
      graph = await graphOf(left);
      expect(parentOrder(graph.nodes)).toEqual(parentOrder(origin.nodes));
      expect(graph.outlineVersion).toBe(version);
    } finally {
      await cleanup(created);
    }
  });

  it('rejects a self parent, a cycle, and a parent from another collection without writing', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const left = await makeCollection(`拒${token}`);
      const right = await makeCollection(`外${token}`);
      created.collections.push(left, right);
      const aRes = await makeNode(left, `A${token}`);
      const bRes = await makeNode(left, `B${token}`);
      const cRes = await makeNode(right, `C${token}`);
      expect(aRes.statusCode).toBe(201);
      const a = (aRes.json() as CreatedNode).id;
      const b = (bRes.json() as CreatedNode).id;
      const c = (cRes.json() as CreatedNode).id;
      created.nodes.push(a, b, c);
      const before = await graphOf(left);
      const version = before.outlineVersion;
      const shape = parentOrder(before.nodes);
      const cases = [
        [
          { nodeId: a, parentId: a, order: 0 },
          { nodeId: b, parentId: null, order: 1 },
        ],
        [
          { nodeId: a, parentId: b, order: 0 },
          { nodeId: b, parentId: a, order: 0 },
        ],
        [
          { nodeId: a, parentId: c, order: 0 },
          { nodeId: b, parentId: null, order: 1 },
        ],
      ];
      for (const items of cases) {
        const res = await call('PUT', `/api/collections/${left}/outline`, { expectedVersion: version, items });
        expect(res.statusCode).toBe(400);
        expect(errorOf(res.json()).code).toBe('invalid_body');
      }
      const after = await graphOf(left);
      expect(after.outlineVersion).toBe(version);
      expect(parentOrder(after.nodes)).toEqual(shape);
    } finally {
      await cleanup(created);
    }
  });

  it('turns old members into roots once, then keeps a later hierarchy', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const collectionId = await makeCollection(`旧${token}`);
      created.collections.push(collectionId);
      const aRes = await makeNode(collectionId, `旧甲${token}`);
      const bRes = await makeNode(collectionId, `旧乙${token}`);
      expect(bRes.statusCode).toBe(201);
      const a = (aRes.json() as CreatedNode).id;
      const b = (bRes.json() as CreatedNode).id;
      created.nodes.push(a, b);
      const placed = await call('PATCH', `/api/collections/${collectionId}/placements`, {
        placements: [{ nodeId: a, x: 8, y: 9, z: 2 }],
      });
      expect(placed.statusCode).toBe(204);
      const edge = await call('POST', '/api/edges', { fromId: a, toId: b, label: `旧边${token}` });
      expect(edge.statusCode).toBe(201);
      const edgeId = (edge.json() as { id: string }).id;
      await db
        .update(memberships)
        .set({ createdAt: new Date('2020-01-01T00:00:00.000Z') })
        .where(eq(memberships.collectionId, collectionId));
      await db
        .update(collections)
        .set({ outlineInitialized: false, outlineVersion: 0 })
        .where(eq(collections.id, collectionId));

      const first = await graphOf(collectionId);
      expect(first.outlineVersion).toBe(1);
      const [low, high] = [a, b].sort((left, right) => (left < right ? -1 : 1));
      expect(first.nodes.find((node) => node.id === low)).toMatchObject({ parentId: null, outlineOrder: 0, x: a === low ? 8 : null });
      expect(first.nodes.find((node) => node.id === high)).toMatchObject({ parentId: null, outlineOrder: 1 });
      expect(first.edges.map((item) => item.id)).toContain(edgeId);
      expect(first.nodes.find((node) => node.id === a)).toMatchObject({ x: 8, y: 9, z: 2 });

      const nested = await call('PUT', `/api/collections/${collectionId}/outline`, {
        expectedVersion: first.outlineVersion,
        items: [
          { nodeId: a, parentId: null, order: 0 },
          { nodeId: b, parentId: a, order: 0 },
        ],
      });
      expect(nested.statusCode).toBe(200);
      const second = await graphOf(collectionId);
      expect(second.outlineVersion).toBe(first.outlineVersion + 1);
      expect(second.nodes.find((node) => node.id === b)?.parentId).toBe(a);
      const third = await graphOf(collectionId);
      expect(third.outlineVersion).toBe(second.outlineVersion);
      expect(third.nodes.find((node) => node.id === b)?.parentId).toBe(a);
    } finally {
      await cleanup(created);
    }
  });

  it('projects child-collection nodes only inside inclusions and does not add a collection edge', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const parent = await makeCollection(`父投${token}`);
      const child = await makeCollection(`子投${token}`);
      created.collections.push(parent, child);
      const parentNode = (await makeNode(parent, `父点${token}`)).json() as CreatedNode;
      const childNode = (await makeNode(child, `子点${token}`)).json() as CreatedNode;
      created.nodes.push(parentNode.id, childNode.id);
      const included = await call('POST', `/api/collections/${parent}/inclusions`, {
        childId: child,
        originX: 0,
        originY: 0,
      });
      expect(included.statusCode).toBe(201);
      const graph = await graphOf(parent);
      expect(graph.nodes.map((node) => node.id)).toEqual([parentNode.id]);
      expect(graph.inclusions.find((item) => item.childId === child)?.nodes.map((node) => node.id)).toEqual([childNode.id]);
      const library = await call('GET', '/api/library');
      const edges = (library.json() as { edges: { fromId: string; toId: string }[] }).edges.filter(
        (edge) =>
          (edge.fromId === parent && edge.toId === child) || (edge.fromId === child && edge.toId === parent),
      );
      expect(edges).toEqual([]);
    } finally {
      await cleanup(created);
    }
  });

  it('creates nodes beside an existing one without adding edges', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const collectionId = await makeCollection(`入边${token}`);
      created.collections.push(collectionId);
      const anchor = (await makeNode(collectionId, `锚${token}`)).json() as CreatedNode;
      const left = (await makeNode(collectionId, `左源${token}`)).json() as CreatedNode;
      const right = (await makeNode(collectionId, `右源${token}`)).json() as CreatedNode;
      created.nodes.push(anchor.id, left.id, right.id);
      expect((await call('POST', '/api/edges', { fromId: left.id, toId: anchor.id, label: `左${token}` })).statusCode).toBe(201);
      expect((await call('POST', '/api/edges', { fromId: right.id, toId: anchor.id, label: `右${token}` })).statusCode).toBe(201);
      const before = (await graphOf(collectionId)).edges.map((edge) => edge.id).sort();
      const beside = await makeNode(collectionId, `旁边${token}`);
      const below = await makeNode(collectionId, `下方${token}`);
      expect(beside.statusCode).toBe(201);
      expect(below.statusCode).toBe(201);
      created.nodes.push((beside.json() as CreatedNode).id, (below.json() as CreatedNode).id);
      expect((await graphOf(collectionId)).edges.map((edge) => edge.id).sort()).toEqual(before);
    } finally {
      await cleanup(created);
    }
  });

  it('searches readable card text, scopes one inclusion level, and pages', async () => {
    const token = randomUUID().replaceAll('-', '');
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const parent = await makeCollection(`父范围${token}`);
      const child = await makeCollection(`子范围${token}`);
      const grand = await makeCollection(`孙范围${token}`);
      const outside = await makeCollection(`外范围${token}`);
      const page = await makeCollection(`页${token}`);
      created.collections.push(parent, child, grand, outside, page);
      const parentNode = (await makeNode(parent, `父点${token}`)).json() as CreatedNode;
      const childNode = (await makeNode(child, `子点${token}`)).json() as CreatedNode;
      const grandNode = (await makeNode(grand, `孙点${token}`)).json() as CreatedNode;
      const outsideNode = (await makeNode(outside, `外点${token}`)).json() as CreatedNode;
      created.nodes.push(parentNode.id, childNode.id, grandNode.id, outsideNode.id);
      expect((await call('POST', `/api/collections/${parent}/inclusions`, { childId: child, originX: 0, originY: 0 })).statusCode).toBe(201);
      expect((await call('POST', `/api/collections/${child}/inclusions`, { childId: grand, originX: 0, originY: 0 })).statusCode).toBe(201);

      const note = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: parentNode.id,
        type: 'note',
        content: { body: `<p>句子${token}</p>` },
      });
      const rich = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: parentNode.id,
        type: 'rich',
        content: {
          doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `富${token}` }] }] },
        },
      });
      const formula = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: parentNode.id,
        type: 'formula',
        content: { latex: `公式${token}` },
      });
      expect(note.statusCode).toBe(201);
      expect(rich.statusCode).toBe(201);
      expect(formula.statusCode).toBe(201);
      const noteId = (note.json() as { id: string }).id;
      const richId = (rich.json() as { id: string }).id;
      const formulaId = (formula.json() as { id: string }).id;
      const ownIds = new Set([parentNode.id, noteId, richId, formulaId]);

      async function hitsOf(url: string) {
        const res = await call('GET', url);
        expect(res.statusCode).toBe(200);
        return res.json() as {
          hits: { id: string; kind: string; nodeId: string | null; cardId: string | null; collectionId: string | null; field: string }[];
          nextCursor: string | null;
        };
      }

      const sentence = await hitsOf(`/api/search?q=${encodeURIComponent(`句子${token}`)}`);
      expect(sentence.hits.map((hit) => hit.id)).toContain(noteId);
      expect(sentence.hits.find((hit) => hit.id === noteId)).toMatchObject({
        kind: 'card',
        nodeId: parentNode.id,
        cardId: noteId,
      });
      const richHits = await hitsOf(`/api/search?q=${encodeURIComponent(`富${token}`)}`);
      expect(richHits.hits.map((hit) => hit.id)).toContain(richId);
      const formulaHits = await hitsOf(`/api/search?q=${encodeURIComponent(`公式${token}`)}`);
      expect(formulaHits.hits.map((hit) => hit.id)).toContain(formulaId);

      for (const word of ['type', 'doc', 'body', 'latex']) {
        const found = await hitsOf(`/api/search?q=${encodeURIComponent(word)}`);
        expect(found.hits.some((hit) => ownIds.has(hit.id) || hit.nodeId === parentNode.id)).toBe(false);
      }

      const exactName = `整词${token}`;
      const exact = (await makeNode(parent, exactName)).json() as CreatedNode;
      const described = (await makeNode(parent, `别的${token}`)).json() as CreatedNode;
      created.nodes.push(exact.id, described.id);
      expect((await call('PATCH', `/api/nodes/${described.id}`, { description: exactName })).statusCode).toBe(200);
      expect((await call('PATCH', `/api/nodes/${exact.id}`, { description: exactName })).statusCode).toBe(200);
      const tierCard = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: described.id,
        type: 'note',
        content: { body: `${exactName}卡` },
      });
      expect(tierCard.statusCode).toBe(201);
      const tierCardId = (tierCard.json() as { id: string }).id;
      const tiered = await hitsOf(`/api/search?q=${encodeURIComponent(exactName)}`);
      const tierIds = tiered.hits.filter((hit) => [exact.id, described.id, tierCardId].includes(hit.id)).map((hit) => hit.id);
      expect(tierIds).toEqual([exact.id, described.id, tierCardId]);
      expect(tiered.hits.filter((hit) => hit.nodeId === exact.id)).toEqual([
        expect.objectContaining({ field: 'name', id: exact.id }),
      ]);

      const insideEdge = await call('POST', '/api/edges', { fromId: parentNode.id, toId: childNode.id, label: `边${token}` });
      const outsideEdge = await call('POST', '/api/edges', { fromId: parentNode.id, toId: outsideNode.id, label: `外缘${token}` });
      expect(insideEdge.statusCode).toBe(201);
      expect(outsideEdge.statusCode).toBe(201);
      const insideEdgeId = (insideEdge.json() as { id: string }).id;
      const outsideEdgeId = (outsideEdge.json() as { id: string }).id;
      const parentEdge = await call('POST', '/api/collection-edges', { fromId: parent, toId: outside, label: `合边${token}` });
      const nestedEdge = await call('POST', '/api/collection-edges', { fromId: child, toId: grand, label: `孙边${token}` });
      expect(parentEdge.statusCode).toBe(201);
      expect(nestedEdge.statusCode).toBe(201);
      const parentEdgeId = (parentEdge.json() as { id: string }).id;
      const nestedEdgeId = (nestedEdge.json() as { id: string }).id;

      const scopedNodes = await hitsOf(
        `/api/search?q=${encodeURIComponent(`点${token}`)}&scope=collection&collectionId=${parent}`,
      );
      const scopedNodeIds = scopedNodes.hits.map((hit) => hit.nodeId);
      expect(scopedNodeIds).toContain(parentNode.id);
      expect(scopedNodeIds).toContain(childNode.id);
      expect(scopedNodeIds).not.toContain(grandNode.id);
      expect(scopedNodeIds).not.toContain(outsideNode.id);
      const scopedTitles = await hitsOf(
        `/api/search?q=${encodeURIComponent(`范围${token}`)}&scope=collection&collectionId=${parent}`,
      );
      const titles = scopedTitles.hits.filter((hit) => hit.kind === 'collection').map((hit) => hit.id);
      expect(titles).toEqual(expect.arrayContaining([parent, child]));
      expect(titles).not.toContain(grand);
      expect(titles).not.toContain(outside);
      const scopedEdges = await hitsOf(
        `/api/search?q=${encodeURIComponent(`边${token}`)}&scope=collection&collectionId=${parent}`,
      );
      expect(scopedEdges.hits.map((hit) => hit.id)).toContain(insideEdgeId);
      expect(scopedEdges.hits.map((hit) => hit.id)).not.toContain(outsideEdgeId);
      expect(scopedEdges.hits.map((hit) => hit.id)).toContain(parentEdgeId);
      expect(scopedEdges.hits.map((hit) => hit.id)).not.toContain(nestedEdgeId);
      const accountEdge = await hitsOf(`/api/search?q=${encodeURIComponent(`外缘${token}`)}`);
      expect(accountEdge.hits.map((hit) => hit.id)).toContain(outsideEdgeId);

      const joined = await call('POST', `/api/collections/${outside}/members`, { nodeId: parentNode.id });
      expect(joined.statusCode).toBe(200);
      const preferred = await hitsOf(
        `/api/search?q=${encodeURIComponent(`父点${token}`)}&preferCollectionId=${outside}`,
      );
      expect(preferred.hits.find((hit) => hit.id === parentNode.id)?.collectionId).toBe(outside);
      const earliest = await hitsOf(`/api/search?q=${encodeURIComponent(`父点${token}`)}`);
      expect(earliest.hits.find((hit) => hit.id === parentNode.id)?.collectionId).toBe(parent);

      const pageIds: string[] = [];
      for (let index = 0; index < 31; index += 1) {
        const res = await makeNode(page, `条${token}-${String(index).padStart(2, '0')}`);
        expect(res.statusCode).toBe(201);
        pageIds.push((res.json() as CreatedNode).id);
      }
      created.nodes.push(...pageIds);
      const firstPage = await hitsOf(`/api/search?q=${encodeURIComponent(`条${token}`)}`);
      expect(firstPage.hits).toHaveLength(30);
      expect(firstPage.nextCursor).toBeTruthy();
      const secondPage = await hitsOf(
        `/api/search?q=${encodeURIComponent(`条${token}`)}&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
      );
      const seen = [...firstPage.hits, ...secondPage.hits].map((hit) => hit.id);
      expect(new Set(seen)).toEqual(new Set(pageIds));
      expect(secondPage.nextCursor).toBeNull();

      const detachedCard = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: outsideNode.id,
        type: 'note',
        content: { body: `未归卡${token}` },
      });
      expect(detachedCard.statusCode).toBe(201);
      const detached = await call('DELETE', `/api/collections/${outside}/members/${outsideNode.id}`);
      expect(detached.statusCode).toBe(200);
      const renamed = `改名${token}`;
      expect((await call('PATCH', `/api/nodes/${outsideNode.id}`, { name: renamed })).statusCode).toBe(200);
      const unassigned = await call('GET', '/api/unassigned-nodes');
      expect(unassigned.statusCode).toBe(200);
      const unassignedNodes = (unassigned.json() as { nodes: { id: string; kind: string; cardCount: number }[] }).nodes;
      expect(unassignedNodes.map((node) => node.id)).toContain(outsideNode.id);
      expect(unassignedNodes.find((node) => node.id === outsideNode.id)).toMatchObject({ kind: 'text', cardCount: 1 });
      const back = await call('POST', `/api/collections/${outside}/members`, { nodeId: outsideNode.id });
      expect(back.statusCode).toBe(200);
      expect((back.json() as MemberBody).status).toBe('joined');
      const assigned = await call('GET', '/api/unassigned-nodes');
      expect((assigned.json() as { nodes: { id: string }[] }).nodes.map((node) => node.id)).not.toContain(outsideNode.id);

      const older = await call('POST', '/api/edges', { fromId: childNode.id, toId: grandNode.id, label: `甲标${token}` });
      const newer = await call('POST', '/api/edges', { fromId: grandNode.id, toId: outsideNode.id, label: `乙标${token}` });
      expect(older.statusCode).toBe(201);
      expect(newer.statusCode).toBe(201);
      const labels = await call('GET', '/api/edge-labels?limit=20');
      expect(labels.statusCode).toBe(200);
      const labelList = (labels.json() as { labels: string[] }).labels;
      expect(labelList[0]).toBe(`乙标${token}`);
      expect(labelList.indexOf(`乙标${token}`)).toBeLessThan(labelList.indexOf(`甲标${token}`));
      expect(((await call('GET', '/api/edge-labels')).json() as { labels: string[] }).labels.length).toBeLessThanOrEqual(8);
      expect((await call('GET', '/api/edge-labels?limit=0')).statusCode).toBe(400);
      expect((await call('GET', '/api/edge-labels?limit=21')).statusCode).toBe(400);

      expect((await call('GET', '/api/search?q=%20&scope=collection')).json()).toEqual({ hits: [], nextCursor: null });
      expect((await call('GET', `/api/search?q=${token}&scope=collection`)).statusCode).toBe(400);
      expect((await call('GET', `/api/search?q=${token}&cursor=@@@`)).statusCode).toBe(400);
      expect((await call('GET', '/api/unassigned-nodes?cursor=@@@')).statusCode).toBe(400);
      const missingScope = await call('GET', `/api/search?q=${token}&scope=collection&collectionId=${randomUUID()}`);
      expect(missingScope.statusCode).toBe(404);
      expect(errorOf(missingScope.json()).code).toBe('not_found');
    } finally {
      await cleanup(created);
    }
  });

  it('promotes children, restores placement, and lets a detached node be renamed and joined again', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const collectionId = await makeCollection(`升${token}`);
      created.collections.push(collectionId);
      const ids: Record<string, string> = {};
      for (const name of ['A', 'B', 'C', 'B1', 'B2', 'S']) {
        const res = await makeNode(collectionId, `${name}${token}`);
        expect(res.statusCode).toBe(201);
        ids[name] = (res.json() as CreatedNode).id;
        created.nodes.push(ids[name]);
      }
      const graph = await graphOf(collectionId);
      const arranged = await call('PUT', `/api/collections/${collectionId}/outline`, {
        expectedVersion: graph.outlineVersion,
        items: [
          { nodeId: ids.A, parentId: null, order: 0 },
          { nodeId: ids.B, parentId: null, order: 1 },
          { nodeId: ids.C, parentId: null, order: 2 },
          { nodeId: ids.B1, parentId: ids.B, order: 0 },
          { nodeId: ids.B2, parentId: ids.B, order: 1 },
          { nodeId: ids.S, parentId: null, order: 3 },
        ],
      });
      expect(arranged.statusCode).toBe(200);
      const version = (arranged.json() as { outlineVersion: number }).outlineVersion;
      expect((await call('PATCH', `/api/collections/${collectionId}/placements`, {
        placements: [{ nodeId: ids.B, x: 5, y: 6, z: 7 }],
      })).statusCode).toBe(204);

      const stale = await call('DELETE', `/api/collections/${collectionId}/members/${ids.B}?expectedVersion=0`);
      if (version !== 0) {
        expect(stale.statusCode).toBe(409);
        expect(errorOf(stale.json())).toEqual({ code: 'conflict', message: '大纲已经在别处改过，请刷新' });
      }
      const removed = await call('DELETE', `/api/collections/${collectionId}/members/${ids.B}?expectedVersion=${version}`);
      expect(removed.statusCode).toBe(200);
      const promoted = await graphOf(collectionId);
      expect(promoted.nodes.find((node) => node.id === ids.B)).toBeUndefined();
      expect(promoted.nodes.find((node) => node.id === ids.A)).toMatchObject({ parentId: null, outlineOrder: 0 });
      expect(promoted.nodes.find((node) => node.id === ids.B1)).toMatchObject({ parentId: null, outlineOrder: 1 });
      expect(promoted.nodes.find((node) => node.id === ids.B2)).toMatchObject({ parentId: null, outlineOrder: 2 });
      expect(promoted.nodes.find((node) => node.id === ids.C)).toMatchObject({ parentId: null, outlineOrder: 3 });

      const wrongRestore = await call('POST', `/api/collections/${collectionId}/outline/restore`, {
        expectedVersion: 0,
        nodeId: ids.B,
        parentId: null,
        order: 1,
        placement: { x: 5, y: 6, z: 7, imageWidth: null },
        children: [
          { nodeId: ids.B1, parentId: ids.B, order: 0 },
          { nodeId: ids.B2, parentId: ids.B, order: 1 },
        ],
      });
      expect(wrongRestore.statusCode).toBe(409);
      expect((await graphOf(collectionId)).nodes.find((node) => node.id === ids.B)).toBeUndefined();

      const restored = await call('POST', `/api/collections/${collectionId}/outline/restore`, {
        expectedVersion: promoted.outlineVersion,
        nodeId: ids.B,
        parentId: null,
        order: 1,
        placement: { x: 5, y: 6, z: 7, imageWidth: null },
        children: [
          { nodeId: ids.B1, parentId: ids.B, order: 0 },
          { nodeId: ids.B2, parentId: ids.B, order: 1 },
        ],
      });
      expect(restored.statusCode).toBe(200);
      const back = await graphOf(collectionId);
      expect(back.nodes.find((node) => node.id === ids.B)).toMatchObject({ parentId: null, outlineOrder: 1, x: 5, y: 6, z: 7 });
      expect(back.nodes.find((node) => node.id === ids.B1)).toMatchObject({ parentId: ids.B, outlineOrder: 0 });
      expect(back.nodes.find((node) => node.id === ids.B2)).toMatchObject({ parentId: ids.B, outlineOrder: 1 });
      expect(back.nodes.find((node) => node.id === ids.C)?.outlineOrder).toBe(3);
      const again = await call('POST', `/api/collections/${collectionId}/outline/restore`, {
        expectedVersion: back.outlineVersion,
        nodeId: ids.B,
        parentId: null,
        order: 1,
        placement: { x: 1, y: 1, z: 1, imageWidth: null },
        children: [],
      });
      expect(again.statusCode).toBe(409);
      expect(errorOf(again.json()).message).toBe('大纲已经在别处改过，请刷新');
      expect((await graphOf(collectionId)).outlineVersion).toBe(back.outlineVersion);

      const soloGone = await call('DELETE', `/api/collections/${collectionId}/members/${ids.S}`);
      expect(soloGone.statusCode).toBe(200);
      const still = await call('GET', `/api/nodes/${ids.S}`);
      expect(still.statusCode).toBe(200);
      expect((await call('PATCH', `/api/nodes/${ids.S}`, { name: `再${token}` })).statusCode).toBe(200);
      const rejoined = await call('POST', `/api/collections/${collectionId}/members`, { nodeId: ids.S });
      expect(rejoined.statusCode).toBe(200);
      expect((rejoined.json() as MemberBody).status).toBe('joined');
      expect((await call('GET', `/api/nodes/${ids.S}`)).json()).toMatchObject({ name: `再${token}` });
    } finally {
      await cleanup(created);
    }
  });

  it('promotes the removed node in every collection that still contains it', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const left = await makeCollection(`删左${token}`);
      const right = await makeCollection(`删右${token}`);
      created.collections.push(left, right);
      const anchor = (await makeNode(left, `留${token}`)).json() as CreatedNode;
      const shared = (await makeNode(left, `共${token}`, { parentId: anchor.id })).json() as CreatedNode;
      const child = (await makeNode(left, `子${token}`, { parentId: shared.id })).json() as CreatedNode;
      const sibling = (await makeNode(right, `右${token}`)).json() as CreatedNode;
      created.nodes.push(anchor.id, shared.id, child.id, sibling.id);
      const joined = await call('POST', `/api/collections/${right}/members`, { nodeId: shared.id });
      expect(joined.statusCode).toBe(200);
      const rightGraph = await graphOf(right);
      const nested = await call('PUT', `/api/collections/${right}/outline`, {
        expectedVersion: rightGraph.outlineVersion,
        items: [
          { nodeId: sibling.id, parentId: null, order: 0 },
          { nodeId: shared.id, parentId: null, order: 1 },
        ],
      });
      expect(nested.statusCode).toBe(200);
      const childOnRight = await makeNode(right, `右子${token}`, { parentId: shared.id });
      expect(childOnRight.statusCode).toBe(201);
      const rightChild = (childOnRight.json() as CreatedNode).id;
      created.nodes.push(rightChild);
      const edge = await call('POST', '/api/edges', { fromId: anchor.id, toId: shared.id, label: `删边${token}` });
      expect(edge.statusCode).toBe(201);
      const edgeId = (edge.json() as { id: string }).id;

      expect((await call('DELETE', `/api/nodes/${shared.id}`)).statusCode).toBe(204);
      created.nodes = created.nodes.filter((id) => id !== shared.id);
      expect((await call('GET', `/api/nodes/${shared.id}`)).statusCode).toBe(404);
      const leftGraph = await graphOf(left);
      expect(leftGraph.nodes.map((node) => node.id)).not.toContain(shared.id);
      expect(leftGraph.nodes.find((node) => node.id === child.id)?.parentId).toBe(anchor.id);
      expect(leftGraph.edges.map((item) => item.id)).not.toContain(edgeId);
      const afterRight = await graphOf(right);
      expect(afterRight.nodes.find((node) => node.id === rightChild)).toMatchObject({ parentId: null });
      expect(afterRight.nodes.find((node) => node.id === sibling.id)?.parentId).toBeNull();
    } finally {
      await cleanup(created);
    }
  });

  it('reuses a node without copying cards and reports an existing membership', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const left = await makeCollection(`复用甲${token}`);
      const right = await makeCollection(`复用乙${token}`);
      created.collections.push(left, right);
      const shared = (await makeNode(left, `同名${token}`)).json() as CreatedNode;
      const extra = (await makeNode(left, `垫${token}`)).json() as CreatedNode;
      created.nodes.push(shared.id, extra.id);
      const card = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: shared.id,
        type: 'note',
        content: { body: `原文${token}` },
      });
      expect(card.statusCode).toBe(201);
      const cardId = (card.json() as { id: string }).id;
      const joined = await call('POST', `/api/collections/${right}/members`, { nodeId: shared.id });
      expect(joined.statusCode).toBe(200);
      expect(joined.json()).toMatchObject({ status: 'joined', parentId: null });
      const detail = await call('GET', `/api/nodes/${shared.id}`);
      expect((detail.json() as { cards: { id: string }[] }).cards.map((item) => item.id)).toEqual([cardId]);
      expect((await graphOf(left)).nodes.find((node) => node.id === shared.id)?.id).toBe(shared.id);
      expect((await graphOf(right)).nodes.find((node) => node.id === shared.id)).toMatchObject({ parentId: null });

      const edited = await call('PATCH', `/api/cards/${cardId}`, { content: { body: `改${token}` } });
      expect(edited.statusCode).toBe(200);
      const reread = await call('GET', `/api/nodes/${shared.id}`);
      expect((reread.json() as { cards: { id: string; content: { body: string } }[] }).cards[0]?.content.body).toBe(`改${token}`);

      const leftGraph = await graphOf(left);
      const rightBefore = await graphOf(right);
      const moved = await call('PUT', `/api/collections/${left}/outline`, {
        expectedVersion: leftGraph.outlineVersion,
        items: [
          { nodeId: extra.id, parentId: null, order: 0 },
          { nodeId: shared.id, parentId: extra.id, order: 0 },
        ],
      });
      expect(moved.statusCode).toBe(200);
      expect((await graphOf(right)).nodes.find((node) => node.id === shared.id)?.parentId).toBe(
        rightBefore.nodes.find((node) => node.id === shared.id)?.parentId,
      );
      expect((await graphOf(right)).nodes.find((node) => node.id === shared.id)?.outlineOrder).toBe(
        rightBefore.nodes.find((node) => node.id === shared.id)?.outlineOrder,
      );

      const rightVersion = (await graphOf(right)).outlineVersion;
      const exists = await call('POST', `/api/collections/${right}/members`, { nodeId: shared.id, parentId: extra.id });
      expect(exists.statusCode).toBe(200);
      expect(exists.json()).toMatchObject({
        status: 'exists',
        parentId: null,
        outlineVersion: rightVersion,
      });
      expect((await graphOf(right)).outlineVersion).toBe(rightVersion);

      const duplicate = await makeNode(right, `同名${token}`);
      expect(duplicate.statusCode).toBe(201);
      const duplicateBody = duplicate.json() as CreatedNode;
      created.nodes.push(duplicateBody.id);
      expect(duplicateBody.duplicates.map((item) => item.id)).toContain(shared.id);
      expect(duplicateBody.duplicates.find((item) => item.id === shared.id)?.collections.map((item) => item.id)).toEqual(
        expect.arrayContaining([left, right]),
      );
    } finally {
      await cleanup(created);
    }
  });

  it('keeps the parent when expectedVersion is stale', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    try {
      const collectionId = await makeCollection(`冲突${token}`);
      created.collections.push(collectionId);
      const parent = (await makeNode(collectionId, `父${token}`)).json() as CreatedNode;
      const child = (await makeNode(collectionId, `子${token}`, { parentId: parent.id })).json() as CreatedNode;
      created.nodes.push(parent.id, child.id);
      const graph = await graphOf(collectionId);
      const stale = await call('PUT', `/api/collections/${collectionId}/outline`, {
        expectedVersion: graph.outlineVersion + 5,
        items: [
          { nodeId: parent.id, parentId: null, order: 0 },
          { nodeId: child.id, parentId: null, order: 1 },
        ],
      });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale.json())).toEqual({ code: 'conflict', message: '大纲已经在别处改过，请刷新' });
      const after = await graphOf(collectionId);
      expect(after.outlineVersion).toBe(graph.outlineVersion);
      expect(after.nodes.find((node) => node.id === child.id)?.parentId).toBe(parent.id);
    } finally {
      await cleanup(created);
    }
  });

  it('hides the outline from another user', async () => {
    const token = randomUUID();
    const created = { nodes: [] as string[], collections: [] as string[] };
    const otherName = `u${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    try {
      const collectionId = await makeCollection(`私${token}`);
      created.collections.push(collectionId);
      const node = (await makeNode(collectionId, `私点${token}`)).json() as CreatedNode;
      created.nodes.push(node.id);
      const registered = await app.inject({
        method: 'POST',
        url: '/api/register',
        payload: { username: otherName, password: 'secret-88' },
      });
      expect(registered.statusCode).toBe(201);
      const otherCookie = cookiePair(registered.headers['set-cookie']);
      const graph = await call('GET', `/api/collections/${collectionId}/graph`, undefined, otherCookie);
      expect(graph.statusCode).toBe(404);
      expect(errorOf(graph.json()).code).toBe('not_found');
      const put = await call(
        'PUT',
        `/api/collections/${collectionId}/outline`,
        { expectedVersion: 0, items: [] },
        otherCookie,
      );
      expect(put.statusCode).toBe(404);
      const createdNode = await call('POST', `/api/collections/${collectionId}/nodes`, { name: '不该' }, otherCookie);
      expect(createdNode.statusCode).toBe(404);
      const removed = await call('DELETE', `/api/collections/${collectionId}/members/${node.id}`, undefined, otherCookie);
      expect(removed.statusCode).toBe(404);
      const searched = await call(
        'GET',
        `/api/search?q=${token}&scope=collection&collectionId=${collectionId}`,
        undefined,
        otherCookie,
      );
      expect(searched.statusCode).toBe(404);
    } finally {
      await cleanup(created);
      const other = await app.inject({
        method: 'POST',
        url: '/api/login',
        payload: { username: otherName, password: 'secret-88' },
      });
      if (other.statusCode === 200) {
        const otherCookie = cookiePair(other.headers['set-cookie']);
        const library = await call('GET', '/api/library', undefined, otherCookie);
        const ids = (library.json() as { collections: { id: string }[] }).collections.map((item) => item.id);
        for (const id of ids) await call('DELETE', `/api/collections/${id}`, undefined, otherCookie);
      }
    }
  });
});
