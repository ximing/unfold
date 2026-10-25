import { observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { SessionService } from '../services/session.service.js';

export const HomePage = observer(function HomePage() {
  const session = useService(SessionService);
  const navigate = useNavigate();

  useEffect(() => {
    void (async () => {
      const ok = await session.restore();
      navigate(ok ? '/library' : '/login', { replace: true });
    })();
  }, [navigate, session]);

  return <p className="muted">正在确认会话…</p>;
});
