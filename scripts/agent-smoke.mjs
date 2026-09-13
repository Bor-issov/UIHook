// Real-agent smoke test (uses your provider quota): companion + real CLI adapter on a temp copy of the
// demo, through the WebSocket protocol. Usage: node scripts/agent-smoke.mjs --agent claude|codex|gemini
import { parseArgs } from "node:util";
import WebSocket from "../apps/companion/node_modules/ws/wrapper.mjs";
import { REPO, startEnvironment } from "./e2e/environment.mjs";

const { values } = parseArgs({ options: { agent: { type: "string", default: "claude" } } });
const TOKEN = "smoke-token-0123456789abcdefghij";
const CARD = "src/components/budgets/BudgetCard.tsx";
const env = await startEnvironment({ token: TOKEN });
const socket = new WebSocket(`ws://127.0.0.1:${env.companionPort}`, { origin: "chrome-extension://dkaiipifgcpinbcifdkfgilclkjdmkom" });
const messages = [];
let seq = 0;
socket.on("message", (d) => messages.push(JSON.parse(String(d))));
await new Promise((r, j) => socket.once("open", r).once("error", j));

const waitFor = (pred, ms = 600_000) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const found = messages.find(pred);
      if (found) return resolve(found);
      if (Date.now() - started > ms) return reject(new Error("timeout"));
      setTimeout(tick, 100);
    };
    tick();
  });
const request = (type, payload) => {
  const id = `s${++seq}`;
  socket.send(JSON.stringify({ v: 1, id, type, payload }));
  return waitFor((m) => m.replyTo === id, 60_000);
};

try {
  await request("session.hello", { token: TOKEN, client: "smoke" });
  const { payload } = await request("agent.list", {});
  for (const a of payload.agents) console.log(`[smoke] ${a.id}: installed=${a.installed} auth=${a.auth}${a.authDetail ? ` (${a.authDetail})` : ""}${a.version ? ` v${a.version}` : ""}`);

  const original = env.read(CARD);
  const selection = {
    source: { file: CARD, line: 16, column: 5 },
    component: "BudgetCard",
    element: { tag: "article", classes: ["flex", "flex-col", "gap-6", "rounded-xl", "bg-charcoal-raised", "p-6"], text: "Housing 92% $1,840 of $2,000" },
    rect: { x: 96, y: 195, width: 254, height: 178 },
    styles: { display: "flex", flexDirection: "column", rowGap: "24px", paddingTop: "24px" },
    instanceCount: 4,
    ancestors: [],
    pageUrl: env.appUrl,
  };
  const accepted = await request("edit.agent.request", { agentId: values.agent, instruction: "Change this card's vertical gap between children from gap-6 to gap-4. Only that class.", selection });
  if (accepted.type === "error") throw new Error(`${accepted.payload.code}: ${accepted.payload.message}`);
  console.log(`[smoke] run ${accepted.payload.runId} started`);

  const shown = new Set();
  const result = await waitFor((m) => {
    for (const p of messages.filter((x) => x.type === "edit.agent.progress")) {
      if (shown.has(p)) continue;
      shown.add(p);
      const e = p.payload.event;
      console.log(`  ${e.kind}: ${(e.text ?? `${e.name} ${e.detail ?? ""}`).slice(0, 160).replace(/\n/g, " ")}`);
    }
    return m.type === "edit.agent.result";
  });
  console.log(`[smoke] result: ${result.payload.status}${result.payload.error ? ` error=${result.payload.error}` : ""}`);
  const after = env.read(CARD);
  console.log(`[smoke] files: ${result.payload.session?.files.map((f) => `${f.file} +${f.additions} -${f.deletions}`).join(", ") ?? "none"}`);
  console.log(`[smoke] source has gap-4: ${after.includes('"flex flex-col gap-4 rounded-xl')}`);
  if (result.payload.session) {
    const undo = await request("history.undo", { sessionId: result.payload.session.id });
    console.log(`[smoke] undo: ${undo.type} restored=${env.read(CARD) === original}`);
  }
  process.exitCode = result.payload.status === "applied" && after.includes("gap-4") ? 0 : 1;
} catch (error) {
  console.error("[smoke] failed:", error.message);
  process.exitCode = 1;
} finally {
  socket.close();
  await env.close();
  process.exit(process.exitCode);
}
