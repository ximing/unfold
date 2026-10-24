import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router';
import { LibraryService } from '../services/library.service.js';
import { SessionService } from '../services/session.service.js';

const ShellView = observer(function ShellView() {
  const session = useService(SessionService);
  const library = useService(LibraryService);

  useEffect(() => {
    void (async () => {
      if (!session.username) await session.restore();
      if (session.username) await library.loadDomains();
    })();
  }, [library, session]);

  if (session.ready && !session.username) return <Navigate to="/login" replace />;

  return (
    <div className="frame">
      <aside className="rail">
        <NavLink to="/today">今日</NavLink>
        {library.domains.map((domain) => (
          <div key={domain.id} className="rail-domain">
            <p>{domain.name}</p>
            <NavLink to={`/free/${domain.id}`}>游离 · {domain.freeCount} 个点</NavLink>
          </div>
        ))}
        <p className="muted">还没有合集</p>
        <NavLink to="/new">新建点</NavLink>
        {library.error === '领域没有加载出来' ? <p role="alert">{library.error}</p> : null}
      </aside>
      <Outlet />
    </div>
  );
});

export const Shell = bindServices(ShellView, [LibraryService]);
