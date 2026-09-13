import type { File, JSXOpeningElement, Node } from "@babel/types";
import { walk } from "./walk.js";

export interface LocatedElement {
  node: JSXOpeningElement;
  parents: readonly Node[];
  tag: string;
}

/** Finds the JSX opening element whose `<` sits at the given 1-based line/column. */
export function locateJsxElement(ast: File, line: number, column: number): LocatedElement | null {
  let found: LocatedElement | null = null;
  walk(ast.program, (node, parents) => {
    if (node.type !== "JSXOpeningElement" || !node.loc) return;
    if (node.loc.start.line === line && node.loc.start.column + 1 === column) {
      found = { node, parents: [...parents], tag: jsxName(node) };
      return false;
    }
  });
  return found;
}

export function jsxName(node: JSXOpeningElement): string {
  const name = node.name;
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  const parts: string[] = [];
  let current: typeof name.object | typeof name = name;
  while (current.type === "JSXMemberExpression") {
    parts.unshift(current.property.name);
    current = current.object;
  }
  parts.unshift(current.name);
  return parts.join(".");
}
