# UIHook

Edit your real application visually inside the browser while your existing coding agent handles the code.

The browser provides visual intent. The source code remains the source of truth.

## Supported browsers

- Chrome (116+) and other Chromium browsers loading unpacked MV3 extensions
- Firefox (142+)

Both run the same content script, panel UI, protocol and companion. Only the panel host differs:
Chrome side panel vs Firefox sidebar.

## Setup

```bash
pnpm install
pnpm e2e:setup   # optional: browsers for automated tests and dev launch
```

Add the Vite plugin to your app (`uihook()` before `react()`):

```ts
import { uihook } from "@uihook/instrument/vite";
plugins: [uihook(), react(), tailwindcss()]
```

## Chrome development

```bash
pnpm dev:chrome
```

Starts the extension watch build (`apps/extension/dist/chrome`), companion on `127.0.0.1:4317`, the demo app on
`:5173` (reused if already running) and Playwright Chromium with the extension. Click the UIHook toolbar icon, pair
with port `4317` and the token printed in the terminal. After a rebuild, reload the extension in `chrome://extensions`.

Use your own Chrome instead: `pnpm dev:chrome --no-launch`, then `chrome://extensions` > Developer mode > Load unpacked > `apps/extension/dist/chrome`.

## Firefox development

```bash
pnpm dev:firefox
```

Same processes, plus Firefox through `web-ext run` (system `firefox`, `UIHOOK_FIREFOX`, or the stock build from
`pnpm e2e:setup`). The add-on reloads automatically on rebuild. Open the sidebar with the toolbar button or `Alt+Shift+U`.

## Firefox manual installation

1. `pnpm build:firefox`
2. `about:debugging#/runtime/this-firefox` > Load Temporary Add-on > `apps/extension/dist/firefox/manifest.json`
3. Open your localhost app, open the UIHook sidebar, click "Allow localhost access" if shown, reload the app tab.
4. Start the companion allowing this install's origin (shown in the sidebar when pairing fails):
   ```bash
   pnpm dev:companion --extension-origin moz-extension://<uuid>
   ```

Temporary add-ons are removed when Firefox restarts.

## AI agents

UIHook sends semantic changes to the coding agent you already use. Nothing is proxied through UIHook servers and
UIHook never sees your credentials.

| Provider | CLI | Login from the panel | Edit permissions |
| --- | --- | --- | --- |
| Claude Code | `claude` | "Log in with Claude" runs `claude auth login` | `acceptEdits`, file tools only; Bash/Web tools denied |
| Codex | `codex` | "Log in with ChatGPT" runs `codex login` | `codex exec --sandbox workspace-write` |
| Gemini CLI | `gemini` | Manual: run `gemini`, choose "Login with Google" (or set `GEMINI_API_KEY`) | `--approval-mode auto_edit` |

Flow: connect the panel, pick a provider (the panel asks you to log in if none is), select an element, type a
request under "Ask agent", Send. The companion builds a structured task (selected JSX, nearby code, parents,
computed styles, Git state; page text fenced as untrusted), snapshots the project, runs the CLI in the project
root and records every changed, created or deleted file as one history entry with a diff and Undo. Visual edits
the deterministic engine refuses offer "Ask agent instead". The in-page toolbar "Ask AI" focuses the prompt.

Real-agent smoke test (uses your quota): `pnpm smoke:agent --agent claude` (or `codex`, `gemini`).



```bash
pnpm build:chrome      # apps/extension/dist/chrome
pnpm build:firefox     # apps/extension/dist/firefox
pnpm package:chrome    # apps/extension/artifacts/uihook-chrome-<version>.zip
pnpm package:firefox   # web-ext lint + apps/extension/artifacts/uihook-firefox-<version>.zip
```

## Extension identities

Defined in `packages/protocol/src/extension-identity.ts`:

- Chrome ID `dkaiipifgcpinbcifdkfgilclkjdmkom`, pinned by the public key in `apps/extension/extension-key.json`.
- Firefox add-on ID `uihook@uihook.dev` (`browser_specific_settings.gecko.id`).
- Firefox dev UUID `9096d939-9e7f-4a10-b2e5-b2437dc0f17d`, applied through the `extensions.webextensions.uuids`
  preference by `pnpm dev:firefox` and the E2E suite.

The companion allowlists exactly those two origins. Add others with `--extension-origin` (repeatable) or
`UIHOOK_EXTENSION_ORIGINS`. Wildcards and web origins are rejected.

## Checks

```bash
pnpm typecheck
pnpm test          # unit + WebSocket integration
pnpm e2e           # Chromium + Firefox, same scenario (see docs/browser-testing.md)
```

## Layout

| Path | Role |
| --- | --- |
| `apps/extension/src/platform` | Browser shells: `chrome.ts` (side panel), `firefox.ts` (sidebar), `ext.ts` namespace |
| `apps/extension/src/manifest.ts` | Shared manifest + Chrome/Firefox overrides |
| `apps/extension/src/{content,background,sidepanel}` | Shared overlay, background routing, panel UI |
| `apps/companion` | Local Node server: auth, file access, edits, history |
| `packages/protocol` | Zod message schemas and extension identities |
| `packages/instrument` | Dev-only JSX source metadata injection (Vite plugin) |
| `packages/ast-editor` | AST-located Tailwind class edits with safe refusal |
| `packages/git-engine` | Edit transactions (file and snapshot based), diffs, conflict-aware undo |
| `packages/agent-sdk` | `CodingAgent` interface, Claude Code / Codex / Gemini CLI adapters, process runner |
| `packages/context-engine` | Structured agent task from selection + source context |
| `examples/react-vite-demo` | Demo app |

## Known limitations

- Firefox: the in-page toolbar "Inspect" button cannot open the sidebar. Firefox only allows `sidebarAction.open()`
  from a user action handled by the extension itself; the page shows a notice pointing to the toolbar button / `Alt+Shift+U`.
- Firefox: the sidebar is per window and follows the active tab; Chrome's side panel behaves the same with the current configuration.
- Firefox: installs outside `pnpm dev:firefox` get a random extension UUID and must be allowlisted with `--extension-origin`.
- Firefox: host permissions may need a one-time grant ("Allow localhost access").
- Firefox lint reports 3 warnings from bundled libraries (React `innerHTML`, zod's `Function` capability probe). No errors.
- Native side panel / sidebar chrome is not automated; E2E drives the same panel document hosted in a tab and asserts host registration.
- Next.js instrumentation is not implemented yet (Vite only).
- Agents: one run at a time; visual edits and undo wait until it finishes. Runs time out after 15 minutes.
- Agents run with your own CLI configuration (hooks, instructions, model settings apply).
- Codex's workspace-write sandbox can run shell commands inside the project (no network); Claude runs without shell tools.
- Gemini login cannot be started from the panel (interactive terminal flow). The Gemini adapter is covered by fixture tests; it was not run against a live Gemini account here.
- Agent undo covers files Git lists (or a filtered walk without Git); `.env*`, `node_modules`, `.git` and build output are outside the snapshot. Projects above 128MB / 20k files are refused rather than run without undo.
- Screenshots are not yet attached to agent tasks.
