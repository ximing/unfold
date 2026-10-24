export type GraphSector = 'origin' | 'destination' | 'contrast' | 'change';

export type GraphNeighbor = {
  id: string;
  sector: GraphSector;
  canonicalName: string;
  coreStatement: string;
};

export type GraphPoint = {
  id: string;
  canonicalName: string;
  coreStatement: string;
  x: number;
  y: number;
};

export type GraphLayout = {
  truncated: boolean;
  nodes: GraphPoint[];
  edges: { fromId: string; toId: string }[];
};

const RADIUS = 180;
const GAP = 72;
const LIMIT = 50;

type Focus = { id: string; canonicalName: string; coreStatement: string };

function offset(slot: number, count: number): number {
  return (slot - (count - 1) / 2) * GAP;
}

function place(
  focusId: string,
  neighbors: GraphNeighbor[],
  at: (slot: number, count: number) => { x: number; y: number },
  nodes: GraphPoint[],
  edges: { fromId: string; toId: string }[],
) {
  neighbors.forEach((neighbor, slot) => {
    const point = at(slot, neighbors.length);
    nodes.push({
      id: neighbor.id,
      canonicalName: neighbor.canonicalName,
      coreStatement: neighbor.coreStatement,
      x: point.x,
      y: point.y,
    });
    edges.push({ fromId: focusId, toId: neighbor.id });
  });
}

export function layoutGraph(focus: Focus, neighbors: GraphNeighbor[]): GraphLayout {
  const kept = neighbors.slice(0, LIMIT);
  const groups: Record<GraphSector, GraphNeighbor[]> = {
    origin: [],
    destination: [],
    contrast: [],
    change: [],
  };
  for (const neighbor of kept) groups[neighbor.sector].push(neighbor);
  const nodes: GraphPoint[] = [
    {
      id: focus.id,
      canonicalName: focus.canonicalName,
      coreStatement: focus.coreStatement,
      x: 0,
      y: 0,
    },
  ];
  const edges: { fromId: string; toId: string }[] = [];
  place(focus.id, groups.origin, (slot, count) => ({ x: -RADIUS, y: offset(slot, count) }), nodes, edges);
  place(focus.id, groups.destination, (slot, count) => ({ x: RADIUS, y: offset(slot, count) }), nodes, edges);
  place(focus.id, groups.contrast, (slot, count) => ({ x: offset(slot, count), y: -RADIUS }), nodes, edges);
  place(focus.id, groups.change, (slot, count) => ({ x: offset(slot, count), y: RADIUS }), nodes, edges);
  return { truncated: neighbors.length > LIMIT, nodes, edges };
}
