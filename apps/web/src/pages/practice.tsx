import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { SessionService } from '../services/session.service.js';
import { PracticeService } from '../services/practice.service.js';

function formatDue(dueAt: string): string {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return dueAt;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const PracticeContent = observer(function PracticeContent() {
  const session = useService(SessionService);
  const practice = useService(PracticeService);
  const { capabilityId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'review' ? 'review' : 'practice';
  const [attempt, setAttempt] = useState('');
  const [revealed, setRevealed] = useState(0);
  const [failing, setFailing] = useState(false);
  const [obstacle, setObstacle] = useState('');
  const [offerCapability, setOfferCapability] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!session.username) {
        await session.restore();
        if (!session.username) return;
      }
      if (!capabilityId) return;
      await practice.load(capabilityId);
    })();
  }, [capabilityId, practice, session]);

  const hints = practice.capability?.hints ?? [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (event.key !== '1' && event.key !== '2' && event.key !== '3' && event.key !== '4') return;
      event.preventDefault();
      const level = Number(event.key);
      setRevealed((current) => Math.max(current, Math.min(level, hints.length)));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hints.length]);

  if (session.ready && !session.username) return <Navigate to="/login" replace />;

  const capability = practice.capability;
  if (!capability || capability.id !== capabilityId) {
    return (
      <main className="shell">
        <p className="muted">正在读取…</p>
        {practice.error ? <p role="alert">{practice.error}</p> : null}
      </main>
    );
  }

  const lockedByHint = revealed >= capability.hintThreshold;

  async function submit(rating: 'independent' | 'with_hint' | 'partial' | 'fail', obstacleText: string) {
    setBusy(true);
    const ok = await practice.submit({
      id: capabilityId,
      hintLevel: revealed,
      rating,
      obstacle: obstacleText,
      body: attempt,
      mode,
    });
    setBusy(false);
    if (!ok) return;
    if (rating === 'fail') {
      setDraft(obstacleText.trim());
      if (obstacleText.trim() !== '') setOfferCapability(true);
    }
  }

  return (
    <main className="shell">
      <p className="muted">先写自己的回答，材料先挡着。</p>
      <h2>{capability.statement}</h2>
      {capability.prompt !== '' ? <p>{capability.prompt}</p> : null}
      <p>
        <Link to={`/o/${capability.primaryObjectId}`}>回到这个点</Link>
      </p>
      {capability.practiceLocked ? (
        <p className="fail" role="alert">
          {capability.practiceLockMessage}
        </p>
      ) : (
        <>
          <textarea aria-label="这次的尝试" value={attempt} onChange={(event) => setAttempt(event.target.value)} />
          <p>
            提示 {revealed} / {hints.length}（键盘 1–4 直接展开到对应级）
          </p>
          <ol>
            {hints.slice(0, revealed).map((hint, index) => (
              <li key={`${index}-${hint}`}>{hint}</li>
            ))}
          </ol>
          <p>
            <button
              type="button"
              disabled={revealed >= hints.length}
              onClick={() => setRevealed((current) => Math.min(hints.length, current + 1))}
            >
              看下一条提示
            </button>
          </p>
          {lockedByHint ? <p className="fail">提示已经到第 {revealed} 级。这次不能记为独立完成。</p> : null}
          <div className="practice-actions">
            <button type="button" disabled={busy || lockedByHint} onClick={() => void submit('independent', '')}>
              独立完成
            </button>
            <button type="button" disabled={busy} onClick={() => void submit('with_hint', '')}>
              有提示地完成
            </button>
            <button type="button" disabled={busy} onClick={() => void submit('partial', '')}>
              部分完成
            </button>
            <button type="button" disabled={busy} onClick={() => setFailing(true)}>
              没做出来
            </button>
          </div>
          {failing ? (
            <>
              <textarea aria-label="这次具体卡在哪里" value={obstacle} onChange={(event) => setObstacle(event.target.value)} />
              <p>
                <button type="button" disabled={busy} onClick={() => void submit('fail', obstacle)}>
                  记下这次
                </button>
              </p>
            </>
          ) : null}
          {offerCapability ? (
            <>
              <input aria-label="收成能力的句子" value={draft} onChange={(event) => setDraft(event.target.value)} />
              <p>
                <button
                  type="button"
                  disabled={busy || draft.trim() === ''}
                  onClick={() => void practice.saveFromObstacle(draft.trim(), capability.primaryObjectId)}
                >
                  把这句收成一条能力
                </button>
              </p>
            </>
          ) : null}
        </>
      )}
      {practice.note !== '' ? <p>{practice.note}</p> : null}
      {practice.dueAt !== '' ? <p className="muted">复查日 {formatDue(practice.dueAt)}</p> : null}
      {practice.error ? (
        <p className="fail" role="alert">
          {practice.error}
        </p>
      ) : null}
    </main>
  );
});

export const PracticePage = bindServices(PracticeContent, [PracticeService]);
