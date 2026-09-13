import type { ObservedBox, VisualChange, VisualProperty } from "@uihook/protocol";
import { analyzeClassName, type ClassSite } from "./class-site.js";
import { locateJsxElement } from "./locate.js";
import { parseSource, SourceParseError } from "./parse.js";
import { DEFAULT_EDITOR_CONFIG, type EditorConfig } from "./tailwind/families.js";
import { type MutableLiteral, mutateClasses } from "./tailwind/mutate.js";

export interface VisualEditInput {
  file: string;
  line: number;
  column: number;
  tag: string;
  changes: readonly VisualChange[];
  observed: ObservedBox;
}

export interface AppliedChange {
  property: VisualProperty;
  fromPx: number[];
  toPx: number;
  removed: string[];
  added: string;
}

export type VisualEditOutcome =
  | { status: "applied"; code: string; applied: AppliedChange[]; classesBefore: string[]; classesAfter: string[] }
  | { status: "unchanged" }
  | { status: "unsupported"; reason: string }
  | { status: "not_found"; reason: string };

export const ALL_VISUAL_PROPERTIES: readonly VisualProperty[] = [
  "padding", "paddingX", "paddingY", "margin", "marginX", "marginY", "gap", "gapX", "gapY", "borderRadius",
];

/**
 * Applies deterministic Tailwind edits to the JSX element at a source location.
 * Only the class string contents change; everything else in the file is preserved byte for byte.
 */
export function applyVisualEdit(code: string, input: VisualEditInput, config: EditorConfig = DEFAULT_EDITOR_CONFIG): VisualEditOutcome {
  let ast;
  try {
    ast = parseSource(code, input.file);
  } catch (error) {
    if (error instanceof SourceParseError) return { status: "unsupported", reason: error.message };
    throw error;
  }

  const located = locateJsxElement(ast, input.line, input.column);
  if (!located) return { status: "not_found", reason: `no JSX element at ${input.file}:${input.line}:${input.column}` };
  if (located.tag !== input.tag) {
    return { status: "not_found", reason: `expected <${input.tag}> at ${input.file}:${input.line}:${input.column}, found <${located.tag}>` };
  }

  const site = analyzeClassName(located.node, code);
  if (site.kind === "dynamic") return { status: "unsupported", reason: site.reason };
  if (site.kind === "absent" && site.insertAt === null) return { status: "unsupported", reason: site.reason ?? "cannot add className" };

  const original: MutableLiteral[] = site.kind === "absent" ? [{ value: "", conditional: false }] : site.literals.map((l) => ({ value: l.value, conditional: l.conditional }));
  let literals = original;
  let observed = { ...input.observed };
  const applied: AppliedChange[] = [];

  for (const change of input.changes) {
    const outcome = mutateClasses(literals, change, observed, config);
    if (outcome.status === "unsupported") return outcome;
    if (outcome.status === "unchanged") continue;
    literals = outcome.literals;
    observed = withTargetApplied(observed, change);
    applied.push({ property: change.property, fromPx: outcome.fromPx, toPx: change.px, removed: outcome.removed, added: outcome.added });
  }

  if (applied.length === 0) return { status: "unchanged" };

  const next = writeLiterals(code, site, literals);
  // Defensive re-parse: a deterministic edit must never leave the file unparsable or move the element.
  const check = parseSource(next, input.file);
  if (!locateJsxElement(check, input.line, input.column)) {
    return { status: "unsupported", reason: "edit verification failed: element moved" };
  }

  return {
    status: "applied",
    code: next,
    applied,
    classesBefore: original.flatMap((l) => l.value.split(/\s+/).filter(Boolean)),
    classesAfter: literals.flatMap((l) => l.value.split(/\s+/).filter(Boolean)),
  };
}

function writeLiterals(code: string, site: Exclude<ClassSite, { kind: "dynamic" }>, literals: MutableLiteral[]): string {
  if (site.kind === "absent") {
    return `${code.slice(0, site.insertAt!)} className="${literals[0]!.value.trim()}"${code.slice(site.insertAt!)}`;
  }
  let out = code;
  const ordered = site.literals.map((l, i) => ({ l, value: literals[i]!.value })).sort((a, b) => b.l.start - a.l.start);
  for (const { l, value } of ordered) out = out.slice(0, l.start) + value + out.slice(l.end);
  return out;
}

function withTargetApplied(observed: ObservedBox, change: VisualChange): ObservedBox {
  const next = { ...observed };
  const set = (keys: (keyof ObservedBox)[]) => keys.forEach((k) => (next[k] = change.px));
  switch (change.property) {
    case "padding": set(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]); break;
    case "paddingX": set(["paddingLeft", "paddingRight"]); break;
    case "paddingY": set(["paddingTop", "paddingBottom"]); break;
    case "margin": set(["marginTop", "marginRight", "marginBottom", "marginLeft"]); break;
    case "marginX": set(["marginLeft", "marginRight"]); break;
    case "marginY": set(["marginTop", "marginBottom"]); break;
    case "gap": set(["rowGap", "columnGap"]); break;
    case "gapX": set(["columnGap"]); break;
    case "gapY": set(["rowGap"]); break;
    case "borderRadius": set(["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"]); break;
  }
  return next;
}
