export type BoardMenuAction =
  | 'create'
  | 'image'
  | 'rename'
  | 'open'
  | 'grow-child'
  | 'grow-sibling'
  | 'connect'
  | 'remove'
  | 'delete-item'
  | 'relabel'
  | 'delete-link';

export type BoardMenuEntry = {
  action?: BoardMenuAction;
  label: string;
  hint?: string;
  danger?: boolean;
  separator?: boolean;
};

export type BoardMenuTarget = {
  kind: 'canvas' | 'node' | 'edge';
  /** 合集画布为真。全貌为假，用来区分「点」和「合集」 */
  tools: boolean;
  canCreate: boolean;
  canImage: boolean;
  canRename: boolean;
  canOpen: boolean;
  canGrow: boolean;
  canConnect: boolean;
  canRemove: boolean;
  canDeleteItem: boolean;
  canRelabel: boolean;
  canDeleteLink: boolean;
};

/** 右键菜单里和这个对象有关的项。缩放由视口另加。 */
export function boardMenu(target: BoardMenuTarget): BoardMenuEntry[] {
  if (target.kind === 'canvas') {
    const items: BoardMenuEntry[] = [];
    if (target.canCreate) {
      items.push({ action: 'create', label: target.tools ? '添加文字点' : '新建合集', hint: '双击' });
    }
    if (target.tools && target.canImage) items.push({ action: 'image', label: '添加图片', hint: 'I' });
    return items;
  }

  if (target.kind === 'node') {
    const items: BoardMenuEntry[] = [];
    if (target.canOpen) items.push({ action: 'open', label: '打开', hint: '双击' });
    if (target.canRename) items.push({ action: 'rename', label: '改名', hint: '双击' });
    if (target.canGrow) {
      items.push({ action: 'grow-child', label: '建下级', hint: 'Tab' });
      items.push({ action: 'grow-sibling', label: '建同级', hint: 'Enter' });
    }
    if (target.canConnect) items.push({ action: 'connect', label: '从这里连线' });
    const tail: BoardMenuEntry[] = [];
    if (target.canRemove) tail.push({ action: 'remove', label: '移出这个合集' });
    if (target.canDeleteItem) {
      tail.push({
        action: 'delete-item',
        label: target.tools ? '删除这个点' : '删除合集',
        hint: target.tools ? 'Delete' : undefined,
        danger: true,
      });
    }
    if (items.length > 0 && tail.length > 0) items.push({ separator: true, label: '' });
    return [...items, ...tail];
  }

  const items: BoardMenuEntry[] = [];
  if (target.canRelabel) items.push({ action: 'relabel', label: '改标签', hint: '双击' });
  if (target.canDeleteLink) {
    if (items.length > 0) items.push({ separator: true, label: '' });
    items.push({ action: 'delete-link', label: '删除关系', hint: 'Delete', danger: true });
  }
  return items;
}
