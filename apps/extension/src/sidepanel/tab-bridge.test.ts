import { afterEach, describe, expect, it, vi } from "vitest";

const g = globalThis as { chrome?: unknown; location?: unknown };

afterEach(() => {
  delete g.chrome;
  vi.resetModules();
});

const selection = {
  element: { tag: "div", classes: [] },
  rect: { x: 0, y: 0, width: 1, height: 1 },
  styles: {},
  instanceCount: 1,
  ancestors: [],
  pageUrl: "http://localhost:5173/",
};

async function setup() {
  let listener: ((message: unknown, sender: unknown) => void) | undefined;
  g.chrome = { runtime: { id: "ext-id", onMessage: { addListener: (fn: typeof listener) => (listener = fn), removeListener: vi.fn() } } };
  const { onContentMessage } = await import("./tab-bridge.js");
  const handler = vi.fn();
  onContentMessage(() => 5, handler);
  return { deliver: (message: unknown, sender: unknown) => listener!(message, sender), handler };
}

describe("panel routing of content messages", () => {
  it("delivers validated messages from the bound tab", async () => {
    const { deliver, handler } = await setup();
    deliver({ type: "content.selected", selection, reason: "user" }, { id: "ext-id", tab: { id: 5 } });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: "content.selected" }));
  });

  it("ignores other tabs, other extensions, non-tab senders and malformed payloads", async () => {
    const { deliver, handler } = await setup();
    deliver({ type: "content.cleared" }, { id: "ext-id", tab: { id: 6 } });
    deliver({ type: "content.cleared" }, { id: "other-extension", tab: { id: 5 } });
    deliver({ type: "content.cleared" }, { id: "ext-id" });
    deliver({ type: "content.selected", selection: { ...selection, instanceCount: -1 }, reason: "user" }, { id: "ext-id", tab: { id: 5 } });
    deliver({ type: "shell.exec" }, { id: "ext-id", tab: { id: 5 } });
    expect(handler).not.toHaveBeenCalled();
  });
});
