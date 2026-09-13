import type { Node } from "@babel/types";

/** Depth-first walk; return `false` from the visitor to stop the whole traversal. */
export function walk(root: Node, enter: (node: Node, parents: readonly Node[]) => boolean | void): void {
  const parents: Node[] = [];
  let stopped = false;
  const visit = (node: Node) => {
    if (stopped) return;
    if (enter(node, parents) === false) {
      stopped = true;
      return;
    }
    parents.push(node);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key.endsWith("Comments")) continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child);
      } else if (isNode(value)) {
        visit(value);
      }
    }
    parents.pop();
  };
  visit(root);
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}
