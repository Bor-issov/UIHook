import type { ClassNameKind, VisualProperty } from "@uihook/protocol";
import { analyzeClassName } from "./class-site.js";
import { locateJsxElement } from "./locate.js";
import { parseSource } from "./parse.js";
import { ALL_VISUAL_PROPERTIES } from "./visual-edit.js";

export interface ElementInspection {
  tag: string;
  openingTag: string;
  /** 1-based line range of the full JSX element. */
  startLine: number;
  endLine: number;
  className: { kind: ClassNameKind; classes: string[]; limitation?: string };
  editable: VisualProperty[];
}

/** Read-only view of the JSX element at a location, used to build side panel and agent context. */
export function inspectElement(code: string, file: string, line: number, column: number): ElementInspection | null {
  const ast = parseSource(code, file);
  const located = locateJsxElement(ast, line, column);
  if (!located) return null;

  const { node, parents } = located;
  const element = parents[parents.length - 1];
  const site = analyzeClassName(node, code);
  const classes = site.kind === "static" || site.kind === "call" ? site.literals.flatMap((l) => l.value.split(/\s+/).filter(Boolean)) : [];
  const limitation = site.kind === "dynamic" ? site.reason : site.kind === "absent" ? site.reason : undefined;
  const editable = site.kind === "dynamic" || (site.kind === "absent" && site.insertAt === null) ? [] : [...ALL_VISUAL_PROPERTIES];

  return {
    tag: located.tag,
    openingTag: code.slice(node.start!, node.end!),
    startLine: node.loc!.start.line,
    endLine: element?.type === "JSXElement" ? element.loc!.end.line : node.loc!.end.line,
    className: { kind: site.kind, classes, ...(limitation ? { limitation } : {}) },
    editable,
  };
}
