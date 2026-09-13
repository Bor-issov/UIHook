import { describe, expect, it } from "vitest";
import { decodeSource, instrumentJsx } from "./index.js";

const src = `import { Card } from "./Card";

export function BudgetCard({ title }: { title: string }) {
  return (
    <div className="p-6 gap-4">
      <Card title={title} />
      <>
        <span>{title as string}</span>
      </>
    </div>
  );
}

const Row = () => <li data-x="1">row</li>;
`;

describe("instrumentJsx", () => {
  const result = instrumentJsx(src, { file: "src/BudgetCard.tsx" })!;

  it("injects source and component metadata on host elements only", () => {
    expect(result.count).toBe(3);
    expect(result.code).toContain(`<div data-uihook-src="src/BudgetCard.tsx:5:5" data-uihook-component="BudgetCard" className="p-6 gap-4">`);
    expect(result.code).toContain(`<span data-uihook-src="src/BudgetCard.tsx:8:9" data-uihook-component="BudgetCard">`);
    expect(result.code).toContain(`<li data-uihook-src="src/BudgetCard.tsx:14:19" data-uihook-component="Row" data-x="1">`);
    expect(result.code).toContain(`<Card title={title} />`);
  });

  it("points line/column at the original `<` of the opening tag", () => {
    const lines = src.split("\n");
    for (const m of result.code.matchAll(/data-uihook-src="([^"]+)"/g)) {
      const loc = decodeSource(m[1]!)!;
      expect(lines[loc.line - 1]!.slice(loc.column - 1)).toMatch(/^<[a-z]/);
    }
  });

  it("is idempotent and skips unparsable or JSX-free input", () => {
    expect(instrumentJsx(result.code, { file: "src/BudgetCard.tsx" })).toBeNull();
    expect(instrumentJsx("const a = 1;", { file: "a.tsx" })).toBeNull();
    expect(instrumentJsx("<div", { file: "a.tsx" })).toBeNull();
  });

  it("escapes attribute-breaking characters in file paths", () => {
    const out = instrumentJsx(`const A = () => <p/>;`, { file: `src/we"ird&.tsx` })!;
    expect(out.code).toContain(`data-uihook-src="src/we&quot;ird&amp;.tsx:1:17"`);
  });

  it("decodes paths containing colons", () => {
    expect(decodeSource("a:b/c.tsx:3:4")).toEqual({ file: "a:b/c.tsx", line: 3, column: 4 });
    expect(decodeSource("nope")).toBeNull();
    expect(decodeSource("x.tsx:0:1")).toBeNull();
  });
});
