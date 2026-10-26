import { noteDraft, refreshSave } from './save-bus.js';

export type SaveHandoff = {
  dirty: (current: string, saved: string) => boolean;
  edit: () => void;
  send: (
    current: string,
    saved: string,
    run: () => Promise<boolean | void> | boolean | void,
  ) => Promise<void>;
};

/**
 * 同一份快照交给服务器之后，在回声或失败之前不再算作未保存。
 * 失败则收回，⌘S 可以再交。输入又变了就立刻收回。
 */
export function createHandoff(): SaveHandoff {
  let token: string | null = null;
  return {
    dirty(current, saved) {
      if (current === saved) return false;
      if (token === current) return false;
      return true;
    },
    edit() {
      token = null;
      noteDraft();
    },
    async send(current, saved, run) {
      if (current === saved || token === current) return;
      token = current;
      let result: boolean | void;
      try {
        result = await run();
      } catch {
        if (token === current) token = null;
        refreshSave();
        return;
      }
      if (result === false && token === current) token = null;
      refreshSave();
    },
  };
}
