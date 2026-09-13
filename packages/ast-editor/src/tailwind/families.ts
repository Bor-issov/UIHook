import type { ObservedBox, VisualProperty } from "@uihook/protocol";

export type TailwindVersion = "v3" | "v4";

export interface EditorConfig {
  tailwind: TailwindVersion;
  /** px per spacing step (`p-1`). 4 unless the project customises `--spacing`. */
  spacingUnitPx: number;
  remPx: number;
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = { tailwind: "v4", spacingUnitPx: 4, remPx: 16 };

export interface FamilyRoot {
  root: string;
  /** Box slots this utility sets. */
  slots: readonly string[];
  /** CSS emission order within the family: higher wins when slots overlap. */
  order: number;
}

export interface Family {
  id: "padding" | "margin" | "gap" | "radius";
  slots: readonly string[];
  roots: readonly FamilyRoot[];
  allowNegative: boolean;
  observedKey: (slot: string) => keyof ObservedBox;
  /** Resolves a utility value (the part after `root-`, or "" for bare roots) to px, or null if unknown. */
  resolve: (value: string, config: EditorConfig) => number | null;
  /** Formats px as a utility value; `""` means the bare root. Null if not expressible. */
  format: (px: number, config: EditorConfig) => string | null;
}

const SIDES = ["top", "right", "bottom", "left"] as const;

/** Tailwind v3 default spacing keys. v4 accepts any multiple of 0.25 instead. */
const V3_SPACING = new Set([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]);

function resolveArbitraryLength(value: string, config: EditorConfig): number | null {
  const match = /^\[(\d*\.?\d+)(px|rem)\]$/.exec(value);
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] === "rem" ? n * config.remPx : n;
}

function formatArbitrary(px: number): string {
  return `[${Number(px.toFixed(2))}px]`;
}

function resolveSpacing(value: string, config: EditorConfig): number | null {
  if (value === "px") return 1;
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    if (config.tailwind === "v3" && !V3_SPACING.has(n)) return null;
    if (config.tailwind === "v4" && (n * 4) % 1 !== 0) return null;
    return n * config.spacingUnitPx;
  }
  return resolveArbitraryLength(value, config);
}

function formatSpacing(px: number, config: EditorConfig): string {
  if (px === 1 && config.spacingUnitPx !== 1) return "px";
  const n = px / config.spacingUnitPx;
  const clean = Number.isFinite(n) && (n * 2) % 1 === 0;
  if (clean && (config.tailwind === "v4" || V3_SPACING.has(n))) return String(n);
  return formatArbitrary(px);
}

const RADIUS_SCALE: Record<TailwindVersion, ReadonlyArray<readonly [string, number]>> = {
  v4: [["none", 0], ["xs", 2], ["sm", 4], ["", 4], ["md", 6], ["lg", 8], ["xl", 12], ["2xl", 16], ["3xl", 24], ["4xl", 32]],
  v3: [["none", 0], ["sm", 2], ["", 4], ["md", 6], ["lg", 8], ["xl", 12], ["2xl", 16], ["3xl", 24]],
};

function spacingFamily(id: "padding" | "margin", prefix: "p" | "m"): Family {
  const cap = id === "padding" ? "padding" : "margin";
  return {
    id,
    slots: SIDES,
    allowNegative: id === "margin",
    observedKey: (slot) => `${cap}${slot[0]!.toUpperCase()}${slot.slice(1)}` as keyof ObservedBox,
    roots: [
      { root: prefix, slots: SIDES, order: 0 },
      { root: `${prefix}x`, slots: ["left", "right"], order: 1 },
      { root: `${prefix}y`, slots: ["top", "bottom"], order: 2 },
      { root: `${prefix}s`, slots: ["left"], order: 3 },
      { root: `${prefix}e`, slots: ["right"], order: 4 },
      { root: `${prefix}t`, slots: ["top"], order: 5 },
      { root: `${prefix}r`, slots: ["right"], order: 6 },
      { root: `${prefix}b`, slots: ["bottom"], order: 7 },
      { root: `${prefix}l`, slots: ["left"], order: 8 },
    ],
    resolve: resolveSpacing,
    format: formatSpacing,
  };
}

export const FAMILIES: Record<Family["id"], Family> = {
  padding: spacingFamily("padding", "p"),
  margin: spacingFamily("margin", "m"),
  gap: {
    id: "gap",
    slots: ["row", "column"],
    allowNegative: false,
    observedKey: (slot) => (slot === "row" ? "rowGap" : "columnGap"),
    roots: [
      { root: "gap", slots: ["row", "column"], order: 0 },
      { root: "gap-x", slots: ["column"], order: 1 },
      { root: "gap-y", slots: ["row"], order: 2 },
    ],
    resolve: resolveSpacing,
    format: formatSpacing,
  },
  radius: {
    id: "radius",
    slots: ["tl", "tr", "br", "bl"],
    allowNegative: false,
    observedKey: (slot) =>
      (({ tl: "borderTopLeftRadius", tr: "borderTopRightRadius", br: "borderBottomRightRadius", bl: "borderBottomLeftRadius" }) as const)[
        slot as "tl"
      ],
    roots: [
      { root: "rounded", slots: ["tl", "tr", "br", "bl"], order: 0 },
      { root: "rounded-t", slots: ["tl", "tr"], order: 1 },
      { root: "rounded-r", slots: ["tr", "br"], order: 2 },
      { root: "rounded-b", slots: ["br", "bl"], order: 3 },
      { root: "rounded-l", slots: ["tl", "bl"], order: 4 },
      { root: "rounded-tl", slots: ["tl"], order: 5 },
      { root: "rounded-tr", slots: ["tr"], order: 6 },
      { root: "rounded-br", slots: ["br"], order: 7 },
      { root: "rounded-bl", slots: ["bl"], order: 8 },
    ],
    resolve: (value, config) => {
      const named = RADIUS_SCALE[config.tailwind].find(([key]) => key === value);
      return named ? named[1] : resolveArbitraryLength(value, config);
    },
    format: (px, config) => {
      const named = RADIUS_SCALE[config.tailwind].find(([, size]) => size === px);
      return named ? named[0] : formatArbitrary(px);
    },
  },
};

/** Logical radius utilities we cannot map to physical corners without knowing writing direction. */
export const UNSUPPORTED_ROOTS: Record<Family["id"], readonly string[]> = {
  padding: [],
  margin: [],
  gap: [],
  radius: ["rounded-s", "rounded-e", "rounded-ss", "rounded-se", "rounded-es", "rounded-ee"],
};

export interface PropertyTarget {
  family: Family;
  root: FamilyRoot;
}

export function propertyTarget(property: VisualProperty): PropertyTarget {
  const pick = (family: Family, root: string): PropertyTarget => ({ family, root: family.roots.find((r) => r.root === root)! });
  switch (property) {
    case "padding": return pick(FAMILIES.padding, "p");
    case "paddingX": return pick(FAMILIES.padding, "px");
    case "paddingY": return pick(FAMILIES.padding, "py");
    case "margin": return pick(FAMILIES.margin, "m");
    case "marginX": return pick(FAMILIES.margin, "mx");
    case "marginY": return pick(FAMILIES.margin, "my");
    case "gap": return pick(FAMILIES.gap, "gap");
    case "gapX": return pick(FAMILIES.gap, "gap-x");
    case "gapY": return pick(FAMILIES.gap, "gap-y");
    case "borderRadius": return pick(FAMILIES.radius, "rounded");
  }
}

/** Matches a utility against a family, longest root first. Returns the root and value, or null. */
export function matchFamily(
  utility: string,
  family: Family,
): { root: FamilyRoot; value: string } | { unsupported: string } | null {
  for (const root of UNSUPPORTED_ROOTS[family.id]) {
    if (utility === root || utility.startsWith(`${root}-`)) return { unsupported: root };
  }
  const roots = [...family.roots].sort((a, b) => b.root.length - a.root.length);
  for (const root of roots) {
    if (utility === root.root) return { root, value: "" };
    if (utility.startsWith(`${root.root}-`)) return { root, value: utility.slice(root.root.length + 1) };
  }
  return null;
}
