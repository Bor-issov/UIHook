import { parse } from "@babel/parser";
import type { JSXOpeningElement } from "@babel/types";
import MagicString from "magic-string";
import { COMPONENT_ATTR, encodeSource, SOURCE_ATTR } from "./attributes.js";
import { enclosingComponentName } from "./component-name.js";
import { walk } from "./walk.js";

export interface InstrumentOptions {
  /** Project-relative POSIX path written into the DOM. Never pass absolute paths. */
  file: string;
  /** Whether to parse TypeScript syntax. Defaults to true for .ts/.tsx files. */
  typescript?: boolean;
}

export interface InstrumentResult {
  code: string;
  map: ReturnType<MagicString["generateMap"]>;
  count: number;
}

/**
 * Injects `data-uihook-src="file:line:column"` into every host (lowercase) JSX element.
 * Positions refer to the original source, so the AST editor can locate the same node later.
 * Component elements are skipped: they do not reliably forward unknown props to the DOM.
 */
export function instrumentJsx(code: string, options: InstrumentOptions): InstrumentResult | null {
  if (!code.includes("<")) return null;
  const typescript = options.typescript ?? /\.[cm]?tsx?$/.test(options.file);

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: typescript ? ["jsx", "typescript"] : ["jsx"],
    });
  } catch {
    // Leave unparsable files to the framework compiler, which reports errors properly.
    return null;
  }

  const s = new MagicString(code);
  const fileAttr = escapeJsxAttribute(options.file);
  let count = 0;

  walk(ast.program, (node, parents) => {
    if (node.type !== "JSXOpeningElement") return;
    if (!isHostElement(node) || hasAttribute(node, SOURCE_ATTR) || !node.loc || node.name.end == null) return;

    const src = encodeSource({ file: fileAttr, line: node.loc.start.line, column: node.loc.start.column + 1 });
    const component = enclosingComponentName(parents);
    let injected = ` ${SOURCE_ATTR}="${src}"`;
    if (component) injected += ` ${COMPONENT_ATTR}="${component}"`;
    s.appendLeft(node.name.end, injected);
    count++;
  });

  if (count === 0) return null;
  return { code: s.toString(), map: s.generateMap({ hires: "boundary", source: options.file, includeContent: true }), count };
}

function isHostElement(node: JSXOpeningElement): boolean {
  return node.name.type === "JSXIdentifier" && /^[a-z]/.test(node.name.name);
}

function hasAttribute(node: JSXOpeningElement, name: string): boolean {
  return node.attributes.some((a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === name);
}

function escapeJsxAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
