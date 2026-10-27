import hljs from 'highlight.js/lib/core';
import { common } from 'lowlight';

export const defaultRichCodeLanguage = 'javascript';

export type RichCodeLanguageOption = { value: string; label: string; keywords?: string };

const described: RichCodeLanguageOption[] = Object.keys(common)
  .filter((id) => id !== 'plaintext')
  .sort((left, right) => left.localeCompare(right, 'en'))
  .map((id) => {
    const lang = common[id]?.(hljs);
    const aliases = lang && Array.isArray(lang.aliases) ? lang.aliases : [];
    const name = lang?.name?.trim() ?? '';
    return {
      value: id,
      label: name !== '' ? name : id,
      keywords: [id, ...aliases].join(' '),
    };
  });

/** 富文本代码块的语言列表。空值是纯文本。plaintext 并进纯文本。认不出的名字留在列表里。 */
export function richCodeLanguageOptions(current: string): RichCodeLanguageOption[] {
  const selected = current === 'plaintext' ? '' : current.trim();
  const options: RichCodeLanguageOption[] = [{ value: '', label: '纯文本' }];
  if (selected !== '' && !described.some((option) => option.value === selected)) {
    options.push({ value: selected, label: selected });
  }
  options.push(...described);
  return options;
}
