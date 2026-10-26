export type ServerText = 'reset' | 'echo' | 'keep' | 'apply';

/** 服务器回声怎么落回输入框。本地已经又改过时保持本地。 */
export function takeServerText(local: string, saved: string, incoming: string, switched: boolean): ServerText {
  if (switched) return 'reset';
  if (incoming === local) return 'echo';
  if (local !== saved) return 'keep';
  return 'apply';
}
