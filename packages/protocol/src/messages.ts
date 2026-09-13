import { z } from "zod";
import { ElementContext } from "./context.js";
import { EditSessionSummary, VisualEditRequest, VisualEditResult } from "./edits.js";
import { PROTOCOL_VERSION } from "./primitives.js";
import { ElementSelection } from "./selection.js";

const id = z.string().min(1).max(64);

function message<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({ v: z.literal(PROTOCOL_VERSION), id, type: z.literal(type), payload });
}

function reply<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({ v: z.literal(PROTOCOL_VERSION), id, replyTo: id, type: z.literal(type), payload });
}

/* ---------------------------------- client -> companion ---------------------------------- */

export const ClientMessage = z.discriminatedUnion("type", [
  message("session.hello", z.object({ token: z.string().min(16).max(256), client: z.string().max(64) })),
  message("element.context.request", z.object({ selection: ElementSelection })),
  message("edit.visual.request", VisualEditRequest),
  message("git.diff.request", z.object({ sessionId: z.string().max(64) })),
  message("history.list", z.object({})),
  message("history.undo", z.object({ sessionId: z.string().max(64) })),
  message("history.accept", z.object({ sessionId: z.string().max(64) })),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageType = ClientMessage["type"];

/* ---------------------------------- companion -> client ---------------------------------- */

export const ProjectInfo = z.object({
  name: z.string(),
  framework: z.enum(["vite", "next", "unknown"]),
  tailwind: z.enum(["v3", "v4"]).nullable(),
  git: z.boolean(),
});
export type ProjectInfo = z.infer<typeof ProjectInfo>;

export const ErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "not_found",
  "forbidden_path",
  "stale_source",
  "conflict",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ServerMessage = z.discriminatedUnion("type", [
  reply("session.ready", z.object({ project: ProjectInfo, protocol: z.literal(PROTOCOL_VERSION) })),
  reply("element.context.response", ElementContext),
  reply("edit.visual.result", VisualEditResult),
  reply("git.diff.response", z.object({ sessionId: z.string(), patch: z.string() })),
  reply("history.state", z.object({ sessions: z.array(EditSessionSummary) })),
  reply("error", z.object({ code: ErrorCode, message: z.string() })),
  /** Unsolicited broadcast when history changes (e.g. from another client). */
  message("history.changed", z.object({ sessions: z.array(EditSessionSummary) })),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type ServerMessageType = ServerMessage["type"];

export type ClientPayload<T extends ClientMessageType> = Extract<ClientMessage, { type: T }>["payload"];
export type ServerPayload<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>["payload"];

/** Maps each request to the reply types it may legitimately receive. */
export interface RequestReplyMap {
  "session.hello": "session.ready";
  "element.context.request": "element.context.response";
  "edit.visual.request": "edit.visual.result";
  "git.diff.request": "git.diff.response";
  "history.list": "history.state";
  "history.undo": "history.state";
  "history.accept": "history.state";
}

export const MAX_MESSAGE_BYTES = 512 * 1024;

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string };

function parseWith<S extends z.ZodType>(schema: S, raw: string): ParseResult<z.infer<S>> {
  if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, error: "message too large" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  const result = schema.safeParse(json);
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) };
  return { ok: true, message: result.data };
}

export const parseClientMessage = (raw: string) => parseWith(ClientMessage, raw);
export const parseServerMessage = (raw: string) => parseWith(ServerMessage, raw);
