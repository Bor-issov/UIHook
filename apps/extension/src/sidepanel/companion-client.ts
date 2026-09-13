import {
  type ClientMessage,
  type ClientPayload,
  type ProjectInfo,
  parseServerMessage,
  PROTOCOL_VERSION,
  type RequestReplyMap,
  type ServerMessage,
} from "@uihook/protocol";

type Reply<T extends keyof RequestReplyMap> = Extract<ServerMessage, { type: RequestReplyMap[T] }>;

export class CompanionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Typed request/response client for the local companion. Every inbound frame is schema-validated
 * before it reaches UI state.
 */
export class CompanionClient {
  private readonly pending = new Map<string, { resolve: (m: ServerMessage) => void; reject: (e: Error) => void; timer: number }>();
  private socket: WebSocket | null = null;
  private seq = 0;

  constructor(
    private readonly handlers: {
      onBroadcast: (message: ServerMessage) => void;
      onClose: (reason: string) => void;
    },
  ) {}

  async connect(port: number, token: string): Promise<ProjectInfo> {
    this.disconnect();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new CompanionError("unreachable", `companion not reachable on port ${port}`)), { once: true });
    });

    socket.addEventListener("message", (event) => this.onMessage(String(event.data)));
    socket.addEventListener("close", (event) => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new CompanionError("closed", "connection closed"));
      }
      this.pending.clear();
      if (this.socket === socket) {
        this.socket = null;
        this.handlers.onClose(event.reason || `closed (${event.code})`);
      }
    });

    const ready = await this.request("session.hello", { token, client: "uihook-extension" });
    return ready.payload.project;
  }

  disconnect() {
    this.socket?.close(1000, "client disconnect");
    this.socket = null;
  }

  request<T extends keyof RequestReplyMap>(type: T, payload: ClientPayload<T>): Promise<Reply<T>> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new CompanionError("closed", "not connected"));
    const id = `r${++this.seq}`;
    const message = { v: PROTOCOL_VERSION, id, type, payload } as ClientMessage;

    return new Promise<Reply<T>>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new CompanionError("timeout", `${type} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        timer,
        reject,
        resolve: (reply) => {
          if (reply.type === "error") reject(new CompanionError(reply.payload.code, reply.payload.message));
          else resolve(reply as Reply<T>);
        },
      });
      socket.send(JSON.stringify(message));
    });
  }

  private onMessage(raw: string) {
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) {
      console.warn("[uihook] dropped invalid companion message", parsed.error);
      return;
    }
    const message = parsed.message;
    if ("replyTo" in message) {
      const entry = this.pending.get(message.replyTo);
      if (!entry) return;
      this.pending.delete(message.replyTo);
      clearTimeout(entry.timer);
      entry.resolve(message);
      return;
    }
    this.handlers.onBroadcast(message);
  }
}
