export interface PresentationDesign {
  background?: string;
  textColor?: string;
  accentColor?: string;
  fontFamily?: "Arial" | "Aptos" | "Georgia" | "Verdana";
  titleSize?: number;
  textScale?: number;
  titleBold?: boolean;
  alignment?: "left" | "center" | "right";
}

export function normalizePresentationDesign(value: PresentationDesign | undefined): PresentationDesign | undefined {
  if (!value) return undefined;
  const result: PresentationDesign = {};
  for (const key of ["background", "textColor", "accentColor"] as const) {
    if (/^#[0-9a-f]{6}$/i.test(value[key] || "")) result[key] = value[key];
  }
  if (["Arial", "Aptos", "Georgia", "Verdana"].includes(value.fontFamily || "")) result.fontFamily = value.fontFamily;
  if (["left", "center", "right"].includes(value.alignment || "")) result.alignment = value.alignment;
  if (Number.isFinite(value.titleSize)) result.titleSize = Math.min(68, Math.max(24, value.titleSize!));
  if (Number.isFinite(value.textScale)) result.textScale = Math.min(1.4, Math.max(0.75, value.textScale!));
  if (typeof value.titleBold === "boolean") result.titleBold = value.titleBold;
  return Object.keys(result).length ? result : undefined;
}
