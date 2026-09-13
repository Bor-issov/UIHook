import type { AgentRunEvent } from "../types.js";
import { clip } from "../urls.js";
import type { ProcessRunner, RunningProcess } from "../process.js";

export function versionOf(output: string): string | undefined {
  return /(\d+\.\d+\.\d+[\w.-]*)/.exec(output)?.[1];
}

/**
 * Drives a JSONL-emitting agent process. `parse` maps one decoded object to zero or more events;
 * non-JSON stdout and stderr lines become log events so failures stay visible.
 */
export async function* streamJsonl(
  proc: RunningProcess,
  parse: (value: Record<string, unknown>, state: { summary?: string; error?: string; ok?: boolean }) => AgentRunEvent[],
  signal: AbortSignal,
): AsyncIterable<AgentRunEvent> {
  const state: { summary?: string; error?: string; ok?: boolean } = {};
  const stderrTail: string[] = [];
  for await (const { stream, line } of proc.lines) {
    if (!line.trim()) continue;
    if (stream === "stderr") {
      stderrTail.push(line);
      if (stderrTail.length > 20) stderrTail.shift();
      yield { kind: "log", text: clip(line, 2000) };
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      yield { kind: "log", text: clip(line, 2000) };
      continue;
    }
    if (value && typeof value === "object") yield* parse(value as Record<string, unknown>, state);
  }
  const { code, spawnError } = await proc.exit;
  if (signal.aborted) return yield { kind: "done", ok: false, error: "cancelled" };
  if (spawnError) return yield { kind: "done", ok: false, error: spawnError };
  const ok = (state.ok ?? code === 0) && code === 0;
  yield {
    kind: "done",
    ok,
    ...(state.summary ? { summary: clip(state.summary, 8000) } : {}),
    ...(ok ? {} : { error: state.error ?? (stderrTail.slice(-3).join("\n") || `exited with code ${code}`) }),
  };
}

export type { ProcessRunner };

export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
