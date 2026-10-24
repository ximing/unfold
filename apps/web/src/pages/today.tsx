import { observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { SessionService } from '../services/session.service.js';

function formatDueLabel(dueAt: string): string {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return dueAt;
  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)} ${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}`;
}

export const TodayPage = observer(function TodayPage() {
  const session = useService(SessionService);
  const navigate = useNavigate();
  const [importNote, setImportNote] = useState('');

  useEffect(() => {
    void (async () => {
      if (!session.username) {
        await session.restore();
        if (!session.username) return;
      }
      await session.loadToday();
    })();
  }, [session]);

  async function onLogout() {
    await session.logout();
    navigate('/login');
  }

  if (session.ready && !session.username) return <Navigate to="/login" replace />;

  const today = session.today;

  return (
    <main className="shell">
      <h1>今日</h1>
      {!today ? (
        <>
          <p className="muted">正在读取今日…</p>
          {session.error ? <p role="alert">{session.error}</p> : null}
        </>
      ) : (
        <>
          <section className="row">
            {today.focus === null ? (
              <p>今天还没有停在哪个点上。</p>
            ) : (
              <>
                <p className="muted">
                  {today.focus.domainName} · {today.focus.type}
                </p>
                <h2>{today.focus.canonicalName}</h2>
                <p>{today.focus.coreStatement}</p>
                <p>
                  <Link to={`/o/${today.focus.id}`}>回到这个点</Link>
                </p>
              </>
            )}
          </section>
          <section className="row">
            {today.due.length === 0 ? (
              <p>该复查：没有到期的能力</p>
            ) : (
              <>
                <h2>该复查</h2>
                <ul>
                  {today.due.map((item) => {
                    const label = formatDueLabel(item.dueAt);
                    return (
                      <li key={item.capabilityId}>
                        <Link to={`/practice/${item.capabilityId}?mode=review`}>{item.statement}</Link>
                        {item.evidenceNote !== '' ? <p>{item.evidenceNote}</p> : null}
                        <p className="muted">复查日 {label}</p>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
          <p className="row">游离的点：{today.freeCount} 个。不挡学习。</p>
          <section className="row">
            {today.openQuestions.length === 0 ? (
              <p>还没想通：没有未解疑问</p>
            ) : (
              <>
                <h2>还没想通</h2>
                <ul>
                  {today.openQuestions.map((question) => (
                    <li key={question.blockId}>{question.text}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <p>未处理的建议：{today.pendingSuggestions}</p>
        </>
      )}
      <p>
        <Link to="/new">新建点</Link>
      </p>
      <button type="button" onClick={() => void session.exportPackage()}>
        导出
      </button>
      <label>
        导入
        <input
          aria-label="导入包"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            setImportNote('');
            void (async () => {
              try {
                const parsed: unknown = JSON.parse(await file.text());
                const ok = await session.importPackage(parsed);
                if (!ok) return;
                setImportNote('已导入');
                await session.loadToday();
              } catch {
                session.error = '导入没有完成';
              }
            })();
          }}
        />
      </label>
      {importNote !== '' ? <p>{importNote}</p> : null}
      {session.error ? <p role="alert">{session.error}</p> : null}
      <button type="button" onClick={() => void onLogout()}>
        登出
      </button>
    </main>
  );
});
