# Installing and testing the UIHook extension

How to build the extension, load it into Chrome and Firefox, pair it with the companion, and check that it works.
For the automated E2E suite and the full manual scenario, see [browser-testing.md](browser-testing.md).

## Requirements

- Node >= 22, pnpm 12
- Chrome / Chromium >= 116
- Firefox >= 142
- Git (the companion tracks edits against the project's Git baseline)

```bash
pnpm install
pnpm build:packages   # workspace packages, needed once before the first extension build
```

## Moving parts

| Piece | What it does | Default |
| --- | --- | --- |
| Extension | Overlay on the page + side panel (Chrome) / sidebar (Firefox) | built to `apps/extension/dist/<browser>` |
| Companion | Local WebSocket server that reads and edits source files | `ws://127.0.0.1:4317` |
| App | Dev server of the project being edited, instrumented with `uihook()` | `http://localhost:5173` (demo) |

The extension only runs on `http://localhost/*` and `http://127.0.0.1/*`.

## Option A: one command (recommended)

```bash
pnpm dev:chrome
# or
pnpm dev:firefox
```

Starts the extension watch build, the companion, the demo app (reused if `:5173` is already up) and a browser with
the extension loaded. The terminal prints the pairing details:

```
[dev] pair the panel with port 4317 and token <token>  (stored in .uihook/dev-token)
```

The token is stable per checkout, so each browser profile only needs pairing once.

- Chrome: Playwright Chromium with profile `.uihook/profiles/chrome`. After a rebuild, reload the extension in `chrome://extensions`.
- Firefox: `web-ext run` with profile `.uihook/profiles/firefox`. The add-on reloads automatically on every rebuild.

Flags: `--no-launch` (build + companion + app only, load the extension yourself), `--root <project dir>`, `--app-url <url>`.

```bash
pnpm dev:firefox --no-launch
```

## Option B: manual install

### 1. Build

```bash
pnpm build:chrome    # apps/extension/dist/chrome
pnpm build:firefox   # apps/extension/dist/firefox
```

### 2. Start the companion and the app

Two terminals:

```bash
pnpm dev:companion   # prints port + a new random token on every start
pnpm dev:demo        # http://localhost:5173
```

To keep the token fixed between restarts, pass it in:

```bash
UIHOOK_TOKEN=$(cat .uihook/dev-token) pnpm dev:companion
```

### 3a. Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select `apps/extension/dist/chrome`.
4. Pin UIHook to the toolbar (puzzle icon > pin).

The extension ID is pinned by the manifest `key` to `dkaiipifgcpinbcifdkfgilclkjdmkom`, which the companion accepts by
default. No extra flags needed.

After rebuilding: `chrome://extensions` > UIHook > reload icon, then reload the app tab.

### 3b. Load in Firefox (temporary add-on)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...** and select `apps/extension/dist/firefox/manifest.json`.
3. Note the **Internal UUID** shown under UIHook.

Temporary add-ons are removed when Firefox closes. After rebuilding, click **Reload** on the same page.

Firefox gives every install a random UUID, and that UUID is the extension's origin. The companion only accepts the
pinned dev UUID by default, so pick one:

- Restart the companion with the UUID from step 3:
  ```bash
  pnpm dev:companion --extension-origin moz-extension://<internal-uuid>
  ```
- Or pin the UUID before loading the add-on: in `about:config` create the string preference
  `extensions.webextensions.uuids` with the value
  `{"uihook@uihook.dev":"9096d939-9e7f-4a10-b2e5-b2437dc0f17d"}`, then load the add-on. The default allowlist then works.

If the origin is wrong, the sidebar error and the companion log (`connection.rejected`) print the exact origin to allow.

### 3c. Firefox: permanent install (optional)

Release Firefox only installs signed add-ons. For a persistent unsigned install use Firefox Developer Edition, Nightly
or ESR:

1. `about:config` > set `xpinstall.signatures.required` to `false`.
2. Set `extensions.webextensions.uuids` as above (optional, avoids `--extension-origin`).
3. Package: `pnpm package:firefox` (lints and writes `apps/extension/artifacts/uihook-firefox-<version>.zip`).
4. `about:addons` > gear icon > **Install Add-on From File...** > select the zip.

## Pair and smoke test

1. Open `http://localhost:5173`.
2. Open the panel:
   - Chrome: click the UIHook toolbar icon (side panel).
   - Firefox: toolbar button or `Alt+Shift+U` (sidebar).
3. Firefox only: if the sidebar shows **Allow localhost access**, click it, accept, and reload the app tab.
4. Enter port `4317` and the token from the companion terminal. The panel shows the connected project.
5. Start editing (toolbar or `Alt+Shift+S`), hover a card: outline and label appear. Click it.
6. The panel shows `src/components/budgets/BudgetCard.tsx:16`, padding `24px`, classes including `p-6`.
7. Set Padding to `16` and press Enter. The source now has `p-4`, the page updates through HMR.
8. History shows the diff (`-p-6` / `+p-4`). Undo restores the file and the page.
9. Optional, uses real provider quota: under **AI provider** log in, select the card, type
   "Make this card denser" under **Ask agent**, Send. The run log streams, the page updates, and History gets an
   undoable agent entry.

## Using it on your own project

Currently Vite + React + Tailwind CSS 4 (Next.js is on the roadmap).

1. Add the instrument plugin before the React plugin in `vite.config.ts`:
   ```ts
   import { uihook } from "@uihook/instrument/vite";

   export default defineConfig({
     plugins: [uihook(), react(), tailwindcss()],
   });
   ```
2. Start your dev server.
3. Point the companion at the project:
   ```bash
   pnpm dev:chrome --root /path/to/project --app-url http://localhost:3000/
   # or standalone
   pnpm dev:companion --root /path/to/project
   ```

## Automated tests

```bash
pnpm check           # typecheck + unit/integration tests
pnpm e2e:setup       # once: Playwright Chromium + stock Firefox
pnpm build
pnpm e2e             # both browsers
pnpm e2e:chrome
pnpm e2e:firefox
pnpm smoke:agent --agent claude|codex|gemini   # real provider, spends quota
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No overlay on the page | Page must be `localhost` / `127.0.0.1` over `http`. Reload the tab after installing or reloading the extension. Firefox: grant localhost access from the sidebar. |
| Panel says connection rejected (origin) | Firefox UUID not allowlisted. Use `--extension-origin moz-extension://<uuid>` or pin the UUID via `extensions.webextensions.uuids`. |
| Panel says unauthorized | Token mismatch. `pnpm dev:companion` makes a new token on each start; re-pair or use `UIHOOK_TOKEN`. |
| Cannot connect at all | Companion not running, or not on port `4317`. |
| Element has no source location | App is not instrumented. Check `uihook()` is in the Vite plugins and runs before `react()`. |
| Chrome still runs old code | Reload the extension in `chrome://extensions`, then reload the app tab. |
| Firefox add-on gone after restart | Temporary add-ons do not survive restarts. Use `pnpm dev:firefox` (persistent profile) or a permanent install. |
| Firefox refuses the zip | Release Firefox requires signing. Use Developer Edition / Nightly / ESR with `xpinstall.signatures.required = false`. |
