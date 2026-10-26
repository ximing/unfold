type Sink = {
  userId: string;
  client: string;
  send: (text: string) => void;
};

const sinks = new Set<Sink>();

export function openLive(userId: string, client: string, send: (text: string) => void): () => void {
  const sink: Sink = { userId, client, send };
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

export function publishLive(userId: string, client: string): void {
  const text = JSON.stringify({ client });
  for (const sink of sinks) {
    if (sink.userId !== userId || sink.client === client) continue;
    try {
      sink.send(text);
    } catch {
      sinks.delete(sink);
    }
  }
}
