import type { EditSessionSummary, ElementContext, ElementSelection, ProjectInfo, VisualChange } from "@uihook/protocol";
import { create } from "zustand";
import { CompanionClient, CompanionError } from "./companion-client";
import { toObservedBox } from "./observed";
import { type ContentState, sendToTab } from "./tab-bridge";

type Connection =
  | { status: "disconnected"; error?: string }
  | { status: "connecting" }
  | { status: "connected"; project: ProjectInfo; port: number };

export type Notice = { kind: "info" | "refused" | "error"; text: string } | null;

interface PanelState {
  connection: Connection;
  tabId: number | null;
  content: ContentState | null;
  selection: ElementSelection | null;
  context: ElementContext | null;
  contextError: string | null;
  sessions: EditSessionSummary[];
  openDiff: string | null;
  busy: boolean;
  notice: Notice;

  connect(port: number, token: string): Promise<void>;
  disconnect(): void;
  bindTab(tabId: number | null): Promise<void>;
  setMode(active: boolean): Promise<void>;
  receiveSelection(selection: ElementSelection): Promise<void>;
  clearSelection(): void;
  applyChanges(changes: VisualChange[]): Promise<void>;
  undo(sessionId?: string): Promise<void>;
  accept(sessionId: string): Promise<void>;
  toggleDiff(sessionId: string): void;
}

const client = new CompanionClient({
  onBroadcast: (message) => {
    if (message.type === "history.changed") usePanel.setState({ sessions: message.payload.sessions });
  },
  onClose: (reason) => usePanel.setState({ connection: { status: "disconnected", error: `Disconnected: ${reason}` } }),
});

let contextSeq = 0;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const usePanel = create<PanelState>((set, get) => ({
  connection: { status: "disconnected" },
  tabId: null,
  content: null,
  selection: null,
  context: null,
  contextError: null,
  sessions: [],
  openDiff: null,
  busy: false,
  notice: null,

  async connect(port, token) {
    set({ connection: { status: "connecting" }, notice: null });
    try {
      const project = await client.connect(port, token);
      await chrome.storage.local.set({ companion: { port, token } });
      set({ connection: { status: "connected", project, port } });
      const history = await client.request("history.list", {});
      set({ sessions: history.payload.sessions });
      const { selection } = get();
      if (selection) await get().receiveSelection(selection);
    } catch (error) {
      client.disconnect();
      set({ connection: { status: "disconnected", error: errorText(error) } });
    }
  },

  disconnect() {
    client.disconnect();
    set({ connection: { status: "disconnected" }, sessions: [], context: null });
  },

  async bindTab(tabId) {
    set({ tabId, selection: null, context: null, contextError: null, content: null });
    if (tabId !== null) set({ content: await sendToTab(tabId, { type: "panel.getMode" }) });
  },

  async setMode(active) {
    const { tabId } = get();
    if (tabId === null) return;
    const content = await sendToTab(tabId, { type: "panel.setMode", active });
    set({ content, ...(content ? {} : { notice: { kind: "error", text: "This tab has no UIHook content script. Open a localhost dev server and reload the page." } }) });
  },

  async receiveSelection(selection) {
    const seq = ++contextSeq;
    set({ selection, contextError: null });
    if (get().connection.status !== "connected") return;
    if (!selection.source) {
      set({ context: null, contextError: "No source metadata on this element. Add the uihook() Vite plugin to the app." });
      return;
    }
    try {
      const reply = await client.request("element.context.request", { selection });
      if (seq === contextSeq) set({ context: reply.payload });
    } catch (error) {
      if (seq === contextSeq) set({ context: null, contextError: errorText(error) });
    }
  },

  clearSelection() {
    contextSeq++;
    set({ selection: null, context: null, contextError: null });
  },

  async applyChanges(changes) {
    const { selection, context } = get();
    if (!selection || !context || get().busy) return;
    set({ busy: true, notice: null });
    try {
      const reply = await client.request("edit.visual.request", {
        source: context.source,
        tag: selection.element.tag,
        expectedHash: context.hash,
        changes,
        observed: toObservedBox(selection.styles),
      });
      const result = reply.payload;
      if (result.status === "applied") {
        set({ openDiff: result.session.id, notice: { kind: "info", text: result.session.instruction } });
      } else if (result.status === "unsupported") {
        set({ notice: { kind: "refused", text: `Not changed deterministically: ${result.reason}. This needs the agent path.` } });
      } else {
        set({ notice: { kind: "info", text: "Already at that value." } });
      }
    } catch (error) {
      const stale = error instanceof CompanionError && error.code === "stale_source";
      set({ notice: { kind: "error", text: errorText(error) } });
      if (stale) await refreshFromTab();
    } finally {
      set({ busy: false });
    }
  },

  async undo(sessionId) {
    const target = sessionId ?? get().sessions.find((s) => s.status === "applied")?.id;
    if (!target) {
      set({ notice: { kind: "info", text: "Nothing to undo." } });
      return;
    }
    set({ busy: true, notice: null });
    try {
      const reply = await client.request("history.undo", { sessionId: target });
      set({ sessions: reply.payload.sessions, notice: { kind: "info", text: "Undone. Source restored." } });
    } catch (error) {
      set({ notice: { kind: "error", text: errorText(error) } });
    } finally {
      set({ busy: false });
    }
  },

  async accept(sessionId) {
    try {
      const reply = await client.request("history.accept", { sessionId });
      set({ sessions: reply.payload.sessions, openDiff: null });
    } catch (error) {
      set({ notice: { kind: "error", text: errorText(error) } });
    }
  },

  toggleDiff(sessionId) {
    set({ openDiff: get().openDiff === sessionId ? null : sessionId });
  },
}));

async function refreshFromTab() {
  const { tabId } = usePanel.getState();
  if (tabId !== null) await sendToTab(tabId, { type: "panel.refreshSelection" });
}
