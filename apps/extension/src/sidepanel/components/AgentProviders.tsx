import type { AgentInfo } from "@uihook/protocol";
import { type FormEvent, useState } from "react";
import { usePanel } from "../store";
import { Button, Section } from "./ui";

function statusText(agent: AgentInfo): string {
  if (!agent.installed) return "Not installed";
  if (agent.auth === "logged_in") return `Logged in${agent.authDetail ? ` · ${agent.authDetail}` : ""}`;
  if (agent.auth === "logged_out") return agent.authDetail ? `Not logged in · ${agent.authDetail}` : "Not logged in";
  return agent.authDetail ? `Status unknown · ${agent.authDetail}` : "Status unknown";
}

/**
 * Asks the user to connect a coding agent they already use. Login always happens through the
 * provider's own CLI flow; UIHook never sees credentials.
 */
export function AgentProviders() {
  const agents = usePanel((s) => s.agents);
  const agentId = usePanel((s) => s.agentId);
  const [expanded, setExpanded] = useState(false);
  const { loadAgents } = usePanel.getState();

  if (agents.length === 0) return null;
  const selected = agents.find((a) => a.id === agentId);
  const ready = selected?.installed && selected.auth !== "logged_out";

  if (ready && !expanded) {
    return (
      <div data-testid="agent-summary" className="flex items-center justify-between gap-2 rounded-lg bg-bone/5 px-3 py-2 text-xs">
        <span className="min-w-0 truncate">
          <span className="text-bone/50">Agent </span>
          {selected.name} <span className="text-bone/50">· {statusText(selected)}</span>
        </span>
        <Button variant="ghost" onClick={() => setExpanded(true)}>
          Change
        </Button>
      </div>
    );
  }

  const anyLoggedIn = agents.some((a) => a.auth === "logged_in");
  return (
    <Section
      title="AI provider"
      aside={
        <div className="flex gap-1">
          <Button variant="ghost" onClick={() => void loadAgents()}>
            Check again
          </Button>
          {ready ? (
            <Button variant="ghost" onClick={() => setExpanded(false)}>
              Done
            </Button>
          ) : null}
        </div>
      }
    >
      <div data-testid="agent-providers" className="flex flex-col gap-2">
        {!anyLoggedIn ? (
          <p className="text-xs leading-5 text-signal">Log in with the coding agent you use. Semantic edits run through it on your machine.</p>
        ) : null}
        {agents.map((agent) => (
          <ProviderRow key={agent.id} agent={agent} selected={agent.id === agentId} />
        ))}
      </div>
    </Section>
  );
}

function ProviderRow({ agent, selected }: { agent: AgentInfo; selected: boolean }) {
  const login = usePanel((s) => s.logins[agent.id]);
  const { selectAgent, startLogin, cancelLogin, sendLoginInput } = usePanel.getState();
  const [code, setCode] = useState("");
  const running = login?.state === "running";

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    void sendLoginInput(agent.id, code.trim());
    setCode("");
  };

  return (
    <div data-testid={`agent-${agent.id}`} data-auth={agent.auth} className={`flex flex-col gap-2 rounded-lg p-3 ${selected ? "bg-bone/10" : "bg-bone/5"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">
            {agent.name}
            {agent.version ? <span className="ml-1 font-mono text-[11px] text-bone/40">{agent.version}</span> : null}
          </span>
          <span className={`text-xs ${agent.auth === "logged_in" ? "text-bone/60" : "text-signal"}`}>{statusText(agent)}</span>
        </div>
        <div className="flex shrink-0 gap-1">
          {agent.installed && agent.auth !== "logged_in" && agent.login.kind === "command" && !running ? (
            <Button variant="primary" onClick={() => void startLogin(agent.id)}>
              {agent.login.label}
            </Button>
          ) : null}
          {agent.installed && agent.auth !== "logged_out" ? (
            <Button variant={selected ? "secondary" : "ghost"} aria-pressed={selected} onClick={() => selectAgent(agent.id)}>
              {selected ? "Selected" : "Use"}
            </Button>
          ) : null}
        </div>
      </div>

      {!agent.installed && agent.installHint ? (
        <p className="text-xs text-bone/60">
          Install: <code className="font-mono text-bone">{agent.installHint}</code>
        </p>
      ) : null}

      {agent.installed && agent.auth !== "logged_in" && agent.login.kind === "manual" ? <p className="text-xs leading-5 text-bone/70">{agent.login.instructions}</p> : null}

      {login ? (
        <div className="flex flex-col gap-1.5">
          {login.message ? <p className="text-xs text-bone/70">{login.message}</p> : null}
          {login.url ? (
            <a href={login.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-signal underline">
              Open sign-in page
            </a>
          ) : null}
          {login.lines.length ? <pre className="max-h-24 overflow-auto rounded-md bg-bone/5 p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-bone/60">{login.lines.join("\n")}</pre> : null}
          {running ? (
            <form onSubmit={submitCode} className="flex gap-1">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste code if the CLI asks for one"
                aria-label={`${agent.name} login code`}
                className="min-w-0 flex-1 rounded-md bg-bone/10 px-2 py-1.5 font-mono text-xs text-bone outline-none placeholder:text-bone/40"
              />
              <Button type="submit">Send</Button>
              <Button variant="ghost" onClick={() => void cancelLogin(agent.id)}>
                Cancel
              </Button>
            </form>
          ) : null}
          {login.state === "succeeded" ? <p className="text-xs text-bone">Logged in.</p> : null}
          {login.state === "failed" ? <p className="text-xs text-signal">Login did not complete. Try again or run the command in a terminal.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
