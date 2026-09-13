import { describe, expect, it } from "vitest";
import { isValidExtensionOrigin, parseClientMessage, parseServerMessage, RelativePath } from "./index.js";

const selection = {
  source: { file: "src/App.tsx", line: 12, column: 5 },
  element: { tag: "div", classes: ["p-6"] },
  rect: { x: 0, y: 0, width: 100, height: 50 },
  styles: { paddingTop: "24px" },
  instanceCount: 1,
  ancestors: [],
  pageUrl: "http://localhost:5173/",
};

describe("protocol validation", () => {
  it("accepts a well-formed context request", () => {
    const raw = JSON.stringify({ v: 1, id: "a1", type: "element.context.request", payload: { selection } });
    expect(parseClientMessage(raw).ok).toBe(true);
  });

  it("rejects unknown message types", () => {
    const raw = JSON.stringify({ v: 1, id: "a1", type: "shell.exec", payload: { cmd: "rm -rf /" } });
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it("rejects wrong protocol version and invalid JSON", () => {
    expect(parseClientMessage(JSON.stringify({ v: 2, id: "a", type: "history.list", payload: {} })).ok).toBe(false);
    expect(parseClientMessage("{nope").ok).toBe(false);
  });

  it("rejects absolute and traversing source paths", () => {
    for (const file of ["/etc/passwd", "../secret.ts", "src/../../x.ts", "C:\\x.ts", "a\\..\\b.ts"]) {
      expect(RelativePath.safeParse(file).success, file).toBe(false);
    }
    expect(RelativePath.safeParse("src/components/Card.tsx").success).toBe(true);
  });

  it("rejects oversized messages", () => {
    const raw = JSON.stringify({ v: 1, id: "a", type: "history.list", payload: {}, pad: "x".repeat(600_000) });
    expect(parseClientMessage(raw)).toEqual({ ok: false, error: "message too large" });
  });

  it("rejects negative edit values", () => {
    const observed = Object.fromEntries(
      ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "rowGap", "columnGap", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"].map((k) => [k, 0]),
    );
    const payload = { source: selection.source, tag: "div", expectedHash: "h", changes: [{ property: "padding", px: -4 }], observed };
    expect(parseClientMessage(JSON.stringify({ v: 1, id: "a", type: "edit.visual.request", payload })).ok).toBe(false);
  });

  it("parses server replies", () => {
    const raw = JSON.stringify({ v: 1, id: "s1", replyTo: "a1", type: "error", payload: { code: "unauthorized", message: "no" } });
    expect(parseServerMessage(raw).ok).toBe(true);
  });
});

describe("extension origins", () => {
  it("accepts exact Chrome and Firefox extension origins only", () => {
    expect(isValidExtensionOrigin("chrome-extension://dkaiipifgcpinbcifdkfgilclkjdmkom")).toBe(true);
    expect(isValidExtensionOrigin("moz-extension://9096d939-9e7f-4a10-b2e5-b2437dc0f17d")).toBe(true);
    for (const bad of ["http://localhost:5173", "moz-extension://*", "chrome-extension://abc", "moz-extension://9096d939-9e7f-4a10-b2e5-b2437dc0f17d/", "null", ""]) {
      expect(isValidExtensionOrigin(bad), bad).toBe(false);
    }
  });
});
