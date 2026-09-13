// Milestone 1 vertical slice, identical for every browser.
import path from "node:path";

const CARD = "src/components/budgets/BudgetCard.tsx";
const OVERVIEW = "src/components/budgets/BudgetOverview.tsx";

export async function visualEditScenario({ browser, env, token, artifacts, assert, log }) {
  const original = env.read(CARD);

  const host = await browser.panelHost();
  assert(String(host.path).endsWith("sidepanel.html"), `shared panel UI registered as ${host.kind} (${host.path})`);

  const app = await browser.openApp(env.appUrl);
  await app.waitForSelector("article");
  assert((await app.attr("article", "data-uihook-src")) === `${CARD}:16:5`, "content page carries injected source metadata");

  const tabId = await browser.evaluateInBackground(`return (await (globalThis.browser ?? chrome).tabs.query({})).find((t) => t.url?.startsWith(${JSON.stringify(env.appUrl)}))?.id;`);
  assert(Number.isInteger(tabId), `extension sees the app tab (${tabId})`);

  const panel = await browser.openPanel(tabId);
  await panel.waitForText("connection", "disconnected");
  assert(!(await panel.text("host-access")), "localhost host permission granted");

  await panel.fill("Port", String(env.companionPort));
  await panel.fill("Token", token);
  await panel.click("Connect");
  await panel.waitForText("connection", "react-vite-demo");
  assert(true, `panel connected to companion from ${browser.extensionOrigin}`);

  await panel.click("Start editing");
  await app.front();
  await clickInside(app, "article", 10, 10);
  await panel.waitForText("location", `${CARD}:16`);
  assert((await panel.text("padding")) === "24px", "panel shows computed padding 24px");
  assert((await panel.text("classes")).includes("p-6"), "panel shows source classes");
  log("selection resolved to source");

  await panel.fill("Padding", "16");
  await panel.press("Padding", "Enter");
  await panel.waitForText("notice", "p-6 -> p-4");
  assert(env.read(CARD) === original.replace("rounded-xl bg-charcoal-raised p-6", "rounded-xl bg-charcoal-raised p-4"), "TSX source changed exactly p-6 -> p-4");
  await app.waitForFunction(() => getComputedStyle(document.querySelector("article")).paddingTop === "16px");
  assert(true, "HMR applied padding 16px in the page");
  await panel.waitForText("padding", "^16px$");
  assert(true, "panel refreshed selection after HMR");

  await panel.waitForSelector('[data-testid="diff"]');
  const patch = await panel.text("diff");
  assert(patch.includes('+    <article className={cn("flex flex-col gap-6 rounded-xl bg-charcoal-raised p-4"'), "diff shows the added line");
  assert(patch.includes('-    <article className={cn("flex flex-col gap-6 rounded-xl bg-charcoal-raised p-6"'), "diff shows the removed line");
  await app.screenshot(path.join(artifacts, `${browser.name}-app-edited.png`));
  await browser.screenshotPanel(path.join(artifacts, `${browser.name}-panel-edited.png`));

  await panel.clickInFirst("history-item", "Undo");
  await panel.waitForSelector('[data-testid="history-item"][data-status="undone"]');
  assert(env.read(CARD) === original, "undo restored the original source");
  await app.waitForFunction(() => getComputedStyle(document.querySelector("article")).paddingTop === "24px");
  await panel.waitForText("padding", "^24px$");
  assert(true, "page and panel reflect the restored padding");

  await panel.click("Stop editing");
  await panel.click("Start editing");
  await app.front();
  const grid = await app.box("section > div.grid");
  await clickInside(app, "section > div.grid", grid.width - 2, 2);
  await panel.waitForText("classes", "sm:grid-cols-2");
  await panel.fill("Padding", "12");
  await panel.press("Padding", "Enter");
  await panel.waitForText("notice", "+p-3");
  assert(env.read(OVERVIEW).includes('className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 p-3"'), "padding class appended to an element without padding");

  assert(app.errors.length === 0, `no page errors ${app.errors.join("; ")}`);
  return { app, panel, tabId };
}

export async function clickInside(app, selector, dx, dy) {
  const box = await app.box(selector);
  await app.move(box.x + dx - 2, box.y + dy - 2);
  await app.move(box.x + dx, box.y + dy);
  await app.click(box.x + dx, box.y + dy);
}

/** Milestone 2 slice: provider login, semantic request, agent edit, HMR, diff, undo. */
export async function agentScenario({ browser, env, panel, app, assert, log }) {
  const original = env.read(CARD);

  await panel.waitForSelector('[data-testid="agent-fake"][data-auth="logged_out"]');
  assert(true, "panel asks to log in with the AI provider");
  await panel.click("Log in with Fake Agent");
  await panel.waitForSelector('[data-testid="agent-summary"]', 15_000);
  const providers = await panel.body();
  assert(providers.includes("Fake Agent") && providers.includes("Logged in"), "provider login completed through the CLI flow");

  await panel.click("Stop editing");
  await panel.click("Start editing");
  await app.front();
  await clickInside(app, "article", 10, 10);
  await panel.waitForText("location", `${CARD}:16`);

  await panel.fill("Agent instruction", "Make this card denser.");
  await panel.click("Send");
  await panel.waitForSelector('[data-testid="agent-run"][data-status="applied"]', 20_000);
  assert(env.read(CARD) === original.replace('"flex flex-col gap-6 rounded-xl', '"flex flex-col gap-3 rounded-xl'), "agent modified the TSX source");
  await app.waitForFunction(() => getComputedStyle(document.querySelector("article")).rowGap === "12px");
  assert(true, `HMR reflected the agent edit in ${browser.name}`);
  assert((await panel.text("agent-run")).includes("Reduced the card gap"), "agent progress and summary shown in panel");

  await panel.waitForSelector('[data-testid="diff"]');
  const patch = await panel.text("diff");
  assert(patch.includes("+    <article className={cn(\"flex flex-col gap-3 rounded-xl"), "agent diff shown");
  await browser.screenshotPanel(path.join(process.env.E2E_ARTIFACTS ?? "/tmp", `${browser.name}-panel-agent.png`));

  await panel.clickInFirst("history-item", "Undo");
  await panel.waitForSelector('[data-testid="history-item"][data-status="undone"]');
  assert(env.read(CARD) === original, "undo restored the source after the agent edit");
  await app.waitForFunction(() => getComputedStyle(document.querySelector("article")).rowGap === "24px");
  log("agent slice verified");
}
