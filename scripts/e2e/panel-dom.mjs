// DOM helpers evaluated inside the extension panel document. The same source runs in Chromium
// (Playwright page.evaluate) and Firefox (remote debugging evaluation), so the scenario is shared.
export const PANEL_HELPERS = String.raw`
  const byTestId = (id) => document.querySelector('[data-testid="' + id + '"]');
  const text = (id) => byTestId(id)?.textContent ?? null;
  const input = (label) => document.querySelector('input[aria-label="' + label + '"], textarea[aria-label="' + label + '"]') ??
    [...document.querySelectorAll("label")].find((l) => l.firstChild?.textContent?.trim() === label)?.querySelector("input");
  const fill = (label, value) => {
    const el = input(label);
    if (!el) throw new Error("no input labelled " + label);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const press = (label, key) => {
    const el = input(label);
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  };
  const buttons = (scope = document) => [...scope.querySelectorAll("button")];
  const click = (name, scope = document) => {
    const button = buttons(scope).find((b) => b.textContent.trim() === name && !b.disabled);
    if (!button) throw new Error("no enabled button " + name + " in " + buttons(scope).map((b) => b.textContent.trim()).join(", "));
    button.click();
  };
`;

/** Wraps panel operations over an evaluator `(body) => Promise<result>`. */
export function panelDriver(evaluate) {
  const run = (body) => evaluate(`${PANEL_HELPERS}\n${body}`);
  const q = JSON.stringify;
  const waitFor = async (description, body, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    for (;;) {
      last = await run(body).catch((error) => `error: ${error.message}`);
      if (last === true) return;
      if (Date.now() > deadline) throw new Error(`panel: timed out waiting for ${description} (last: ${JSON.stringify(last)})`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  return {
    fill: async (label, value) => {
      await waitFor(`enabled input ${label}`, `const el = input(${q(label)}); return !!el && !el.disabled;`);
      return run(`fill(${q(label)}, ${q(value)}); return true;`);
    },
    press: (label, key) => run(`press(${q(label)}, ${q(key)}); return true;`),
    click: async (name) => {
      await waitFor(`enabled button ${name}`, `return buttons().some((b) => b.textContent.trim() === ${q(name)} && !b.disabled);`);
      return run(`click(${q(name)}); return true;`);
    },
    clickInFirst: (testId, name) => run(`click(${q(name)}, byTestId(${q(testId)})); return true;`),
    text: (testId) => run(`return text(${q(testId)});`),
    body: () => run(`return document.body.innerText;`),
    waitForText: (testId, expected, timeoutMs) =>
      waitFor(`${testId} ~ ${expected}`, `const t = text(${q(testId)}); return t !== null && (${q(expected)}.startsWith("^") ? new RegExp(${q(expected)}).test(t) : t.includes(${q(expected)}));`, timeoutMs),
    waitForSelector: (selector, timeoutMs) => waitFor(selector, `return document.querySelector(${q(selector)}) !== null;`, timeoutMs),
  };
}
