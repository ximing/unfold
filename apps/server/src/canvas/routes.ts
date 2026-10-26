import { canvasPrefsSchema } from '@unfold/dto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { users } from '../db/schema.js';
import type { Database } from '../graph/db.js';
import { invalidBody, type SessionLookup } from '../http.js';
import { canvasFromRow } from './row.js';

export function registerCanvasRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.patch('/api/me/canvas', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = canvasPrefsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody());

    const updated = await db
      .update(users)
      .set({
        canvasRoute: parsed.data.route,
        canvasGrid: parsed.data.grid,
        canvasSnap: parsed.data.snap,
        canvasLabels: parsed.data.labels,
        canvasMarkers: parsed.data.markers,
        canvasMinimap: parsed.data.minimap,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
      .returning({
        canvasRoute: users.canvasRoute,
        canvasGrid: users.canvasGrid,
        canvasSnap: users.canvasSnap,
        canvasLabels: users.canvasLabels,
        canvasMarkers: users.canvasMarkers,
        canvasMinimap: users.canvasMinimap,
      });
    const row = updated[0];
    if (!row) return reply.code(401).send({ error: { code: 'unauthenticated', message: '未登录' } });
    return reply.code(200).send(canvasFromRow(row));
  });
}
