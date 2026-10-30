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
  | 'delete-link'
  | 'insert-inclusion'
  | 'toggle-inclusion'
  | 'remove-inclusion';

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
  /** 合集画布可以插入子集合 */
  canInsert: boolean;
};

/** 右键菜单里和这个对象有关的项。缩放由视口另加。 */
export function boardMenu(target: BoardMenuTarget): BoardMenuEntry[] {
  if (target.kind === 'canvas') {
    const items: BoardMenuEntry[] = [];
    if (target.canCreate) {
      items.push({ action: 'create', label: target.tools ? '添加文字点' : '新建合集', hint: '双击' });
    }
    if (target.tools && target.canImage) items.push({ action: 'image', label: '添加图片', hint: 'I' });
    if (target.tools && target.canInsert) items.push({ action: 'insert-inclusion', label: '插入子集合' });
    return items;
  }

  if (target.kind === 'node') {
    const items: BoardMenuEntry[] = [];
    if (target.canOpen) items.push({ action: 'open', label: '打开', hint: '双击' });
    if (target.canRename) items.push({ action: 'rename', label: '改名', hint: '双击' });
    if (target.canGrow) {
      items.push({ action: 'grow-child', label: '在旁边新建', hint: 'Tab' });
      items.push({ action: 'grow-sibling', label: '在下方新建', hint: 'Enter' });
    }
    if (target.canConnect) items.push({ action: 'connect', label: '从这里连线' });
    const tail: BoardMenuEntry[] = [];
    if (target.canRemove) tail.push({ action: 'remove', label: '移出当前合集' });
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

/** 子集合的菜单。收起时是「展开」，展开的边框是「收起」。 */
export function inclusionMenu(collapsed: boolean): BoardMenuEntry[] {
  return [
    { action: 'toggle-inclusion', label: collapsed ? '展开' : '收起' },
    { separator: true, label: '' },
    { action: 'remove-inclusion', label: '移出这个合集', danger: true },
  ];
}
