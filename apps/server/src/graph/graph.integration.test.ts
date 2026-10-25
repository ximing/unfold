import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';

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

describe('graph', () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookiePair(login.headers['set-cookie']);
  });

  afterAll(async () => {
    await app.close();
  });

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
    withCookie = true,
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method,
      url,
      payload,
      headers: withCookie ? { cookie } : undefined,
    });
  }

  it('rejects anonymous requests', async () => {
    const created = await call('POST', '/api/collections', { title: '未登录' }, false);
    expect(created.statusCode).toBe(401);
    expect(errorOf(created.json()).code).toBe('unauthenticated');

    const library = await call('GET', '/api/library', undefined, false);
    expect(library.statusCode).toBe(401);

    const search = await call('GET', '/api/search?q=点', undefined, false);
    expect(search.statusCode).toBe(401);
  });

  it('builds a collection graph, cards, and search hits', async () => {
    const token = randomUUID().replaceAll('-', '').slice(0, 12);
    const bodyToken = `正文${token}`;

    const blank = await call('POST', '/api/collections', { title: '   ' });
    expect(blank.statusCode).toBe(400);
    expect(errorOf(blank.json())).toEqual({ code: 'invalid_body', message: '标题不能是空的' });

    const first = await call('POST', '/api/collections', { title: `  合集甲${token}  ` });
    expect(first.statusCode).toBe(201);
    const collectionA = first.json() as { id: string; title: string };
    expect(collectionA.title).toBe(`合集甲${token}`);

    const emptyGraph = await call('GET', `/api/collections/${collectionA.id}/graph`);
    expect(emptyGraph.statusCode).toBe(200);
    expect(emptyGraph.json()).toEqual({ nodes: [], edges: [] });

    const missing = await call('GET', `/api/nodes/${randomUUID()}`);
    expect(missing.statusCode).toBe(404);
    expect(errorOf(missing.json())).toEqual({ code: 'not_found', message: '点没有找到' });

    const nodeARes = await call('POST', `/api/collections/${collectionA.id}/nodes`, {
      name: `  点甲${token}  `,
    });
    const nodeBRes = await call('POST', `/api/collections/${collectionA.id}/nodes`, { name: `点乙${token}` });
    const nodeCRes = await call('POST', `/api/collections/${collectionA.id}/nodes`, { name: `点丙${token}` });
    const duplicateRes = await call('POST', `/api/collections/${collectionA.id}/nodes`, {
      name: `点甲${token}`,
    });
    expect(nodeARes.statusCode).toBe(201);
    expect(nodeBRes.statusCode).toBe(201);
    expect(nodeCRes.statusCode).toBe(201);
    expect(duplicateRes.statusCode).toBe(201);
    const nodeA = nodeARes.json() as { id: string; name: string };
    const nodeB = nodeBRes.json() as { id: string; name: string };
    const nodeC = nodeCRes.json() as { id: string; name: string };
    const duplicate = duplicateRes.json() as { id: string; name: string };
    expect(nodeA.name).toBe(`点甲${token}`);
    expect(duplicate.name).toBe(nodeA.name);
    expect(duplicate.id).not.toBe(nodeA.id);

    const emptyName = await call('POST', `/api/collections/${collectionA.id}/nodes`, { name: '  ' });
    expect(emptyName.statusCode).toBe(400);
    expect(errorOf(emptyName.json())).toEqual({ code: 'invalid_body', message: '名字不能是空的' });

    const edgeABRes = await call('POST', '/api/edges', {
      fromId: nodeA.id,
      toId: nodeB.id,
      label: '  前提  ',
    });
    const edgeBCRes = await call('POST', '/api/edges', {
      fromId: nodeB.id,
      toId: nodeC.id,
      label: '发生于',
    });
    expect(edgeABRes.statusCode).toBe(201);
    expect(edgeBCRes.statusCode).toBe(201);
    const edgeAB = edgeABRes.json() as { id: string; fromId: string; toId: string; label: string };
    const edgeBC = edgeBCRes.json() as { id: string };
    expect(edgeAB).toMatchObject({ fromId: nodeA.id, toId: nodeB.id, label: '前提' });

    const selfLoop = await call('POST', '/api/edges', {
      fromId: nodeA.id,
      toId: nodeA.id,
      label: '前提',
    });
    expect(selfLoop.statusCode).toBe(400);
    expect(errorOf(selfLoop.json())).toEqual({ code: 'invalid_body', message: '不能连到自己' });

    const duplicateEdge = await call('POST', '/api/edges', {
      fromId: nodeA.id,
      toId: nodeB.id,
      label: '前提',
    });
    expect(duplicateEdge.statusCode).toBe(409);
    expect(errorOf(duplicateEdge.json())).toEqual({ code: 'conflict', message: '这条关系已经有了' });

    const blankLabel = await call('POST', '/api/edges', {
      fromId: nodeA.id,
      toId: nodeB.id,
      label: '   ',
    });
    expect(blankLabel.statusCode).toBe(400);
    expect(errorOf(blankLabel.json())).toEqual({ code: 'invalid_body', message: '关系说明不能是空的' });

    const cardSamples = [
      { type: 'note', content: { body: bodyToken } },
      { type: 'code', content: { language: 'ts', source: 'const a = 1' } },
      { type: 'formula', content: { latex: 'E=mc^2' } },
      { type: 'person', content: { identity: '某人', note: '' } },
      { type: 'event', content: { when: '', where: '', summary: '' } },
      { type: 'place', content: { note: '' } },
      { type: 'period', content: { start: '', end: '', note: '' } },
      { type: 'group', content: { note: '一组' } },
    ];

    const nodeCardIds: string[] = [];
    for (const sample of cardSamples) {
      const res = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: nodeA.id,
        ...sample,
      });
      expect(res.statusCode, JSON.stringify(sample)).toBe(201);
      const card = res.json() as { id: string; type: string; position: number; content: unknown };
      expect(card.type).toBe(sample.type);
      expect(card.content).toEqual(sample.content);
      nodeCardIds.push(card.id);
    }
    expect(nodeCardIds).toHaveLength(8);

    for (const sample of cardSamples) {
      const res = await call('POST', '/api/cards', {
        ownerKind: 'edge',
        ownerId: edgeAB.id,
        ...sample,
        content: sample.type === 'note' ? { body: '' } : sample.content,
      });
      expect(res.statusCode, `edge ${sample.type}`).toBe(201);
    }

    const badCard = await call('POST', '/api/cards', {
      ownerKind: 'node',
      ownerId: nodeA.id,
      type: 'note',
      content: { body: 'x', extra: 'nope' },
    });
    expect(badCard.statusCode).toBe(400);
    expect(errorOf(badCard.json()).code).toBe('invalid_body');

    const missingField = await call('POST', '/api/cards', {
      ownerKind: 'edge',
      ownerId: edgeAB.id,
      type: 'event',
      content: { when: '昨天' },
    });
    expect(missingField.statusCode).toBe(400);
    expect(errorOf(missingField.json()).code).toBe('invalid_body');

    const nodeDetail = await call('GET', `/api/nodes/${nodeA.id}`);
    expect(nodeDetail.statusCode).toBe(200);
    const detail = nodeDetail.json() as {
      name: string;
      collections: { id: string }[];
      cards: { id: string; position: number }[];
    };
    expect(detail.name).toBe(nodeA.name);
    expect(detail.collections.map((item) => item.id)).toContain(collectionA.id);
    expect(detail.cards.map((item) => item.id)).toEqual(nodeCardIds);
    expect(detail.cards.map((item) => item.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const edgeDetail = await call('GET', `/api/edges/${edgeAB.id}`);
    expect(edgeDetail.statusCode).toBe(200);
    const edgeBody = edgeDetail.json() as { fromName: string; toName: string; cards: unknown[] };
    expect(edgeBody.fromName).toBe(nodeA.name);
    expect(edgeBody.toName).toBe(nodeB.name);
    expect(edgeBody.cards).toHaveLength(8);

    const graph = await call('GET', `/api/collections/${collectionA.id}/graph`);
    expect(graph.statusCode).toBe(200);
    const graphBody = graph.json() as {
      nodes: { id: string }[];
      edges: { id: string; fromId: string; toId: string }[];
    };
    expect(graphBody.nodes.map((item) => item.id).sort()).toEqual(
      [nodeA.id, nodeB.id, nodeC.id, duplicate.id].sort(),
    );
    expect(graphBody.edges.map((item) => item.id).sort()).toEqual([edgeAB.id, edgeBC.id].sort());

    const second = await call('POST', '/api/collections', { title: `合集乙${token}` });
    expect(second.statusCode).toBe(201);
    const collectionB = second.json() as { id: string; title: string };

    const collectionEdgeRes = await call('POST', '/api/collection-edges', {
      fromId: collectionA.id,
      toId: collectionB.id,
      label: '相关',
    });
    expect(collectionEdgeRes.statusCode).toBe(201);
    const collectionEdge = collectionEdgeRes.json() as { id: string; fromId: string; toId: string; label: string };
    expect(collectionEdge).toMatchObject({
      fromId: collectionA.id,
      toId: collectionB.id,
      label: '相关',
    });

    const collectionSelf = await call('POST', '/api/collection-edges', {
      fromId: collectionA.id,
      toId: collectionA.id,
      label: '相关',
    });
    expect(collectionSelf.statusCode).toBe(400);
    expect(errorOf(collectionSelf.json()).message).toBe('不能连到自己');

    const library = await call('GET', '/api/library');
    expect(library.statusCode).toBe(200);
    const libraryBody = library.json() as {
      collections: { id: string }[];
      edges: { id: string }[];
    };
    expect(libraryBody.collections.map((item) => item.id)).toEqual(
      expect.arrayContaining([collectionA.id, collectionB.id]),
    );
    expect(libraryBody.edges.map((item) => item.id)).toContain(collectionEdge.id);

    const collectionEdgeDetail = await call('GET', `/api/collection-edges/${collectionEdge.id}`);
    expect(collectionEdgeDetail.statusCode).toBe(200);
    expect(collectionEdgeDetail.json()).toMatchObject({
      fromTitle: collectionA.title,
      toTitle: collectionB.title,
      cards: [],
    });

    const link = await call('POST', `/api/collections/${collectionB.id}/members`, { nodeId: nodeA.id });
    expect(link.statusCode).toBe(204);
    const linkAgain = await call('POST', `/api/collections/${collectionB.id}/members`, { nodeId: nodeA.id });
    expect(linkAgain.statusCode).toBe(204);

    const graphB = await call('GET', `/api/collections/${collectionB.id}/graph`);
    const graphBBody = graphB.json() as { nodes: { id: string }[]; edges: { id: string }[] };
    expect(graphBBody.nodes.map((item) => item.id)).toContain(nodeA.id);
    expect(graphBBody.nodes.map((item) => item.id)).not.toContain(nodeB.id);
    expect(graphBBody.edges).toEqual([]);

    const graphAAgain = await call('GET', `/api/collections/${collectionA.id}/graph`);
    expect((graphAAgain.json() as { nodes: { id: string }[] }).nodes.map((item) => item.id)).toContain(nodeA.id);

    const removedEdge = await call('DELETE', `/api/edges/${edgeAB.id}`);
    expect(removedEdge.statusCode).toBe(204);
    const afterDelete = await call('GET', `/api/collections/${collectionA.id}/graph`);
    const afterBody = afterDelete.json() as { edges: { id: string }[] };
    expect(afterBody.edges.map((item) => item.id)).not.toContain(edgeAB.id);
    expect(afterBody.edges.map((item) => item.id)).toContain(edgeBC.id);
    const gone = await call('GET', `/api/edges/${edgeAB.id}`);
    expect(gone.statusCode).toBe(404);
    expect(errorOf(gone.json()).message).toBe('关系没有找到');

    const byName = await call('GET', `/api/search?q=${encodeURIComponent(`点乙${token}`)}`);
    expect(byName.statusCode).toBe(200);
    const nameHits = byName.json() as {
      hits: { nodeId: string; name: string; collectionId: string; snippet: string }[];
    };
    expect(nameHits.hits).toEqual([
      expect.objectContaining({
        nodeId: nodeB.id,
        name: nodeB.name,
        collectionId: collectionA.id,
        snippet: nodeB.name,
      }),
    ]);

    const byCard = await call('GET', `/api/search?q=${encodeURIComponent(bodyToken)}`);
    expect(byCard.statusCode).toBe(200);
    const cardHits = byCard.json() as {
      hits: { nodeId: string; collectionId: string; snippet: string }[];
    };
    expect(cardHits.hits).toHaveLength(1);
    expect(cardHits.hits[0]).toMatchObject({ nodeId: nodeA.id, collectionId: collectionA.id });
    expect(cardHits.hits[0]?.snippet).toContain(bodyToken);

    const emptyQuery = await call('GET', '/api/search?q=%20%20');
    expect(emptyQuery.json()).toEqual({ hits: [] });

    const detachA = await call('DELETE', `/api/collections/${collectionA.id}/members/${nodeA.id}`);
    const detachB = await call('DELETE', `/api/collections/${collectionB.id}/members/${nodeA.id}`);
    expect(detachA.statusCode).toBe(204);
    expect(detachB.statusCode).toBe(204);
    const detached = await call('GET', `/api/search?q=${encodeURIComponent(`点甲${token}`)}`);
    const detachedHits = detached.json() as {
      hits: { nodeId: string; collectionId: string; collectionTitle: string }[];
    };
    const detachedA = detachedHits.hits.find((hit) => hit.nodeId === nodeA.id);
    expect(detachedA).toMatchObject({ collectionId: '', collectionTitle: '' });

    expect((await call('DELETE', `/api/nodes/${nodeA.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/nodes/${nodeB.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/nodes/${nodeC.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/collections/${collectionA.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/collections/${collectionB.id}`)).statusCode).toBe(204);
  });
});
