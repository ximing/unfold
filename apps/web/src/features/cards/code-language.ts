import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const codeLanguages = languages.slice().sort((left, right) => left.name.localeCompare(right.name, 'en'));

function ordered(list: readonly LanguageDescription[]): LanguageDescription[] {
  return list.slice().sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function match(current: string, list: readonly LanguageDescription[]): LanguageDescription | null {
  const trimmed = current.trim();
  if (trimmed === '') return null;
  const named = LanguageDescription.matchLanguageName(list, trimmed, false);
  if (named) return named;
  const needle = trimmed.toLowerCase();
  return list.find((lang) => lang.extensions.some((ext) => ext.toLowerCase() === needle)) ?? null;
}

/** 下拉里选中的值。空是纯文本，别名换成语言名，认不出的名字原样留下。 */
export function codeLanguageValue(current: string, list: readonly LanguageDescription[] = codeLanguages): string {
  const trimmed = current.trim();
  if (trimmed === '') return '';
  return match(trimmed, list)?.name ?? trimmed;
}

export function codeLanguageOptions(
  current: string,
  list: readonly LanguageDescription[] = codeLanguages,
): { value: string; label: string }[] {
  const langs = ordered(list);
  const selected = codeLanguageValue(current, langs);
  const options: { value: string; label: string; keywords?: string }[] = [{ value: '', label: '纯文本' }];
  if (selected !== '' && !langs.some((lang) => lang.name === selected)) {
    options.push({ value: selected, label: selected });
  }
  for (const lang of langs) {
    options.push({
      value: lang.name,
      label: lang.name,
      keywords: [...lang.alias, ...lang.extensions].join(' '),
    });
  }
  return options;
}

export function findCodeLanguage(current: string): LanguageDescription | null {
  return match(current, codeLanguages);
}
