import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHandoff } from './handoff.js';
import {
  beginWrite,
  endWrite,
  hasUnsaved,
  noteDraft,
  readSave,
  registerDraft,
  resetSave,
  saveLabel,
  saveNow,
  startQuietSave,
  watchWrite,
} from './save-bus.js';
import { takeServerText } from './server-text.js';

describe('takeServerText', () => {
  it('换了对象就采用新文本', () => {
    expect(takeServerText('旧', '旧', '新', true)).toBe('reset');
  });

  it('回声与本地相同只确认基线', () => {
    expect(takeServerText('甲', '旧', '甲', false)).toBe('echo');
  });

  it('本地已经又改过就不覆盖', () => {
    expect(takeServerText('甲乙', '甲', '甲', false)).toBe('keep');
  });

  it('本地还停在上次确认的文本时接受外部更新', () => {
    expect(takeServerText('甲', '甲', '乙', false)).toBe('apply');
  });
});

describe('保存总线', () => {
  afterEach(() => {
    resetSave();
    vi.useRealTimers();
  });

  it('还没有写过时是空闲', () => {
    expect(readSave()).toEqual({ phase: 'idle', detail: '' });
    expect(saveLabel('idle')).toBeNull();
    expect(hasUnsaved()).toBe(false);
  });

  it('脏草稿盖过已保存，提交后恢复', () => {
    beginWrite();
    endWrite(true, '');
    expect(readSave().phase).toBe('saved');
    expect(saveLabel('saved')).toBe('保存成功');

    let dirty = true;
    const stop = registerDraft({
      dirty: () => dirty,
      flush: () => {
        dirty = false;
      },
    });
    noteDraft();
    expect(readSave().phase).toBe('dirty');
    expect(saveLabel('dirty')).toBe('未保存');
    expect(hasUnsaved()).toBe(true);

    saveNow();
    expect(readSave().phase).toBe('saved');
    stop();
  });

  it('只提交脏草稿', () => {
    const calls: string[] = [];
    const stopClean = registerDraft({
      dirty: () => false,
      flush: () => calls.push('clean'),
    });
    const stopDirty = registerDraft({
      dirty: () => true,
      flush: () => calls.push('dirty'),
    });
    saveNow();
    expect(calls).toEqual(['dirty']);
    stopClean();
    stopDirty();
  });

  it('失败留到这一轮结束，下一轮成功再清掉', async () => {
    let releaseFirst: (value: boolean) => void = () => {};
    let releaseSecond: (value: boolean) => void = () => {};
    const first = watchWrite(
      () =>
        new Promise<boolean>((resolve) => {
          releaseFirst = resolve;
        }),
      (ok) => ok,
      () => '甲没有保存',
    );
    const second = watchWrite(
      () =>
        new Promise<boolean>((resolve) => {
          releaseSecond = resolve;
        }),
      (ok) => ok,
      () => '乙没有保存',
    );
    expect(readSave().phase).toBe('saving');
    expect(saveLabel('saving')).toBe('保存中');

    releaseFirst(false);
    await first;
    expect(readSave().phase).toBe('saving');

    releaseSecond(true);
    await second;
    expect(readSave()).toEqual({ phase: 'failed', detail: '甲没有保存' });
    expect(saveLabel('failed')).toBe('保存失败');
    expect(hasUnsaved()).toBe(true);

    await watchWrite(async () => true, (ok) => ok, () => '没有保存');
    expect(readSave()).toEqual({ phase: 'saved', detail: '' });
    expect(hasUnsaved()).toBe(false);
  });

  it('停下两秒只提交还开着的草稿', () => {
    vi.useFakeTimers();
    const stopQuiet = startQuietSave(2000);
    const calls: string[] = [];
    let liveDirty = true;
    let inlineDirty = true;
    const stopLive = registerDraft({
      dirty: () => liveDirty,
      flush: () => {
        liveDirty = false;
        calls.push('live');
      },
    });
    const stopInline = registerDraft({
      dirty: () => inlineDirty,
      flush: () => {
        inlineDirty = false;
        calls.push('inline');
      },
      live: false,
    });
    noteDraft();
    vi.advanceTimersByTime(1999);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['live']);
    saveNow();
    expect(calls).toEqual(['live', 'inline']);
    stopLive();
    stopInline();
    stopQuiet();
  });

  it('失败时仍有脏草稿，状态停在保存失败', () => {
    beginWrite();
    endWrite(false, '网络没有连上');
    const stop = registerDraft({ dirty: () => true, flush: () => undefined });
    noteDraft();
    expect(readSave()).toEqual({ phase: 'failed', detail: '网络没有连上' });
    stop();
  });
});

describe('交接', () => {
  afterEach(() => {
    resetSave();
  });

  it('同一份快照只交一次，失败后可以再交', async () => {
    const hand = createHandoff();
    let calls = 0;
    await hand.send('甲', '', () => {
      calls += 1;
      return false;
    });
    expect(hand.dirty('甲', '')).toBe(true);
    expect(calls).toBe(1);

    await hand.send('甲', '', () => {
      calls += 1;
      return false;
    });
    await hand.send('甲', '', () => {
      calls += 1;
      return true;
    });
    expect(calls).toBe(3);
    expect(hand.dirty('甲', '')).toBe(false);
  });

  it('飞行中又改了字，旧请求成功也不算已保存', async () => {
    const hand = createHandoff();
    let release: (value: boolean) => void = () => {};
    const pending = hand.send(
      '甲',
      '',
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    hand.edit();
    expect(hand.dirty('甲乙', '')).toBe(true);
    release(true);
    await pending;
    expect(hand.dirty('甲乙', '')).toBe(true);
  });

  it('飞行中的同一份快照不会再交一次', async () => {
    const hand = createHandoff();
    let calls = 0;
    let release: (value: boolean) => void = () => {};
    const pending = hand.send(
      '甲',
      '',
      () =>
        new Promise<boolean>((resolve) => {
          calls += 1;
          release = resolve;
        }),
    );
    await hand.send('甲', '', () => {
      calls += 1;
      return true;
    });
    release(true);
    await pending;
    expect(calls).toBe(1);
    expect(hand.dirty('甲', '')).toBe(false);
  });
});
