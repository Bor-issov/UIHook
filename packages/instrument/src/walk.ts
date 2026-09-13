import type { Node } from "@babel/types";

type Visitor = (node: Node, parents: readonly Node[]) => void;

/** Minimal depth-first AST walk. Avoids pulling @babel/traverse into the dev server hot path. */
export function walk(root: Node, enter: Visitor, leave?: Visitor): void {
  const parents: Node[] = [];
  const visit = (node: Node) => {
    enter(node, parents);
    parents.push(node);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child);
      } else if (isNode(value)) {
        visit(value);
      }
    }
    parents.pop();
    leave?.(node, parents);
  };
  visit(root);
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}
