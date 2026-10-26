import { ChevronDown, Network, Plus, Search, Settings, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type IconProps = { size?: number };

function glyph(Icon: LucideIcon, size: number) {
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}

export function IconSearch({ size = 20 }: IconProps) {
  return glyph(Search, size);
}

export function IconPlus({ size = 20 }: IconProps) {
  return glyph(Plus, size);
}

export function IconStarMap({ size = 20 }: IconProps) {
  return glyph(Network, size);
}

export function IconClose({ size = 20 }: IconProps) {
  return glyph(X, size);
}

export function IconChevron({ size = 14 }: IconProps) {
  return glyph(ChevronDown, size);
}

export function IconGear({ size = 20 }: IconProps) {
  return glyph(Settings, size);
}
