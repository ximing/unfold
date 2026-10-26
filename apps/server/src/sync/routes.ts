import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { openLive, publishLive } from './hub.js';
import { liveClient, shouldPublish } from './notice.js';

const querySchema = z.object({
  client: z.uuid(),
});

export async function registerLive(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get('/api/live', { websocket: true }, (socket, request) => {
    const raw = request.cookies.unfold_session;
    const unsigned = raw ? request.unsignCookie(raw) : { valid: false as const, value: null };
    const parsed = querySchema.safeParse(request.query);
    if (!raw || unsigned.valid !== true || !unsigned.value || !parsed.success) {
      socket.close();
      return;
    }
    const userId = unsigned.value;
    const client = parsed.data.client;
    const close = openLive(userId, client, (text) => {
      socket.send(text);
    });
    socket.on('close', close);
    socket.on('error', close);
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!shouldPublish(request.method, request.url, reply.statusCode)) return;
    const raw = request.cookies.unfold_session;
    if (!raw) return;
    const unsigned = reply.unsignCookie(raw);
    if (unsigned.valid !== true || !unsigned.value) return;
    publishLive(unsigned.value, liveClient(request.headers['x-unfold-client']));
  });
}
