// Test-only companion entry: the real companion with a deterministic agent adapter, so the agent
// vertical slice (login, context, run, snapshot, diff, undo) is exercised without a paid model.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { AgentRunEvent, CodingAgent } from "../../packages/agent-sdk/src/index.ts";
import { startCompanion } from "../../apps/companion/src/app.ts";
import { createLogger } from "../../apps/companion/src/logger.ts";

const { values } = parseArgs({ options: { root: { type: "string" }, port: { type: "string", default: "0" }, json: { type: "boolean" } }, strict: false });
const flag = path.join(mkdtempSync(path.join(tmpdir(), "uihook-fake-login-")), "logged-in");

const loginScript = `
  console.log("Opening browser to sign in...");
  console.log("If it does not open, visit https://claude.ai/oauth/authorize?client=uihook-e2e");
  setTimeout(() => { require("fs").writeFileSync(${JSON.stringify(flag)}, "1"); console.log("Login successful."); }, 300);
`;

const fakeAgent: CodingAgent = {
  id: "fake",
  name: "Fake Agent",
  installHint: "bundled with the E2E suite",
  loginMethod: { kind: "command", label: "Log in with Fake Agent", display: "fake-agent login" },
  loginCommand: { command: process.execPath, args: ["-e", loginScript] },
  detect: async () => ({ installed: true, version: "0.0.1", auth: existsSync(flag) ? "logged_in" : "logged_out" }),
  async *run({ prompt, cwd }): AsyncIterable<AgentRunEvent> {
    yield { kind: "status", text: "Fake agent reading the task" };
    const match = /File: (.+)\n/.exec(prompt);
    if (!match || !prompt.includes("## USER REQUEST")) return yield { kind: "done", ok: false, error: "task is missing structured context" };
    const file = path.join(cwd, match[1]!);
    yield { kind: "tool", name: "Edit", detail: match[1]! };
    writeFileSync(file, readFileSync(file, "utf8").replace('"flex flex-col gap-6 rounded-xl', '"flex flex-col gap-3 rounded-xl'));
    yield { kind: "message", text: "Reduced the card gap from gap-6 to gap-3." };
    yield { kind: "done", ok: true, summary: "Reduced the card gap from gap-6 to gap-3." };
  },
};

const logger = createLogger({ json: values.json === true });
const { services, server } = await startCompanion({
  root: String(values.root),
  port: Number(values.port),
  token: process.env.UIHOOK_TOKEN!,
  allowedOrigins: ["chrome-extension://dkaiipifgcpinbcifdkfgilclkjdmkom", "moz-extension://9096d939-9e7f-4a10-b2e5-b2437dc0f17d"],
  logger,
  agents: [fakeAgent],
});
logger.info("[e2e] fake-agent companion - listening", { url: `ws://127.0.0.1:${server.port}`, root: services.workspace.root });
process.on("SIGTERM", () => void server.close().then(() => process.exit(0)));
