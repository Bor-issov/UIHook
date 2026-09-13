import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type ClientMessage,
  type ErrorCode,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "@uihook/protocol";
import { type WebSocket, WebSocketServer } from "ws";
import { RequestError } from "./errors.js";
import { handleElementContext } from "./handlers/context.js";
import { acceptSession, listHistory, sessionPatch, undoSession } from "./handlers/history.js";
import { handleVisualEdit } from "./handlers/visual-edit.js";
import { ForbiddenPathError } from "./project/workspace.js";
import type { Services } from "./services.js";

export interface ServerOptions {
  port: number;
  /** Shared secret the extension must present in `session.hello`. */
  token: string;
  /** Exact `Origin` header values allowed to connect, e.g. `chrome-extension://<id>`. */
  allowedOrigins: readonly string[];
}

const HELLO_TIMEOUT_MS = 5_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/**
 * Local WebSocket server. Security layers, in order:
 * 1. bound to 127.0.0.1 only;
 * 2. Host header must be loopback (DNS rebinding);
 * 3. Origin must be an allowlisted extension origin (web pages cannot forge Origin);
 * 4. first message must carry the per-session token;
 * 5. every message is schema-validated; only typed operations exist, nothing executes commands.
 */
export async function startServer(services: Services, options: ServerOptions): Promise<RunningServer> {
  const { logger } = services;
  const authenticated = new Set<WebSocket>();
  const http: Server = createServer((_req, res) => {
    res.writeHead(426, { "content-type": "text/plain" }).end("uihook companion: WebSocket only\n");
  });

  const wss = new WebSocketServer({
    server: http,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: ({ req }: { req: IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void) => {
      const origin = req.headers.origin ?? "";
      const host = (req.headers.host ?? "").replace(/:\d+$/, "");
      if (!LOOPBACK_HOSTS.has(host)) {
        logger.warn("connection.rejected", { reason: "host", host });
        return done(false, 403, "forbidden host");
      }
      if (!options.allowedOrigins.includes(origin)) {
        const hint = /^moz-extension:\/\/[0-9a-f-]{36}$/.test(origin)
          ? `Firefox install with a non-pinned UUID. If this is your UIHook extension, restart the companion with --extension-origin ${origin}`
          : "not an allowlisted extension origin";
        logger.warn("connection.rejected", { reason: "origin", origin, hint });
        return done(false, 403, "forbidden origin");
      }
      done(true);
    },
  });

  wss.on("connection", (socket, req) => {
    const connectionId = randomUUID().slice(0, 8);
    logger.info("connection.open", { connection: connectionId, origin: req.headers.origin });
    const helloTimer = setTimeout(() => socket.close(4401, "authentication timeout"), HELLO_TIMEOUT_MS);
    let removeSink: (() => void) | null = null;

    const send = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const reply = <T extends ServerMessage["type"]>(request: ClientMessage, type: T, payload: Extract<ServerMessage, { type: T }>["payload"]) =>
      send({ v: PROTOCOL_VERSION, id: randomUUID(), replyTo: request.id, type, payload } as ServerMessage);
    const fail = (replyTo: string, code: ErrorCode, message: string) =>
      send({ v: PROTOCOL_VERSION, id: randomUUID(), replyTo, type: "error", payload: { code, message } });

    socket.on("message", async (data, isBinary) => {
      if (isBinary) return socket.close(1003, "binary frames are not supported");
      const parsed = parseClientMessage(data.toString("utf8"));
      if (!parsed.ok) {
        logger.warn("message.invalid", { connection: connectionId, error: parsed.error.slice(0, 300) });
        if (!authenticated.has(socket)) return socket.close(4400, "invalid message");
        return fail("unknown", "bad_request", parsed.error);
      }
      const message = parsed.message;

      if (!authenticated.has(socket)) {
        if (message.type !== "session.hello" || !tokenMatches(message.payload.token, options.token)) {
          logger.warn("connection.unauthorized", { connection: connectionId });
          fail(message.id, "unauthorized", "invalid token");
          return socket.close(4401, "unauthorized");
        }
        clearTimeout(helloTimer);
        authenticated.add(socket);
        removeSink = services.hub.add({ send: (raw) => socket.readyState === socket.OPEN && socket.send(raw) });
        logger.info("connection.authenticated", { connection: connectionId, client: message.payload.client });
        return reply(message, "session.ready", { project: services.project, protocol: PROTOCOL_VERSION });
      }

      try {
        await dispatch(message);
      } catch (error) {
        if (error instanceof RequestError) return fail(message.id, error.code, error.message);
        if (error instanceof ForbiddenPathError) {
          logger.warn("path.forbidden", { connection: connectionId, error: error.message });
          return fail(message.id, "forbidden_path", error.message);
        }
        logger.error("request.failed", { connection: connectionId, type: message.type, error: (error as Error).stack ?? String(error) });
        fail(message.id, "internal", "internal error; see companion logs");
      }
    });

    const broadcastHistory = () => services.hub.broadcast("history.changed", { sessions: listHistory(services) });

    async function dispatch(message: ClientMessage) {
      logger.debug("request", { connection: connectionId, type: message.type });
      switch (message.type) {
        case "session.hello":
          return fail(message.id, "bad_request", "already authenticated");
        case "element.context.request":
          return reply(message, "element.context.response", await handleElementContext(services, message.payload));
        case "edit.visual.request": {
          const result = await handleVisualEdit(services, message.payload);
          reply(message, "edit.visual.result", result);
          if (result.status === "applied") broadcastHistory();
          return;
        }
        case "git.diff.request":
          return reply(message, "git.diff.response", { sessionId: message.payload.sessionId, patch: sessionPatch(services, message.payload.sessionId) });
        case "history.list":
          return reply(message, "history.state", { sessions: listHistory(services) });
        case "history.undo": {
          const sessions = await undoSession(services, message.payload.sessionId);
          reply(message, "history.state", { sessions });
          return broadcastHistory();
        }
        case "history.accept": {
          const sessions = acceptSession(services, message.payload.sessionId);
          reply(message, "history.state", { sessions });
          return broadcastHistory();
        }
        case "agent.list":
          return reply(message, "agent.list.response", { agents: await services.registry.list({ fresh: true }) });
        case "agent.login.start":
          return reply(message, "agent.login.started", { agentId: message.payload.agentId, message: services.logins.start(message.payload.agentId) });
        case "agent.login.input":
          services.logins.input(message.payload.agentId, message.payload.text);
          return reply(message, "ok", {});
        case "agent.login.cancel":
          services.logins.cancel(message.payload.agentId);
          return reply(message, "ok", {});
        case "edit.agent.request":
          return reply(message, "edit.agent.accepted", await services.runs.start(message.payload));
        case "edit.agent.cancel":
          services.runs.cancel(message.payload.runId);
          return reply(message, "ok", {});
      }
    }

    socket.on("close", () => {
      removeSink?.();
      clearTimeout(helloTimer);
      authenticated.delete(socket);
      logger.info("connection.closed", { connection: connectionId });
    });
    socket.on("error", (error) => logger.warn("connection.error", { connection: connectionId, error: error.message }));
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, "127.0.0.1", () => resolve());
  });

  return {
    port: (http.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
