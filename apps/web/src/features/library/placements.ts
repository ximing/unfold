import type { LibraryState } from './library.service.js';
import { apiSend, errorMessage } from './api.js';

export type PlacementWrite = {
  nodeId: string;
  x: number;
  y: number;
  z: number;
  imageWidth?: number;
};

let pending: Promise<void> = Promise.resolve();

function placedImageWidth(width: number): number {
  const rounded = Math.round(width);
  if (rounded < 120) return 120;
  if (rounded > 480) return 480;
  return rounded;
}

export function savePlacements(
  state: LibraryState,
  collectionId: string,
  placements: PlacementWrite[],
): Promise<boolean> {
  const job = pending.then(() => writePlacements(state, collectionId, placements));
  pending = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

async function writePlacements(
  state: LibraryState,
  collectionId: string,
  placements: PlacementWrite[],
): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/placements`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ placements }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  if (!res.ok) {
    state.error = await errorMessage(res, '位置没有保存');
    return false;
  }
  if (state.graphId !== collectionId) return true;
  const byId = new Map(placements.map((item) => [item.nodeId, item]));
  state.graph = {
    ...state.graph,
    nodes: state.graph.nodes.map((node) => {
      const next = byId.get(node.id);
      if (!next) return node;
      const imageWidth =
        typeof next.imageWidth === 'number' && Number.isFinite(next.imageWidth)
          ? placedImageWidth(next.imageWidth)
          : node.imageWidth;
      return { ...node, x: next.x, y: next.y, z: next.z, imageWidth };
    }),
  };
  return true;
}
