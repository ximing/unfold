import type { EdgeColor, EdgeDash, EdgeWidth } from '@unfold/dto';

export const EDGE_STROKE: Record<EdgeColor, { line: string; hover: string }> = {
  gray: { line: 'rgba(0, 0, 0, 0.22)', hover: 'rgba(0, 0, 0, 0.45)' },
  blue: { line: '#0a66ff', hover: '#0053d6' },
  green: { line: '#248a3d', hover: '#1b6b2f' },
  red: { line: '#d92d20', hover: '#b42318' },
};

export const EDGE_WIDTH: Record<EdgeWidth, number> = {
  thin: 1.2,
  medium: 1.8,
  thick: 2.6,
};

export const EDGE_DASH: Record<EdgeDash, string | undefined> = {
  solid: undefined,
  dashed: '6 4',
  dotted: '0.8 3.6',
};
