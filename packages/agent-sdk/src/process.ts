import { spawn } from "node:child_process";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the binary could not be started (e.g. not installed). */
  spawnError?: string;
}

export interface SpawnOptions {
  cwd?: string;
  stdin?: string;
  signal?: AbortSignal;
  /** Keep stdin open for interactive input (login flows). */
  interactive?: boolean;
}

export interface ProcessLine {
  stream: "stdout" | "stderr";
  line: string;
}

export interface RunningProcess {
  lines: AsyncIterable<ProcessLine>;
  exit: Promise<{ code: number | null; spawnError?: string }>;
  write(text: string): void;
  kill(): void;
}

/** Process seam for adapters, replaced by fakes in tests. Arguments are arrays; no shell is involved. */
export interface ProcessRunner {
  exec(command: string, args: string[], options?: { timeoutMs?: number; cwd?: string }): Promise<ExecResult>;
  spawn(command: string, args: string[], options?: SpawnOptions): RunningProcess;
}

/** Companion secrets never reach agent processes. */
export function agentEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("UIHOOK_")));
}

export const nodeProcessRunner: ProcessRunner = {
  exec(command, args, { timeoutMs = 15_000, cwd } = {}) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd, env: agentEnvironment(), stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (error) => resolve({ code: null, stdout, stderr, spawnError: error.message }));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  },

  spawn(command, args, { cwd, stdin, signal, interactive = false } = {}) {
    const detached = process.platform !== "win32";
    const child = spawn(command, args, { cwd, env: agentEnvironment(), stdio: ["pipe", "pipe", "pipe"], detached });
    const queue: ProcessLine[] = [];
    let wake: (() => void) | null = null;
    let open = 2;

    const kill = () => {
      if (child.exitCode !== null || child.killed) return;
      try {
        // Kill the whole process group: agent CLIs spawn helpers of their own.
        if (detached && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    };
    signal?.addEventListener("abort", kill, { once: true });

    for (const stream of ["stdout", "stderr"] as const) {
      let buffer = "";
      child[stream].setEncoding("utf8");
      child[stream].on("data", (chunk: string) => {
        buffer += chunk;
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? "";
        for (const line of parts) queue.push({ stream, line });
        wake?.();
      });
      child[stream].on("end", () => {
        if (buffer) queue.push({ stream, line: buffer });
        open--;
        wake?.();
      });
    }

    const exit = new Promise<{ code: number | null; spawnError?: string }>((resolve) => {
      child.on("error", (error) => {
        open = 0;
        wake?.();
        resolve({ code: null, spawnError: error.message });
      });
      child.on("close", (code) => resolve({ code }));
    });

    if (stdin !== undefined) child.stdin.write(stdin);
    if (!interactive) child.stdin.end();
    child.stdin.on("error", () => undefined);

    const lines: AsyncIterable<ProcessLine> = {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (queue.length) yield queue.shift()!;
          if (open <= 0) return;
          await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
        }
      },
    };

    return {
      lines,
      exit,
      kill,
      write: (text) => {
        if (child.stdin.writable) child.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
      },
    };
  },
};
