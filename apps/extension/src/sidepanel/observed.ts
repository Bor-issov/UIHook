import type { ComputedStyleSnapshot, ObservedBox } from "@uihook/protocol";

const KEYS = [
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "rowGap", "columnGap",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
] as const satisfies readonly (keyof ObservedBox)[];

/** Converts computed style strings to px numbers. Unparseable values become -1 so verification fails safely. */
export function toObservedBox(styles: ComputedStyleSnapshot): ObservedBox {
  const box = {} as ObservedBox;
  for (const key of KEYS) box[key] = px(styles[key]);
  return box;
}

export function px(value: string | undefined): number {
  if (value === undefined) return -1;
  if (value === "normal") return 0;
  if (!/^-?\d*\.?\d+px$/.test(value)) return -1;
  return Number.parseFloat(value);
}
