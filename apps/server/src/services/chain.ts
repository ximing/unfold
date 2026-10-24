export type ChainEdge = {
  id: string;
  fromId: string;
  toId: string;
  type: 'evolves_from' | 'variant';
  whatChanged: string;
  createdAt: Date;
};

export type ChainLink = {
  fromId: string;
  toId: string;
  whatChanged: string;
};

export type Chain = {
  type: 'evolves_from' | 'variant';
  nodeIds: string[];
  edges: ChainLink[];
};

export type ChainLayoutNode = {
  id: string;
  x: number;
  y: number;
};

type DisplayStep = {
  id: string;
  leftId: string;
  rightId: string;
  whatChanged: string;
  createdAt: Date;
};

const chainTypes = ['evolves_from', 'variant'] as const;

function displayOf(edge: ChainEdge): DisplayStep {
  // evolves_from 存的是后来的点 → 来历；显示时来历在左。
  const originOnLeft = edge.type === 'evolves_from';
  return {
    id: edge.id,
    leftId: originOnLeft ? edge.toId : edge.fromId,
    rightId: originOnLeft ? edge.fromId : edge.toId,
    whatChanged: edge.whatChanged,
    createdAt: edge.createdAt,
  };
}

function pushStep(map: Map<string, DisplayStep[]>, key: string, step: DisplayStep) {
  const list = map.get(key);
  if (list) list.push(step);
  else map.set(key, [step]);
}

function earlier(left: DisplayStep, right: DisplayStep): boolean {
  const leftMs = left.createdAt.getTime();
  const rightMs = right.createdAt.getTime();
  if (leftMs !== rightMs) return leftMs < rightMs;
  return left.id < right.id;
}

function pick(
  steps: DisplayStep[],
  visited: Set<string>,
  nextId: (step: DisplayStep) => string,
): DisplayStep | null {
  let chosen: DisplayStep | null = null;
  for (const step of steps) {
    if (visited.has(nextId(step))) continue;
    if (!chosen || earlier(step, chosen)) chosen = step;
  }
  return chosen;
}

function walk(
  start: string,
  nextSteps: Map<string, DisplayStep[]>,
  nextId: (step: DisplayStep) => string,
  visited: Set<string>,
): { nodeId: string; edge: ChainLink }[] {
  const collected: { nodeId: string; edge: ChainLink }[] = [];
  let cursor = start;
  let step = pick(nextSteps.get(cursor) ?? [], visited, nextId);
  while (step) {
    const nodeId = nextId(step);
    visited.add(nodeId);
    collected.push({
      nodeId,
      edge: { fromId: step.leftId, toId: step.rightId, whatChanged: step.whatChanged },
    });
    cursor = nodeId;
    step = pick(nextSteps.get(cursor) ?? [], visited, nextId);
  }
  return collected;
}

function buildTyped(focusId: string, type: Chain['type'], edges: ChainEdge[]): Chain | null {
  const steps = edges.filter((edge) => edge.type === type).map(displayOf);
  if (steps.length === 0) return null;

  const byLeft = new Map<string, DisplayStep[]>();
  const byRight = new Map<string, DisplayStep[]>();
  for (const step of steps) {
    pushStep(byLeft, step.leftId, step);
    pushStep(byRight, step.rightId, step);
  }

  const visited = new Set<string>([focusId]);
  const left = walk(focusId, byRight, (step) => step.leftId, visited);
  const right = walk(focusId, byLeft, (step) => step.rightId, visited);
  if (left.length === 0 && right.length === 0) return null;

  return {
    type,
    nodeIds: [...left.map((item) => item.nodeId).reverse(), focusId, ...right.map((item) => item.nodeId)],
    edges: [...left.map((item) => item.edge).reverse(), ...right.map((item) => item.edge)],
  };
}

export function buildChain(focusId: string, edges: ChainEdge[]): Chain[] {
  const chains: Chain[] = [];
  for (const type of chainTypes) {
    const chain = buildTyped(focusId, type, edges);
    if (chain) chains.push(chain);
  }
  return chains;
}

export function layoutChain(nodeIds: string[]): ChainLayoutNode[] {
  return nodeIds.map((id, index) => ({ id, x: index * 160, y: 0 }));
}
