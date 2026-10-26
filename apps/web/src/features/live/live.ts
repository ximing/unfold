import { liveNoticeSchema } from '@unfold/dto';
import { clientId } from '../../shared/live/client-id.js';

const pullGapMs = 5000;
const coalesceMs = 200;

/** 登录后连接变更通知。页面可见时大约每 5 秒再拉一次当前页。 */
export function startLive(pull: () => void): () => void {
  let closed = false;
  let socket: WebSocket | null = null;
  let retryMs = 1000;
  let retryTimer = 0;
  let pullTimer = 0;
  let coalesceTimer = 0;

  const schedule = () => {
    if (closed || document.visibilityState !== 'visible') return;
    if (coalesceTimer !== 0) return;
    coalesceTimer = window.setTimeout(() => {
      coalesceTimer = 0;
      pull();
    }, coalesceMs);
  };

  const connect = () => {
    if (closed) return;
    const url = new URL('/api/live', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('client', clientId());
    const next = new WebSocket(url);
    socket = next;
    next.onopen = () => {
      retryMs = 1000;
      schedule();
    };
    next.onmessage = (event) => {
      let body: unknown;
      try {
        body = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const notice = liveNoticeSchema.safeParse(body);
      if (!notice.success || notice.data.client === clientId()) return;
      schedule();
    };
    next.onclose = () => {
      if (closed || socket !== next) return;
      retryTimer = window.setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    };
  };

  connect();
  pullTimer = window.setInterval(schedule, pullGapMs);
  const onVisible = () => {
    if (document.visibilityState === 'visible') schedule();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    closed = true;
    window.clearTimeout(retryTimer);
    window.clearTimeout(coalesceTimer);
    window.clearInterval(pullTimer);
    document.removeEventListener('visibilitychange', onVisible);
    socket?.close();
    socket = null;
  };
}
