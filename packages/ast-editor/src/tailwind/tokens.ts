export interface ClassToken {
  raw: string;
  variants: string[];
  important: boolean;
  negative: boolean;
  /** Utility without variants, `!` or leading `-`, e.g. `px-4`. */
  utility: string;
}

/** Splits a Tailwind class into variants and utility, respecting `[...]` and `(...)` groups. */
export function parseClassToken(raw: string): ClassToken {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of raw) {
    if (char === "[" || char === "(") depth++;
    else if ((char === "]" || char === ")") && depth > 0) depth--;
    if (char === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  let utility = current;
  let important = false;
  if (utility.startsWith("!")) {
    important = true;
    utility = utility.slice(1);
  } else if (utility.endsWith("!")) {
    important = true;
    utility = utility.slice(0, -1);
  }
  const negative = utility.startsWith("-");
  if (negative) utility = utility.slice(1);
  return { raw, variants: parts, important, negative, utility };
}

export interface ClassSlot {
  /** Index in the owning literal's token list. */
  tokenIndex: number;
  token: ClassToken;
}

/** Tokenizes a class string into alternating whitespace and class segments so edits keep formatting. */
export function splitClassString(value: string): string[] {
  return value.split(/(\s+)/);
}

export function isClassSegment(segment: string): boolean {
  return segment.length > 0 && !/^\s+$/.test(segment);
}
