import { type FormEvent, useEffect, useState } from "react";
import { ext } from "../../platform/ext";
import { usePanel } from "../store";
import { Button } from "./ui";

export function ConnectForm() {
  const connection = usePanel((s) => s.connection);
  const connect = usePanel((s) => s.connect);
  const [port, setPort] = useState("4317");
  const [token, setToken] = useState("");

  useEffect(() => {
    ext.storage.local.get("companion").then(({ companion }) => {
      const saved = companion as { port?: number; token?: string } | undefined;
      if (saved?.port) setPort(String(saved.port));
      if (saved?.token) setToken(saved.token);
    });
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void connect(Number(port), token.trim());
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg bg-bone/5 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Connect to companion</h2>
        <p className="text-xs text-bone/60">
          Run <code className="font-mono text-bone">pnpm dev:companion</code> in your project and paste the token it prints.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-xs text-bone/60">
        Port
        <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" className="rounded-md bg-bone/10 px-2 py-1.5 font-mono text-bone outline-none" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-bone/60">
        Token
        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" className="rounded-md bg-bone/10 px-2 py-1.5 font-mono text-bone outline-none" />
      </label>
      {connection.status === "disconnected" && connection.error ? <p className="text-xs text-signal">{connection.error}</p> : null}
      <Button variant="primary" type="submit" disabled={connection.status === "connecting" || token.trim().length < 16}>
        {connection.status === "connecting" ? "Connecting" : "Connect"}
      </Button>
    </form>
  );
}
