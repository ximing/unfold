export type SavePhase = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed';

export type SaveSnapshot = {
  phase: SavePhase;
  /** 保存失败时的说明。其它阶段为空。 */
  detail: string;
};

type Draft = {
  dirty: () => boolean;
  flush: () => void;
  /** 图上创建、改名、改标签不参加静默保存。 */
  live?: boolean;
};

let quietOn = false;
let quietDelay = 2000;
let quietTimer: ReturnType<typeof setTimeout> | null = null;

let pending = 0;
let waveFailed = false;
let failed = false;
let detail = '';
let everSaved = false;
const drafts = new Set<Draft>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeSave(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function anyDirty(): boolean {
  for (const draft of drafts) {
    if (draft.dirty()) return true;
  }
  return false;
}

export function readSave(): SaveSnapshot {
  if (pending > 0) return { phase: 'saving', detail: '' };
  if (failed) return { phase: 'failed', detail };
  if (anyDirty()) return { phase: 'dirty', detail: '' };
  if (everSaved) return { phase: 'saved', detail: '' };
  return { phase: 'idle', detail: '' };
}

export function saveLabel(phase: SavePhase): string | null {
  if (phase === 'dirty') return '未保存';
  if (phase === 'saving') return '保存中';
  if (phase === 'saved') return '保存成功';
  if (phase === 'failed') return '保存失败';
  return null;
}

export function hasUnsaved(): boolean {
  const phase = readSave().phase;
  return phase === 'dirty' || phase === 'saving' || phase === 'failed';
}

export function beginWrite(): void {
  if (pending === 0) waveFailed = false;
  pending += 1;
  emit();
}

export function endWrite(ok: boolean, message: string): void {
  pending = Math.max(0, pending - 1);
  if (!ok) {
    waveFailed = true;
    detail = message === '' ? '没有保存' : message;
  }
  if (pending === 0) {
    if (waveFailed) failed = true;
    else {
      failed = false;
      detail = '';
      everSaved = true;
    }
    waveFailed = false;
  }
  emit();
}

export async function watchWrite<T>(
  run: () => Promise<T>,
  ok: (value: T) => boolean,
  message: () => string,
): Promise<T> {
  beginWrite();
  try {
    const value = await run();
    const succeeded = ok(value);
    endWrite(succeeded, succeeded ? '' : message());
    return value;
  } catch (error) {
    endWrite(false, message() || '没有保存');
    throw error;
  }
}

export function registerDraft(draft: Draft): () => void {
  drafts.add(draft);
  return () => {
    drafts.delete(draft);
    emit();
  };
}

export function noteDraft(): void {
  emit();
  if (!quietOn) return;
  if (quietTimer !== null) clearTimeout(quietTimer);
  quietTimer = setTimeout(() => {
    quietTimer = null;
    saveLive();
  }, quietDelay);
}

/** 只刷新状态，不重新开始静默保存的等待。 */
export function refreshSave(): void {
  emit();
}

export function saveNow(): void {
  flushDrafts(false);
}

/** 提交仍开着的草稿。图上那一行输入不参加。 */
export function saveLive(): void {
  flushDrafts(true);
}

function flushDrafts(liveOnly: boolean): void {
  for (const draft of [...drafts]) {
    if (liveOnly && draft.live === false) continue;
    if (!draft.dirty()) continue;
    draft.flush();
  }
  emit();
}

/** 停下输入这么久之后，提交仍开着的草稿。 */
export function startQuietSave(delayMs = 2000): () => void {
  quietOn = true;
  quietDelay = delayMs;
  return () => {
    quietOn = false;
    if (quietTimer !== null) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }
  };
}

export function resetSave(): void {
  pending = 0;
  waveFailed = false;
  failed = false;
  detail = '';
  everSaved = false;
  drafts.clear();
  quietOn = false;
  if (quietTimer !== null) {
    clearTimeout(quietTimer);
    quietTimer = null;
  }
  emit();
}
