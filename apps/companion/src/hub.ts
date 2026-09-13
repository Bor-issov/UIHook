import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION, type ServerMessage } from "@uihook/protocol";

interface Sink {
  send(raw: string): void;
}

type BroadcastType = "history.changed" | "agent.login.progress" | "edit.agent.progress" | "edit.agent.result";

/** Fan-out of unsolicited messages to every authenticated connection. */
export class Hub {
  private readonly sinks = new Set<Sink>();

  add(sink: Sink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  broadcast<T extends BroadcastType>(type: T, payload: Extract<ServerMessage, { type: T }>["payload"]): void {
    const raw = JSON.stringify({ v: PROTOCOL_VERSION, id: randomUUID(), type, payload });
    for (const sink of this.sinks) sink.send(raw);
  }
}
