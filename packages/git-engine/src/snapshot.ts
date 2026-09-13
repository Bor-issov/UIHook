import { randomUUID } from "node:crypto";
import type { FileAccess } from "./file-access.js";
import type { EditHistory } from "./history.js";
import { buildPatch } from "./patch.js";
import type { EditSession, FileChange } from "./session.js";

/** Lists project-relative files eligible for snapshotting (e.g. `git ls-files` or a filtered walk). */
export interface ProjectFileLister {
  list(): Promise<string[]>;
}

export class SnapshotTooLargeError extends Error {
  override name = "SnapshotTooLargeError";
}

export interface SnapshotLimits {
  maxTotalBytes: number;
  maxFiles: number;
}

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = { maxTotalBytes: 128 * 1024 * 1024, maxFiles: 20_000 };

/**
 * Transaction for edits whose target files are unknown up front (coding agents). Captures every
 * eligible file before the run and derives modified, created and deleted files afterwards.
 * Refuses to start when the project is too large to snapshot: an agent edit without undo is not offered.
 */
export class SnapshotTransaction {
  private finished = false;

  private constructor(
    private readonly history: EditHistory,
    private readonly lister: ProjectFileLister,
    readonly instruction: string,
    private readonly before: Map<string, string>,
    private readonly gitStatus: Map<string, { code: string }> | null,
    private readonly head: string | null,
  ) {}

  static async begin(history: EditHistory, lister: ProjectFileLister, instruction: string, limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS) {
    const [gitStatus, head] = history.git ? await Promise.all([history.git.status(), history.git.head()]) : [null, null];
    const files = await lister.list();
    if (files.length > limits.maxFiles) throw new SnapshotTooLargeError(`project has ${files.length} files; snapshot limit is ${limits.maxFiles}`);
    const before = new Map<string, string>();
    let total = 0;
    for (const file of files) {
      const content = await readOrSkip(history.files, file);
      if (content === null) continue;
      total += Buffer.byteLength(content);
      if (total > limits.maxTotalBytes) throw new SnapshotTooLargeError(`project sources exceed the ${Math.round(limits.maxTotalBytes / 1024 / 1024)}MB snapshot limit`);
      before.set(file, content);
    }
    return new SnapshotTransaction(history, lister, instruction, before, gitStatus, head);
  }

  get fileCount() {
    return this.before.size;
  }

  /** Files that differ from the snapshot right now. */
  async changes(): Promise<FileChange[]> {
    const after = new Set(await this.lister.list());
    const candidates = new Set([...this.before.keys(), ...after]);
    const changes: FileChange[] = [];
    for (const file of [...candidates].sort()) {
      const previous = this.before.get(file) ?? null;
      const current = after.has(file) ? await readOrSkip(this.history.files, file) : null;
      if (previous === current) continue;
      changes.push({
        file,
        before: previous,
        after: current,
        gitStatusBefore: this.gitStatus ? (this.gitStatus.get(file)?.code ?? "  ") : null,
        ...buildPatch(file, previous, current),
      });
    }
    return changes;
  }

  async commit(options: { instruction?: string } = {}): Promise<EditSession | null> {
    if (this.finished) throw new Error("transaction already finished");
    this.finished = true;
    const changes = await this.changes();
    if (changes.length === 0) return null;
    const session: EditSession = {
      id: randomUUID(),
      timestamp: Date.now(),
      type: "agent",
      instruction: options.instruction ?? this.instruction,
      status: "applied",
      baseline: { head: this.head },
      changes,
    };
    this.history.store.put(session);
    return session;
  }
}

async function readOrSkip(files: FileAccess, file: string): Promise<string | null> {
  try {
    return await files.read(file);
  } catch {
    // Unreadable or policy-denied files are outside the transaction.
    return null;
  }
}
