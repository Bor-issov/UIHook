# Browser testing workflow

The same product runs in two browser shells. Only the panel host differs:

| | Chrome | Firefox |
| --- | --- | --- |
| Panel host | `chrome.sidePanel` (`side_panel`) | `sidebarAction` (`sidebar_action`) |
| Background | MV3 service worker | MV3 event page (`background.scripts`) |
| Open panel | Toolbar icon | Toolbar button or `Alt+Shift+U` |
| Extension origin | `chrome-extension://dkaiipifgcpinbcifdkfgilclkjdmkom` (pinned by manifest `key`) | `moz-extension://<per-profile UUID>` (pinned to `9096d939-…` in dev profiles) |

## Automated

```bash
pnpm e2e:setup      # once: Playwright Chromium + stock Firefox (downloaded to ~/.cache/uihook-browsers)
pnpm build          # packages, companion, both extension builds
pnpm e2e            # Chromium and Firefox, same scenario
pnpm e2e:chrome
pnpm e2e:firefox
```

`scripts/e2e/scenario.mjs` is the single scenario. Drivers in `scripts/e2e/browsers.mjs`:

- Chromium: Playwright persistent context with the unpacked extension.
- Firefox: stock Firefox via Puppeteer (WebDriver BiDi) for the app page, and the Firefox Remote Debugging
  Protocol (`scripts/e2e/firefox-rdp.mjs`) to install the temporary add-on and drive the panel document.
  Playwright's patched Firefox cannot control extension documents, and BiDi refuses `moz-extension://` navigation.

The panel is opened as an extension tab bound to the app tab (`sidepanel.html?tabId=N`), so the exact shared UI is
exercised. The native host registration is asserted separately (`sidePanel.getOptions` / `sidebarAction.getPanel`).

## Manual (Firefox)

1. `pnpm dev:firefox` starts the extension watch build, companion, demo app (reused if `:5173` is up) and Firefox via `web-ext` with a persistent dev profile in `.uihook/profiles/firefox`.
   Manual alternative: `pnpm build:firefox`, then `about:debugging#/runtime/this-firefox` > Load Temporary Add-on > `apps/extension/dist/firefox/manifest.json`.
2. Open `http://localhost:5173`.
3. Open the sidebar: toolbar button or `Alt+Shift+U`.
4. If the sidebar shows "Allow localhost access", click it and reload the app tab.
5. Pair: port `4317`, token from the terminal (`.uihook/dev-token` for `pnpm dev:*`).
   Temporary add-ons loaded outside `pnpm dev:firefox` get a random UUID. The sidebar error and the companion log
   (`connection.rejected`) print the exact origin; restart the companion with `--extension-origin moz-extension://<uuid>`.
6. Start editing, hover a card (outline + label), click it.
7. Sidebar shows `src/components/budgets/BudgetCard.tsx:16`, computed padding `24px`, classes incl. `p-6`.
8. Set Padding to `16`, Enter.
9. `BudgetCard.tsx` now contains `p-4`; the page updates through HMR; the sidebar padding reads `16px`.
10. History shows the diff (`-p-6` / `+p-4`).
11. Undo: source restored byte for byte, page back to `24px`.
12. Agent: under "AI provider", log in (or confirm "Logged in"), select the card again, type
    "Make this card denser" under "Ask agent", Send.
13. The run log shows progress; the result says "Changes applied"; the page updates through HMR.
14. History shows the agent entry with its diff; Undo restores every file it touched.

Automated E2E covers steps 12-14 in both browsers with a deterministic fake agent
(`scripts/e2e/fake-agent-companion.ts`). Real providers: `pnpm smoke:agent --agent claude|codex|gemini`.

## Manual (Chrome)

Same steps with `pnpm dev:chrome` (Playwright Chromium with the extension and a profile in `.uihook/profiles/chrome`),
or `pnpm build:chrome` + `chrome://extensions` > Load unpacked > `apps/extension/dist/chrome`. Open the side panel from the toolbar icon.
