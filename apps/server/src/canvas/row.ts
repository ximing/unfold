import { canvasPrefsSchema, type CanvasPrefs } from '@unfold/dto';
import { users } from '../db/schema.js';

export const canvasSelection = {
  canvasRoute: users.canvasRoute,
  canvasGrid: users.canvasGrid,
  canvasSnap: users.canvasSnap,
  canvasLabels: users.canvasLabels,
  canvasMarkers: users.canvasMarkers,
  canvasMinimap: users.canvasMinimap,
};

export function canvasFromRow(row: {
  canvasRoute: string;
  canvasGrid: boolean;
  canvasSnap: boolean;
  canvasLabels: string;
  canvasMarkers: boolean;
  canvasMinimap: boolean;
}): CanvasPrefs {
  return canvasPrefsSchema.parse({
    route: row.canvasRoute,
    grid: row.canvasGrid,
    snap: row.canvasSnap,
    labels: row.canvasLabels,
    markers: row.canvasMarkers,
    minimap: row.canvasMinimap,
  });
}
