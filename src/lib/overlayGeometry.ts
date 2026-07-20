export interface RectEdges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PhysicalWindowFrame {
  clientOffsetX: number;
  clientOffsetY: number;
  outerWidth: number;
  outerHeight: number;
}

/** Convert a measured CSS-pixel content rectangle into inward physical insets. */
export function computePhysicalInsets(
  rect: RectEdges,
  viewport: ViewportSize,
  dpr: number,
  frame?: PhysicalWindowFrame,
): [number, number, number, number] {
  if (!Number.isFinite(dpr) || dpr <= 0) {
    throw new Error("devicePixelRatio must be positive");
  }

  const clientOffsetX = frame?.clientOffsetX ?? 0;
  const clientOffsetY = frame?.clientOffsetY ?? 0;
  const outerWidth = frame?.outerWidth ?? viewport.width * dpr;
  const outerHeight = frame?.outerHeight ?? viewport.height * dpr;

  return [
    Math.ceil(clientOffsetX + rect.left * dpr),
    Math.ceil(clientOffsetY + rect.top * dpr),
    Math.floor(outerWidth - clientOffsetX - rect.right * dpr),
    Math.floor(outerHeight - clientOffsetY - rect.bottom * dpr),
  ];
}
