import { randomUUID } from "node:crypto";
import type { CodingAgent } from "@uihook/agent-sdk";
import { inspectElement } from "@uihook/ast-editor";
import { buildAgentTask } from "@uihook/context-engine";
import { SnapshotTooLargeError, summarize } from "@uihook/git-engine";
import type { AgentEditRequest, AgentRunResult, ElementContext } from "@uihook/protocol";
import { RequestError } from "../errors.js";
import { handleElementContext } from "../handlers/context.js";
import type { Services } from "../services.js";

const RUN_TIMEOUT_MS = 15 * 60_000;
const MAX_ANCESTORS = 5;

interface ActiveRun {
  id: string;
  agentId: string;
  controller: AbortController;
}

/** Coordinates one agent run at a time: context -> snapshot transaction -> agent -> session. */
export class AgentRunManager {
  private current: ActiveRun | null = null;
  private idle: Promise<void> = Promise.resolve();

  constructor(private readonly services: Services) {}

  get active(): ActiveRun | null {
    return this.current;
  }

  /** Resolves when the current run (if any) has fully finished. */
  whenIdle(): Promise<void> {
    return this.idle;
  }

  async start(request: AgentEditRequest): Promise<{ runId: string; agentId: string }> {
    const { registry, hub, logger } = this.services;
    if (this.current) throw new RequestError("busy", `an agent run (${this.current.agentId}) is already in progress`);

    const agent = registry.get(request.agentId);
    const info = await registry.info(agent.id);
    if (!info.installed) throw new RequestError("agent_unavailable", `${agent.name} is not installed. Install it with: ${agent.installHint}`);
    if (info.auth === "logged_out") throw new RequestError("agent_unavailable", `${agent.name} is not logged in. Log in from the panel first.`);

    const context = await handleElementContext(this.services, { selection: request.selection });
    const task = await this.buildTask(request, context);
    if (this.current) throw new RequestError("busy", "an agent run is already in progress");

    const run: ActiveRun = { id: randomUUID(), agentId: agent.id, controller: new AbortController() };
    this.current = run;
    logger.info("edit.agent.start", { run: run.id, agent: agent.id, file: context.source.file, line: context.source.line });

    this.idle = this.execute(run, agent, task).finally(() => {
      if (this.current === run) this.current = null;
    });
    return { runId: run.id, agentId: agent.id };
  }

  cancel(runId: string) {
    if (this.current?.id !== runId) throw new RequestError("not_found", "no such active run");
    this.current.controller.abort();
  }

  dispose() {
    this.current?.controller.abort();
  }

  private async buildTask(request: AgentEditRequest, context: ElementContext) {
    const { workspace, git, project } = this.services;
    const ancestors = [];
    for (const ancestor of request.selection.ancestors.slice(0, MAX_ANCESTORS)) {
      let openingTag: string | undefined;
      try {
        const source = await workspace.read(ancestor.source.file);
        openingTag = source ? inspectElement(source, ancestor.source.file, ancestor.source.line, ancestor.source.column)?.openingTag : undefined;
      } catch {
        // Parent context is best effort; confinement or parse failures just omit the tag.
      }
      ancestors.push({
        file: ancestor.source.file,
        line: ancestor.source.line,
        tag: ancestor.tag,
        ...(ancestor.component ? { component: ancestor.component } : {}),
        ...(openingTag ? { openingTag } : {}),
      });
    }

    const dirtyFiles = git ? [...(await git.status()).keys()] : null;
    return buildAgentTask({
      instruction: request.instruction,
      project,
      selection: request.selection,
      target: {
        file: context.source.file,
        line: context.source.line,
        column: context.source.column,
        openingTag: context.openingTag,
        snippet: context.snippet,
        classes: context.className.classes,
        classKind: context.className.kind,
      },
      ancestors,
      dirtyFiles,
    });
  }

  private async execute(run: ActiveRun, agent: CodingAgent, task: { prompt: string; title: string }) {
    const { hub, history, mutex, logger, workspace, projectFiles } = this.services;
    const instruction = `${agent.name}: ${task.title}`;
    const progress = (text: string) => hub.broadcast("edit.agent.progress", { runId: run.id, event: { kind: "status", text } });
    const finish = (result: Omit<AgentRunResult, "runId" | "agentId">) => {
      hub.broadcast("edit.agent.result", { runId: run.id, agentId: agent.id, ...result });
      logger.info("edit.agent.end", { run: run.id, agent: agent.id, status: result.status, ...(result.error ? { error: result.error } : {}) });
    };

    await mutex.run(async () => {
      progress(`Starting ${agent.name}`);
      let tx;
      try {
        tx = await history.beginSnapshot(instruction, projectFiles);
      } catch (error) {
        const message = error instanceof SnapshotTooLargeError ? `Refusing to run without undo: ${error.message}` : `Could not snapshot the project: ${(error as Error).message}`;
        return finish({ status: "failed", error: message });
      }
      progress(`Snapshot of ${tx.fileCount} files taken`);

      const timer = setTimeout(() => run.controller.abort(), RUN_TIMEOUT_MS);
      let done: { ok: boolean; summary?: string; error?: string } = { ok: false, error: "agent produced no result" };
      try {
        for await (const event of agent.run({ prompt: task.prompt, cwd: workspace.root, signal: run.controller.signal })) {
          if (event.kind === "done") done = event;
          else hub.broadcast("edit.agent.progress", { runId: run.id, event });
        }
      } catch (error) {
        done = { ok: false, error: (error as Error).message };
      } finally {
        clearTimeout(timer);
      }

      // Edits already on disk always become a session, so failed or cancelled runs can still be undone.
      const session = await tx.commit({ instruction });
      if (session) hub.broadcast("history.changed", { sessions: history.list().map(summarize) });
      const extra = { ...(session ? { session: summarize(session) } : {}), ...(done.summary ? { summary: done.summary } : {}) };

      if (run.controller.signal.aborted) return finish({ status: "cancelled", error: "run cancelled", ...extra });
      if (!done.ok) return finish({ status: "failed", error: done.error ?? "agent failed", ...extra });
      if (!session) return finish({ status: "no_changes", ...extra });
      return finish({ status: "applied", ...extra });
    });
  }
}
