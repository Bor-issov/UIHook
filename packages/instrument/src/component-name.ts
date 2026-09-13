import type { Node } from "@babel/types";

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9_$]*$/;

/**
 * Returns the name of the component that lexically encloses a JSX node, if one can be named
 * statically. Handles function declarations, `const X = () => ...`, `memo`/`forwardRef` wrappers
 * and class components.
 */
export function enclosingComponentName(parents: readonly Node[]): string | undefined {
  for (let i = parents.length - 1; i >= 0; i--) {
    const node = parents[i]!;
    switch (node.type) {
      case "FunctionDeclaration":
      case "ClassDeclaration":
        if (node.id && COMPONENT_NAME.test(node.id.name)) return node.id.name;
        break;
      case "VariableDeclarator":
        if (node.id.type === "Identifier" && COMPONENT_NAME.test(node.id.name)) return node.id.name;
        break;
      case "ExportDefaultDeclaration":
        return undefined;
    }
  }
  return undefined;
}
