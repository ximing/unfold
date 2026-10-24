import { observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { LibraryService } from '../services/library.service.js';

export const FreePage = observer(function FreePage() {
  const library = useService(LibraryService);
  const { domainId = '' } = useParams();
  const [listed, setListed] = useState(false);

  useEffect(() => {
    if (!domainId) return;
    let alive = true;
    setListed(false);
    void (async () => {
      await library.loadDomains();
      if (!alive) return;
      await library.loadObjects(domainId);
      if (!alive) return;
      setListed(true);
    })();
    return () => {
      alive = false;
    };
  }, [domainId, library]);

  const domainName = library.domains.find((domain) => domain.id === domainId)?.name;

  return (
    <main className="shell">
      <h1>{domainName ? `${domainName} · 游离的点` : '游离的点'}</h1>
      <p>
        先学后整理：这些点已经能粘贴、连接、练习、被搜索到，只是还没编进合集。游离是合法状态，不是错误。
      </p>
      {library.error ? <p role="alert">{library.error}</p> : null}
      {!listed ? <p className="muted">正在读取…</p> : null}
      {listed && !library.error && library.objects.length === 0 ? (
        <p>这个领域还没有游离的点。</p>
      ) : null}
      {listed && library.objects.length > 0 ? (
        <ul>
          {library.objects.map((object) => (
            <li key={object.id}>
              <Link to={`/o/${object.id}`}>{object.canonicalName}</Link>
              {object.coreStatement ? <p className="muted">{object.coreStatement}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
});
