import type { ObservedBox, VisualChange } from "@uihook/protocol";
import { type EditorConfig, type Family, type FamilyRoot, matchFamily, propertyTarget } from "./families.js";
import { type ClassToken, isClassSegment, parseClassToken, splitClassString } from "./tokens.js";

/** In-memory view of a class literal. `conditional` literals are never edited. */
export interface MutableLiteral {
  value: string;
  conditional: boolean;
}

export type MutationOutcome =
  | { status: "applied"; literals: MutableLiteral[]; removed: string[]; added: string; fromPx: number[] }
  | { status: "unchanged" }
  | { status: "unsupported"; reason: string };

interface FamilyToken {
  literal: number;
  segment: number;
  token: ClassToken;
  root: FamilyRoot;
  value: string;
  conditional: boolean;
}

const SAFE_TOKEN = /^[a-z0-9\-[\].]+$/;
const TOLERANCE_PX = 0.5;

const unsupported = (reason: string): MutationOutcome => ({ status: "unsupported", reason });

/**
 * Plans a single Tailwind class change. The plan is conservative: whenever the classes in source
 * cannot be shown to produce the value the browser observed, it refuses instead of guessing.
 */
export function mutateClasses(
  input: readonly MutableLiteral[],
  change: VisualChange,
  observed: ObservedBox,
  config: EditorConfig,
): MutationOutcome {
  const { family, root: targetRoot } = propertyTarget(change.property);
  const targetSlots = new Set(targetRoot.slots);
  const segments = input.map((l) => splitClassString(l.value));

  // 1. Collect family tokens and reject ambiguous ones that touch the target slots.
  const tokens: FamilyToken[] = [];
  for (let li = 0; li < segments.length; li++) {
    const segs = segments[li]!;
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si]!;
      if (!isClassSegment(seg)) continue;
      const token = parseClassToken(seg);
      const match = matchFamily(token.utility, family);
      if (!match) continue;
      if ("unsupported" in match) return unsupported(`\`${seg}\` uses a logical ${family.id} utility that cannot be edited deterministically`);
      tokens.push({ literal: li, segment: si, token, root: match.root, value: match.value, conditional: input[li]!.conditional });
    }
  }

  const overlapping = tokens.filter((t) => t.root.slots.some((s) => targetSlots.has(s)));
  const resolved = new Map<FamilyToken, number>();
  for (const t of overlapping) {
    if (t.token.variants.length > 0) return unsupported(`\`${t.token.raw}\` applies a ${t.token.variants.join(":")} variant to the same property`);
    if (t.conditional) return unsupported(`\`${t.token.raw}\` is applied conditionally`);
    if (t.token.important) return unsupported(`\`${t.token.raw}\` uses !important`);
    if (t.token.negative && !family.allowNegative) return unsupported(`\`${t.token.raw}\` is not a valid ${family.id} utility`);
    const px = family.resolve(t.value, config);
    if (px === null) return unsupported(`cannot resolve \`${t.token.raw}\` to a pixel value`);
    resolved.set(t, t.token.negative ? -px : px);
  }

  // 2. Work out what the source classes produce for each target slot and verify against the browser.
  const fromPx: number[] = [];
  for (const slot of targetSlots) {
    const covering = overlapping.filter((t) => t.root.slots.includes(slot));
    const maxOrder = Math.max(-1, ...covering.map((t) => t.root.order));
    const winners = covering.filter((t) => t.root.order === maxOrder);
    const values = new Set(winners.map((t) => resolved.get(t)!));
    if (values.size > 1) return unsupported(`conflicting classes ${winners.map((w) => `\`${w.token.raw}\``).join(", ")}`);
    const expected = winners.length ? resolved.get(winners[0]!)! : 0;
    const key = family.observedKey(slot);
    const actual = observed[key];
    if (Math.abs(actual - expected) > TOLERANCE_PX) {
      return unsupported(
        `computed ${key} is ${actual}px but the element's source classes produce ${expected}px; the value is likely set by a variant, stylesheet, or a className passed from a parent`,
      );
    }
    fromPx.push(expected);
  }

  if (fromPx.every((px) => Math.abs(px - change.px) < 0.01)) {
    return { status: "unchanged" };
  }

  // 3. Decide which tokens the new utility replaces and which must stay.
  const subset = (root: FamilyRoot) => root.slots.every((s) => targetSlots.has(s));
  const removed = overlapping.filter((t) => subset(t.root));
  const keptPartial = overlapping.filter((t) => !subset(t.root));
  const blocking = keptPartial.find((t) => t.root.order > targetRoot.order);
  if (blocking) return unsupported(`\`${blocking.token.raw}\` would override the new ${change.property} value`);

  const value = family.format(change.px, config);
  if (value === null) return unsupported(`${change.px}px cannot be expressed as a ${family.id} utility`);
  const added = value === "" ? targetRoot.root : `${targetRoot.root}-${value}`;
  if (!SAFE_TOKEN.test(added)) return unsupported(`generated class \`${added}\` failed validation`);

  // 4. Place the new token after every kept partial token so class-merging helpers keep it.
  const position = (t: { literal: number; segment: number }) => t.literal * 1_000_000 + t.segment;
  const lastKept = keptPartial.reduce((max, t) => Math.max(max, position(t)), -1);
  const anchor = removed.find((t) => position(t) > lastKept);

  const next = segments.map((s) => [...s]);
  const toDelete = new Set(removed.filter((t) => t !== anchor).map((t) => position(t)));

  if (anchor) {
    next[anchor.literal]![anchor.segment] = added;
  } else if (lastKept >= 0) {
    const after = keptPartial.find((t) => position(t) === lastKept)!;
    next[after.literal]![after.segment] += ` ${added}`;
  } else {
    const target = lastIndexWhere(input, (l) => !l.conditional);
    if (target === -1) return unsupported("no unconditional class string to extend");
    const segs = next[target]!;
    const trailing = segs.length > 0 && /^\s+$/.test(segs[segs.length - 1]!) ? segs.pop()! : "";
    const hasClasses = segs.some(isClassSegment);
    segs.push(hasClasses ? ` ${added}` : added);
    if (trailing) segs.push(trailing);
  }

  const literals = next.map((segs, li) => ({
    value: joinWithout(segs, (si) => toDelete.has(li * 1_000_000 + si)),
    conditional: input[li]!.conditional,
  }));

  return { status: "applied", literals, removed: removed.map((t) => t.token.raw), added, fromPx };
}

/** Joins segments, dropping deleted classes together with one adjacent run of whitespace. */
function joinWithout(segs: string[], deleted: (index: number) => boolean): string {
  const out = [...segs];
  for (let i = 0; i < out.length; i++) {
    if (!deleted(i)) continue;
    out[i] = "";
    if (i > 0 && /^\s+$/.test(out[i - 1] ?? "")) out[i - 1] = "";
    else if (i + 1 < out.length && /^\s+$/.test(out[i + 1] ?? "")) out[i + 1] = "";
  }
  return out.join("");
}

function lastIndexWhere<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i]!)) return i;
  return -1;
}

export type { Family };
