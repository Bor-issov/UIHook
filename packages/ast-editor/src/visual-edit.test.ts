import type { ObservedBox, VisualChange } from "@uihook/protocol";
import { describe, expect, it } from "vitest";
import { applyVisualEdit, inspectElement } from "./index.js";

const zero: ObservedBox = {
  paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
  marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
  rowGap: 0, columnGap: 0,
  borderTopLeftRadius: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderBottomLeftRadius: 0,
};
const pad = (t: number, r = t, b = t, l = r): ObservedBox => ({ ...zero, paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l });

/** Wraps a JSX opening tag in a component; the tag always starts at line 3, column 10. */
function file(tag: string, extra = "") {
  return `import { cn } from "./cn";\nexport function Card({ active, className }: any) {\n  return <${tag}>hello</div>;\n}\n${extra}`;
}

function edit(code: string, changes: VisualChange[], observed: ObservedBox, tag = "div") {
  return applyVisualEdit(code, { file: "src/Card.tsx", line: 3, column: 10, tag, changes, observed });
}

describe("applyVisualEdit: static className", () => {
  it("replaces p-6 with p-4 and preserves every other byte", () => {
    const code = file(`div className="flex p-6 gap-4"`);
    const out = edit(code, [{ property: "padding", px: 16 }], pad(24));
    expect(out.status).toBe("applied");
    if (out.status !== "applied") return;
    expect(out.code).toBe(code.replace("flex p-6 gap-4", "flex p-4 gap-4"));
    expect(out.applied[0]).toMatchObject({ removed: ["p-6"], added: "p-4", fromPx: [24, 24, 24, 24] });
  });

  it("collapses per-side padding into one utility when setting all sides", () => {
    const out = edit(file(`div className="px-6 py-4 text-sm"`), [{ property: "padding", px: 8 }], pad(16, 24));
    expect(out.status === "applied" && out.code).toContain(`className="p-2 text-sm"`);
  });

  it("keeps a lower-precedence shorthand when editing one axis", () => {
    const out = edit(file(`div className="p-6 rounded-xl"`), [{ property: "paddingX", px: 12 }], pad(24));
    expect(out.status === "applied" && out.code).toContain(`className="p-6 px-3 rounded-xl"`);
  });

  it("uses arbitrary values when the scale has no exact step", () => {
    const out = edit(file(`div className="p-6"`), [{ property: "padding", px: 13 }], pad(24));
    expect(out.status === "applied" && out.code).toContain(`className="p-[13px]"`);
  });

  it("edits gap and radius on the theme scale", () => {
    const observed = { ...zero, rowGap: 24, columnGap: 24, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderBottomRightRadius: 12, borderBottomLeftRadius: 12 };
    const out = edit(file(`div className="grid gap-6 rounded-xl"`), [{ property: "gap", px: 16 }, { property: "borderRadius", px: 8 }], observed);
    expect(out.status === "applied" && out.code).toContain(`className="grid gap-4 rounded-lg"`);
  });

  it("supports template literals without expressions and multi-line class strings", () => {
    const out = edit(file("div className={`\n    flex\n    p-6\n  `}"), [{ property: "padding", px: 16 }], pad(24));
    expect(out.status === "applied" && out.code).toContain("className={`\n    flex\n    p-4\n  `}");
  });

  it("adds a className attribute when none exists", () => {
    const out = edit(file(`div id="x"`), [{ property: "padding", px: 16 }], zero);
    expect(out.status === "applied" && out.code).toContain(`<div className="p-4" id="x">`);
  });

  it("reports unchanged when the value already matches", () => {
    expect(edit(file(`div className="p-4"`), [{ property: "padding", px: 16 }], pad(16)).status).toBe("unchanged");
  });

  it("applies sequential changes against the updated classes", () => {
    const out = edit(file(`div className="p-6"`), [{ property: "padding", px: 16 }, { property: "paddingY", px: 8 }], pad(24));
    expect(out.status === "applied" && out.code).toContain(`className="p-4 py-2"`);
  });

  it("respects Tailwind v3 scale gaps", () => {
    const code = file(`div className="p-6"`);
    const input = { file: "src/Card.tsx", line: 3, column: 10, tag: "div", changes: [{ property: "padding" as const, px: 52 }], observed: pad(24) };
    const v3 = applyVisualEdit(code, input, { tailwind: "v3", spacingUnitPx: 4, remPx: 16 });
    const v4 = applyVisualEdit(code, input, { tailwind: "v4", spacingUnitPx: 4, remPx: 16 });
    expect(v3.status === "applied" && v3.code).toContain(`p-[52px]`);
    expect(v4.status === "applied" && v4.code).toContain(`p-13`);
  });
});

describe("applyVisualEdit: class helpers", () => {
  it("edits an unconditional literal inside cn()", () => {
    const code = file(`div className={cn("flex p-6", active && "bg-card", className)}`);
    const out = edit(code, [{ property: "padding", px: 16 }], pad(24));
    expect(out.status === "applied" && out.code).toContain(`cn("flex p-4", active && "bg-card", className)`);
  });

  it("refuses when a conditional literal touches the same property", () => {
    const out = edit(file(`div className={cn("p-6", active && "p-8")}`), [{ property: "padding", px: 16 }], pad(24));
    expect(out).toMatchObject({ status: "unsupported" });
  });

  it("places the new token after kept shorthand tokens for twMerge ordering", () => {
    const out = edit(file(`div className={cn("pl-2", "p-6")}`), [{ property: "paddingX", px: 16 }], pad(24, 24, 24, 8));
    expect(out.status === "applied" && out.code).toContain(`cn("", "p-6 px-4")`);
  });
});

describe("applyVisualEdit: safe refusal", () => {
  const refuse = (tag: string, observed: ObservedBox, changes: VisualChange[] = [{ property: "padding", px: 16 }]) => {
    const out = edit(file(tag), changes, observed);
    expect(out.status, JSON.stringify(out)).toBe("unsupported");
    return out;
  };

  it("refuses responsive and state variants on the same property", () => {
    refuse(`div className="p-6 md:p-8"`, pad(24));
    refuse(`div className="p-6 hover:px-2"`, pad(24));
  });

  it("does not refuse variants on unrelated properties", () => {
    expect(edit(file(`div className="p-6 md:gap-8"`), [{ property: "padding", px: 16 }], pad(24)).status).toBe("applied");
  });

  it("refuses when computed styles disagree with source classes", () => {
    const out = refuse(`div className="p-6"`, pad(32));
    expect(out.status === "unsupported" && out.reason).toMatch(/computed paddingTop is 32px/);
  });

  it("refuses padding coming from outside the class list", () => {
    refuse(`div className="flex"`, pad(12));
  });

  it("refuses runtime-computed, spread-overridden and important classes", () => {
    refuse(`div className={styles.card}`, pad(24));
    refuse(`div className="p-6" {...props}`, pad(24));
    refuse(`div {...props}`, zero);
    refuse(`div className="!p-6"`, pad(24));
    refuse(`div className={\`p-\${size}\`}`, pad(24));
  });

  it("replaces single-side utilities covered by an axis change", () => {
    const out = edit(file(`div className="p-6 pt-2"`), [{ property: "paddingY", px: 16 }], pad(8, 24, 24, 24));
    expect(out.status === "applied" && out.code).toContain(`className="p-6 py-4"`);
  });

  it("refuses unresolvable values and logical radius utilities", () => {
    refuse(`div className="p-(--card-padding)"`, pad(24));
    refuse(`div className="rounded-s-lg"`, zero, [{ property: "borderRadius", px: 8 }]);
    refuse(`div className="mx-auto"`, zero, [{ property: "marginX", px: 8 }]);
  });

  it("returns not_found for stale locations or tag mismatches", () => {
    expect(edit(file(`div className="p-6"`), [{ property: "padding", px: 16 }], pad(24), "section").status).toBe("not_found");
    const out = applyVisualEdit(file(`div className="p-6"`), { file: "src/Card.tsx", line: 2, column: 1, tag: "div", changes: [{ property: "padding", px: 16 }], observed: pad(24) });
    expect(out.status).toBe("not_found");
  });
});

describe("inspectElement", () => {
  it("describes class site and element range", () => {
    const code = `export const A = () => (\n  <section className={cn("p-6", x && "hidden")}>\n    <p>hi</p>\n  </section>\n);\n`;
    const info = inspectElement(code, "src/A.tsx", 2, 3)!;
    expect(info).toMatchObject({ tag: "section", startLine: 2, endLine: 4, className: { kind: "call", classes: ["p-6", "hidden"] } });
    expect(info.editable).toContain("padding");
    expect(inspectElement(code, "src/A.tsx", 9, 9)).toBeNull();
  });
});
