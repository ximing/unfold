import { observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { LibraryService } from '../services/library.service.js';

export const FocusPage = observer(function FocusPage() {
  const library = useService(LibraryService);
  const { id = '' } = useParams();
  const [docKind, setDocKind] = useState<'unknown' | 'seed' | 'text'>('unknown');

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setDocKind('unknown');
    void (async () => {
      await library.loadObject(id);
      const doc = await library.loadDocument(id);
      if (!alive) return;
      setDocKind(doc === null || doc.plainText === '' ? 'seed' : 'text');
    })();
    return () => {
      alive = false;
    };
  }, [id, library]);

  if (library.error === '没有这个点') {
    return (
      <main className="shell">
        <p>没有这个点</p>
      </main>
    );
  }

  const current = library.current;
  if (!current || current.id !== id) {
    return (
      <main className="shell">
        <p className="muted">正在读取…</p>
        {library.error ? <p role="alert">{library.error}</p> : null}
      </main>
    );
  }

  return (
    <main className="shell">
      <h1>{current.canonicalName}</h1>
      <p>{current.coreStatement}</p>
      <p className="muted">核心陈述 v{current.coreVersion}</p>
      {docKind === 'seed' ? (
        <p>这个点还是种子：只有一句话核心陈述。内容、连接、归位都后补。</p>
      ) : null}
    </main>
  );
});
