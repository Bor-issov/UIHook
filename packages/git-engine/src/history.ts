import { randomUUID } from "node:crypto";
import type { FileAccess } from "./file-access.js";
import type { GitClient } from "./git.js";
import { buildPatch, revertOnto } from "./patch.js";
import { type EditSession, type EditType, InMemorySessionStore, type SessionStore } from "./session.js";

export class EditConflictError extends Error {
  override name = "EditConflictError";
}

export class SessionStateError extends Error {
  override name = "SessionStateError";
}

interface Tracked {
  before: string | null;
  gitStatusBefore: string | null;
}

/**
 * A pending edit. Callers `track` every file before modifying it, then `commit` to record a session.
 * `rollback` restores tracked files if the edit fails part-way.
 */
export class EditTransaction {
  private readonly tracked = new Map<string, Tracked>();
  private finished = false;

  constructor(
    private readonly history: EditHistory,
    readonly type: EditType,
    readonly instruction: string,
    private readonly gitStatus: Map<string, { code: string }> | null,
    private readonly head: string | null,
  ) {}

  /** Captures the pre-image of a file. Idempotent: the first capture wins. */
  async track(file: string): Promise<string | null> {
    this.assertOpen();
    const existing = this.tracked.get(file);
    if (existing) return existing.before;
    const before = await this.history.files.read(file);
    this.tracked.set(file, { before, gitStatusBefore: this.gitStatus ? (this.gitStatus.get(file)?.code ?? "  ") : null });
    return before;
  }

  async write(file: string, content: string): Promise<void> {
    if (!this.tracked.has(file)) throw new SessionStateError(`file ${file} must be tracked before writing`);
    await this.history.files.write(file, content);
  }

  /** Records the session. Returns null when no tracked file actually changed. */
  async commit(options: { instruction?: string } = {}): Promise<EditSession | null> {
    this.assertOpen();
    this.finished = true;
    const changes = [];
    for (const [file, { before, gitStatusBefore }] of this.tracked) {
      const after = await this.history.files.read(file);
      if (after === before) continue;
      changes.push({ file, before, after, gitStatusBefore, ...buildPatch(file, before, after) });
    }
    if (changes.length === 0) return null;
    const session: EditSession = {
      id: randomUUID(),
      timestamp: Date.now(),
      type: this.type,
      instruction: options.instruction ?? this.instruction,
      status: "applied",
      baseline: { head: this.head },
      changes,
    };
    this.history.store.put(session);
    return session;
  }

  async rollback(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    for (const [file, { before }] of this.tracked) {
      if (before === null) await this.history.files.remove(file);
      else await this.history.files.write(file, before);
    }
  }

  private assertOpen() {
    if (this.finished) throw new SessionStateError("transaction already finished");
  }
}

/**
 * Edit history on top of pre-image snapshots, with Git used for baseline state. No commits are
 * created: pre-existing uncommitted work is preserved because only tracked files are ever written,
 * and undo refuses to overwrite changes made after an edit unless its reverse patch applies cleanly.
 */
export class EditHistory {
  constructor(
    readonly files: FileAccess,
    readonly git: GitClient | null,
    readonly store: SessionStore = new InMemorySessionStore(),
  ) {}

  async begin(type: EditType, instruction: string): Promise<EditTransaction> {
    const [status, head] = this.git ? await Promise.all([this.git.status(), this.git.head()]) : [null, null];
    return new EditTransaction(this, type, instruction, status, head);
  }

  list(): EditSession[] {
    return this.store.list();
  }

  get(id: string): EditSession | undefined {
    return this.store.get(id);
  }

  accept(id: string): EditSession {
    const session = this.require(id, "applied");
    session.status = "accepted";
    this.store.put(session);
    return session;
  }

  /** Restores every file touched by a session. All-or-nothing across files. */
  async undo(id: string): Promise<EditSession> {
    const session = this.require(id, "applied");

    const plan: { file: string; content: string | null; previous: string | null }[] = [];
    for (const change of session.changes) {
      const current = await this.files.read(change.file);
      if (current === change.after) {
        plan.push({ file: change.file, content: change.before, previous: current });
        continue;
      }
      if (current === null || change.before === null || change.after === null) {
        throw new EditConflictError(`${change.file} changed since the edit; refusing to undo`);
      }
      const reverted = revertOnto(current, change.before, change.after);
      if (reverted === null) throw new EditConflictError(`${change.file} changed since the edit and the undo no longer applies cleanly`);
      plan.push({ file: change.file, content: reverted, previous: current });
    }

    const written: typeof plan = [];
    try {
      for (const step of plan) {
        if (step.content === null) await this.files.remove(step.file);
        else await this.files.write(step.file, step.content);
        written.push(step);
      }
    } catch (error) {
      for (const step of written.reverse()) {
        if (step.previous === null) await this.files.remove(step.file).catch(() => undefined);
        else await this.files.write(step.file, step.previous).catch(() => undefined);
      }
      throw error;
    }

    session.status = "undone";
    this.store.put(session);
    return session;
  }

  private require(id: string, status: EditSession["status"]): EditSession {
    const session = this.store.get(id);
    if (!session) throw new SessionStateError(`unknown session ${id}`);
    if (session.status !== status) throw new SessionStateError(`session ${id} is ${session.status}`);
    return session;
  }
}
