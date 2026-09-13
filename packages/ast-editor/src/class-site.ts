import type { Expression, JSXOpeningElement, Node } from "@babel/types";

/** A string literal holding class tokens. `start`/`end` delimit the literal's inner content. */
export interface ClassLiteral {
  start: number;
  end: number;
  value: string;
  /** True when the literal only applies under a runtime condition (`active && "..."`). */
  conditional: boolean;
}

export type ClassSite =
  | { kind: "static"; literals: [ClassLiteral] }
  | { kind: "call"; callee: string; literals: ClassLiteral[] }
  | { kind: "absent"; insertAt: number | null; reason?: string }
  | { kind: "dynamic"; reason: string };

/** Class-merging helpers whose string arguments are safe to edit in place. */
const CLASS_HELPERS = new Set(["cn", "clsx", "classNames", "classnames", "cx", "twMerge", "twJoin"]);

export function analyzeClassName(element: JSXOpeningElement, code: string): ClassSite {
  const attrs = element.attributes;
  const index = attrs.findIndex(
    (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && (a.name.name === "className" || a.name.name === "class"),
  );

  if (index === -1) {
    if (attrs.some((a) => a.type === "JSXSpreadAttribute")) {
      return { kind: "absent", insertAt: null, reason: "element spreads props; an added className could be overridden" };
    }
    return { kind: "absent", insertAt: element.name.end ?? null };
  }

  const spreadAfter = attrs.slice(index + 1).some((a) => a.type === "JSXSpreadAttribute");
  if (spreadAfter) return { kind: "dynamic", reason: "props spread after className may override it" };

  const attr = attrs[index]!;
  if (attr.type !== "JSXAttribute" || !attr.value) return { kind: "dynamic", reason: "className has no value" };

  const value = attr.value;
  if (value.type === "StringLiteral") return { kind: "static", literals: [literal(value, code, false)] };
  if (value.type !== "JSXExpressionContainer" || value.expression.type === "JSXEmptyExpression") {
    return { kind: "dynamic", reason: "unsupported className value" };
  }

  const expr = value.expression;
  const simple = staticString(expr, code);
  if (simple) return { kind: "static", literals: [simple] };

  if (expr.type === "CallExpression" && expr.callee.type === "Identifier" && CLASS_HELPERS.has(expr.callee.name)) {
    const literals: ClassLiteral[] = [];
    for (const arg of expr.arguments) {
      const collected = collectArgument(arg, code, false);
      if (collected === null) return { kind: "dynamic", reason: `unsupported ${expr.callee.name}() argument` };
      literals.push(...collected);
    }
    return { kind: "call", callee: expr.callee.name, literals };
  }

  return { kind: "dynamic", reason: "className is computed at runtime" };
}

/**
 * Collects string literals from a class helper argument. Opaque expressions (identifiers such as a
 * forwarded `className` prop) contribute no literals and are accepted; the browser's computed styles
 * are used later to verify that source classes are actually in effect.
 */
function collectArgument(node: Node, code: string, conditional: boolean): ClassLiteral[] | null {
  const simple = staticString(node, code, conditional);
  if (simple) return [simple];
  switch (node.type) {
    case "Identifier":
    case "MemberExpression":
    case "OptionalMemberExpression":
    case "BooleanLiteral":
    case "NullLiteral":
    case "NumericLiteral":
      return [];
    case "LogicalExpression":
      return concat(collectArgument(node.left, code, true), collectArgument(node.right, code, true));
    case "ConditionalExpression":
      return concat(collectArgument(node.consequent, code, true), collectArgument(node.alternate, code, true));
    default:
      if (isOpaqueCondition(node)) return [];
      return null;
  }
}

function isOpaqueCondition(node: Node): boolean {
  return node.type === "UnaryExpression" || node.type === "BinaryExpression" || node.type === "CallExpression";
}

function concat(a: ClassLiteral[] | null, b: ClassLiteral[] | null): ClassLiteral[] | null {
  return a && b ? [...a, ...b] : null;
}

function staticString(node: Node | Expression, code: string, conditional = false): ClassLiteral | null {
  if (node.type === "StringLiteral") return literal(node, code, conditional);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return literal(node, code, conditional);
  return null;
}

function literal(node: Node, code: string, conditional: boolean): ClassLiteral {
  // Inner content sits between the opening and closing quote/backtick.
  const start = node.start! + 1;
  const end = node.end! - 1;
  return { start, end, value: code.slice(start, end), conditional };
}
