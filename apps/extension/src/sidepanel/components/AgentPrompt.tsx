import type { AgentEvent } from "@uihook/protocol";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { usePanel } from "../store";
import { Button } from "./ui";

function eventLine(event: AgentEvent): string {
  switch (event.kind) {
    case "status":
      return event.text;
    case "message":
      return event.text;
    case "tool":
      return `${event.name}${event.detail ? ` ${event.detail}` : ""}`;
    case "log":
      return event.text;
  }
}

const RESULT_TEXT = {
  applied: "Changes applied. Review the diff below.",
  no_changes: "The agent finished without changing files.",
  failed: "The agent run failed.",
  cancelled: "Run cancelled.",
} as const;

export function AgentPrompt() {
  const agents = usePanel((s) => s.agents);
  const agentId = usePanel((s) => s.agentId);
  const draft = usePanel((s) => s.draft);
  const run = usePanel((s) => s.run);
  const focus = usePanel((s) => s.promptFocus);
  const context = usePanel((s) => s.context);
  const { setDraft, askAgent, cancelRun } = usePanel.getState();
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focus > 0) textarea.current?.focus();
  }, [focus]);

  const agent = agents.find((a) => a.id === agentId);
  const running = run?.status === "running";
  const usable = Boolean(agent?.installed && agent.auth !== "logged_out");
  const placeholder = agent ? `Ask ${agent.name} to change this ${context?.source ? "component" : "element"}…` : "Log in with an AI provider above";

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void askAgent();
  };

  return (
    <div data-testid="agent-prompt" className="flex flex-col gap-2">
      <textarea
        ref={textarea}
        aria-label="Agent instruction"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={3}
        disabled={!usable || running}
        className="w-full resize-y rounded-md bg-bone/10 px-2 py-2 text-xs leading-5 text-bone outline-none placeholder:text-bone/40 disabled:opacity-50"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-bone/40">Ctrl+Enter to send</span>
        {running ? (
          <Button onClick={() => void cancelRun()}>Cancel</Button>
        ) : (
          <Button variant="primary" disabled={!usable || !draft.trim() || !context} onClick={() => void askAgent()}>
            Send
          </Button>
        )}
      </div>

      {run ? (
        <div data-testid="agent-run" data-status={run.status} className="flex flex-col gap-2 rounded-lg bg-bone/5 p-3">
          <p className="text-xs text-bone/60">
            {agents.find((a) => a.id === run.agentId)?.name ?? run.agentId}: <span className="text-bone">{run.instruction}</span>
          </p>
          {run.events.length ? (
            <ol className="flex max-h-48 flex-col gap-1 overflow-auto font-mono text-[10px] leading-4">
              {run.events.slice(-40).map((event, index) => (
                <li key={index} className={event.kind === "message" ? "whitespace-pre-wrap text-bone" : event.kind === "log" ? "text-bone/40" : "text-bone/60"}>
                  {event.kind === "tool" ? "> " : ""}
                  {eventLine(event)}
                </li>
              ))}
            </ol>
          ) : null}
          {running ? <p className="text-xs text-bone/60">Working…</p> : null}
          {!running ? (
            <p data-testid="agent-result" className={`text-xs ${run.status === "applied" ? "text-bone" : "text-signal"}`}>
              {RESULT_TEXT[run.status as keyof typeof RESULT_TEXT]}
              {run.error && run.status !== "cancelled" ? ` ${run.error}` : ""}
            </p>
          ) : null}
          {run.summary && !running && !run.events.some((e) => e.kind === "message" && e.text === run.summary) ? (
            <p className="text-xs leading-5 whitespace-pre-wrap text-bone/80">{run.summary}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
