import { EditConflictError, SessionStateError, summarize } from "@uihook/git-engine";
import type { EditSessionSummary } from "@uihook/protocol";
import { RequestError } from "../errors.js";
import type { Services } from "../services.js";

export function listHistory(services: Services): EditSessionSummary[] {
  return services.history.list().map(summarize);
}

export function sessionPatch(services: Services, sessionId: string): string {
  const session = services.history.get(sessionId);
  if (!session) throw new RequestError("not_found", `unknown session ${sessionId}`);
  return summarize(session).patch;
}

export async function undoSession(services: Services, sessionId: string): Promise<EditSessionSummary[]> {
  if (services.runs.active) throw new RequestError("busy", "an agent run is in progress; undo after it finishes");
  return services.mutex.run(async () => {
    try {
      const session = await services.history.undo(sessionId);
      services.logger.info("history.undo", { session: session.id, files: session.changes.map((c) => c.file) });
    } catch (error) {
      throw mapHistoryError(error);
    }
    return listHistory(services);
  });
}

export function acceptSession(services: Services, sessionId: string): EditSessionSummary[] {
  try {
    services.history.accept(sessionId);
  } catch (error) {
    throw mapHistoryError(error);
  }
  return listHistory(services);
}

function mapHistoryError(error: unknown): unknown {
  if (error instanceof EditConflictError) return new RequestError("conflict", error.message);
  if (error instanceof SessionStateError) return new RequestError("bad_request", error.message);
  return error;
}
