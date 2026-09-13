import type { AgentEvent, AgentInfo, AgentLoginState, AgentRunStatus, EditSessionSummary, ElementContext, ElementSelection, ProjectInfo, VisualChange } from "@uihook/protocol";
import { create } from "zustand";
import { platform } from "../platform";
import { ext } from "../platform/ext";
import { CompanionClient, CompanionError } from "./companion-client";
import { toObservedBox } from "./observed";
import { type ContentState, sendToTab } from "./tab-bridge";

type Connection =
  | { status: "disconnected"; error?: string }
  | { status: "connecting" }
  | { status: "connected"; project: ProjectInfo; port: number };

export type Notice = { kind: "info" | "refused" | "error"; text: string; suggestion?: string } | null;

export interface LoginProgress {
  state: AgentLoginState;
  lines: string[];
  url?: string;
  message?: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  instruction: string;
  events: AgentEvent[];
  status: "running" | AgentRunStatus;
  error?: string;
  summary?: string;
}

const MAX_RUN_EVENTS = 200;

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
  agents: AgentInfo[];
  agentId: string | null;
  logins: Record<string, LoginProgress>;
  run: AgentRun | null;
  draft: string;
  promptFocus: number;

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
  loadAgents(): Promise<void>;
  selectAgent(agentId: string): void;
  startLogin(agentId: string): Promise<void>;
  sendLoginInput(agentId: string, text: string): Promise<void>;
  cancelLogin(agentId: string): Promise<void>;
  setDraft(text: string): void;
  focusPrompt(): void;
  askAgent(): Promise<void>;
  cancelRun(): Promise<void>;
}

const client = new CompanionClient({
  onBroadcast: (message) => {
    const state = usePanel.getState();
    switch (message.type) {
      case "history.changed":
        return usePanel.setState({ sessions: message.payload.sessions });
      case "agent.login.progress": {
        const { agentId, state: loginState, line, url, agents } = message.payload;
        const previous = state.logins[agentId] ?? { state: "running", lines: [] };
        const next: LoginProgress = {
          ...previous,
          state: loginState,
          lines: line ? [...previous.lines, line].slice(-8) : previous.lines,
          ...(url ? { url } : {}),
        };
        usePanel.setState({ logins: { ...state.logins, [agentId]: next }, ...(agents ? { agents } : {}) });
        if (agents && loginState === "succeeded" && !state.agentId) state.selectAgent(agentId);
        return;
      }
      case "edit.agent.progress": {
        if (state.run?.id !== message.payload.runId) return;
        return usePanel.setState({ run: { ...state.run, events: [...state.run.events, message.payload.event].slice(-MAX_RUN_EVENTS) } });
      }
      case "edit.agent.result": {
        const result = message.payload;
        if (state.run?.id !== result.runId) return;
        usePanel.setState({
          run: { ...state.run, status: result.status, ...(result.error ? { error: result.error } : {}), ...(result.summary ? { summary: result.summary } : {}) },
          ...(result.session ? { openDiff: result.session.id } : {}),
        });
        if (result.status === "applied") usePanel.setState({ draft: "" });
        return;
      }
    }
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
  agents: [],
  agentId: null,
  logins: {},
  run: null,
  draft: "",
  promptFocus: 0,

  async connect(port, token) {
    set({ connection: { status: "connecting" }, notice: null });
    try {
      const project = await client.connect(port, token);
      await ext.storage.local.set({ companion: { port, token } });
      set({ connection: { status: "connected", project, port } });
      const history = await client.request("history.list", {});
      set({ sessions: history.payload.sessions });
      const stored = (await ext.storage.local.get("agentId")).agentId;
      if (typeof stored === "string") set({ agentId: stored });
      void get().loadAgents();
      const { selection } = get();
      if (selection) await get().receiveSelection(selection);
    } catch (error) {
      client.disconnect();
      const unreachable = error instanceof CompanionError && error.code === "unreachable";
      const text = unreachable
        ? `Local companion connection failed on port ${port}. Either it is not running, or it rejected this browser's extension origin ${location.origin}. If the companion log shows "connection.rejected", restart it with: --extension-origin ${location.origin}`
        : errorText(error);
      set({ connection: { status: "disconnected", error: text } });
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
    set({
      content,
      ...(content
        ? {}
        : { notice: { kind: "error", text: `Content script could not access this page. Open a localhost dev server, allow UIHook access to localhost, and reload the page. The ${platform.panelName} follows the active tab.` } }),
    });
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
        set({
          notice: { kind: "refused", text: `Not changed deterministically: ${result.reason}.`, suggestion: describeChanges(changes) },
        });
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

  async loadAgents() {
    try {
      const reply = await client.request("agent.list", {});
      const agents = reply.payload.agents;
      const current = get().agentId;
      const usable = agents.find((a) => a.id === current && a.installed) ?? agents.find((a) => a.auth === "logged_in");
      set({ agents, agentId: usable?.id ?? current ?? null });
    } catch (error) {
      set({ notice: { kind: "error", text: `Could not list AI providers: ${errorText(error)}` } });
    }
  },

  selectAgent(agentId) {
    set({ agentId });
    void ext.storage.local.set({ agentId });
  },

  async startLogin(agentId) {
    set({ logins: { ...get().logins, [agentId]: { state: "running", lines: [] } } });
    try {
      const reply = await client.request("agent.login.start", { agentId });
      set({ logins: { ...get().logins, [agentId]: { ...get().logins[agentId]!, message: reply.payload.message } } });
    } catch (error) {
      set({ logins: { ...get().logins, [agentId]: { state: "failed", lines: [errorText(error)] } } });
    }
  },

  async sendLoginInput(agentId, text) {
    try {
      await client.request("agent.login.input", { agentId, text });
    } catch (error) {
      set({ notice: { kind: "error", text: errorText(error) } });
    }
  },

  async cancelLogin(agentId) {
    await client.request("agent.login.cancel", { agentId }).catch(() => undefined);
  },

  setDraft(text) {
    set({ draft: text });
  },

  focusPrompt() {
    set({ promptFocus: get().promptFocus + 1 });
  },

  async askAgent() {
    const { selection, agentId, draft, run } = get();
    const instruction = draft.trim();
    if (!selection || !agentId || !instruction || run?.status === "running") return;
    set({ notice: null });
    try {
      const reply = await client.request("edit.agent.request", { agentId, instruction, selection });
      set({ run: { id: reply.payload.runId, agentId, instruction, events: [], status: "running" } });
    } catch (error) {
      set({ notice: { kind: "error", text: errorText(error) } });
      if (error instanceof CompanionError && error.code === "agent_unavailable") void get().loadAgents();
    }
  },

  async cancelRun() {
    const { run } = get();
    if (!run || run.status !== "running") return;
    await client.request("edit.agent.cancel", { runId: run.id }).catch((error: unknown) => set({ notice: { kind: "error", text: errorText(error) } }));
  },
}));

const CHANGE_LABELS: Record<VisualChange["property"], string> = {
  padding: "padding",
  paddingX: "horizontal padding",
  paddingY: "vertical padding",
  margin: "margin",
  marginX: "horizontal margin",
  marginY: "vertical margin",
  gap: "gap",
  gapX: "column gap",
  gapY: "row gap",
  borderRadius: "border radius",
};

/** Turns a refused deterministic edit into an instruction for the agent path. */
function describeChanges(changes: VisualChange[]): string {
  return `Set the ${changes.map((c) => `${CHANGE_LABELS[c.property]} to ${c.px}px`).join(" and ")} on the selected element, using the project's existing styling conventions.`;
}

async function refreshFromTab() {
  const { tabId } = usePanel.getState();
  if (tabId !== null) await sendToTab(tabId, { type: "panel.refreshSelection" });
}
