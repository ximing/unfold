export const NODE_PANEL_WIDTH_KEY = 'unfold.node-panel-width';
export const NODE_PANEL_WIDTH_MIN = 480;
export const NODE_PANEL_WIDTH_MAX = 880;
export const NODE_PANEL_CANVAS_MIN = 320;

const DEFAULT_WIDTH = 640;

/** 能解析成有限数且落在 480–880（含）则用它，否则 640。小数在区间内也接受。 */
export function readPanelWidth(raw: string | null): number {
  if (raw === null) return DEFAULT_WIDTH;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < NODE_PANEL_WIDTH_MIN || value > NODE_PANEL_WIDTH_MAX) {
    return DEFAULT_WIDTH;
  }
  return value;
}

/**
 * 偏好已在 480–880。窗口不够时压到 `frameWidth - 320`，画布至少留 320。
 * 量不到框架宽度时原样返回偏好。结果可以小于 480。
 */
export function applyPanelWidth(preferred: number, frameWidth: number): number {
  if (frameWidth <= 0) return preferred;
  return Math.min(preferred, Math.max(0, frameWidth - NODE_PANEL_CANVAS_MIN));
}
