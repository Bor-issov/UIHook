import type { EditSessionSummary, FileTouch } from "@uihook/protocol";

export type EditType = "visual" | "agent";
export type EditStatus = "applied" | "accepted" | "undone";

export interface FileChange {
  file: string;
  /** null when the file did not exist before / after the edit. */
  before: string | null;
  after: string | null;
  /** Git status of the file before the edit, if the project is a repository. */
  gitStatusBefore: string | null;
  additions: number;
  deletions: number;
  patch: string;
}

export interface EditSession {
  id: string;
  timestamp: number;
  type: EditType;
  instruction: string;
  status: EditStatus;
  baseline: { head: string | null };
  changes: FileChange[];
}

export function summarize(session: EditSession): EditSessionSummary {
  return {
    id: session.id,
    timestamp: session.timestamp,
    type: session.type,
    instruction: session.instruction,
    status: session.status,
    files: session.changes.map((c): FileTouch => ({ file: c.file, additions: c.additions, deletions: c.deletions })),
    patch: session.changes.map((c) => c.patch).join(""),
  };
}

/** Storage seam: in-memory for the MVP, persistent (e.g. `.uihook/sessions`) later. */
export interface SessionStore {
  list(): EditSession[];
  get(id: string): EditSession | undefined;
  put(session: EditSession): void;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, EditSession>();

  list(): EditSession[] {
    return [...this.sessions.values()].sort((a, b) => b.timestamp - a.timestamp);
  }

  get(id: string): EditSession | undefined {
    return this.sessions.get(id);
  }

  put(session: EditSession): void {
    this.sessions.set(session.id, session);
  }
}
