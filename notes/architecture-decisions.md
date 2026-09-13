# Architecture Decisions

## ADR-001 [2026-09-13] Monorepo layout
- pnpm workspace: `apps/extension`, `apps/companion`, `packages/{protocol,instrument,ast-editor,git-engine}`, `examples/react-vite-demo`.
- `source-resolver` not a package: resolution splits naturally between build-time `instrument` (writes metadata) and companion `handlers/context.ts` (reads + validates). Extract when a second strategy (source maps, fiber) lands.
- `context-engine` and `agent-sdk` deferred to milestone 2; not created empty.
- Packages export `@uihook/source` condition pointing at `src/*.ts` (tsx, vitest, esbuild, vite use it) and `dist` for plain Node.

## ADR-002 [2026-09-13] Source resolution = compile-time injection
- Vite plugin (`enforce: "pre"`, `apply: "serve"`) parses original TSX with @babel/parser, injects `data-uihook-src="file:line:col"` + `data-uihook-component` via magic-string (source maps preserved).
- Host (lowercase) elements only. Components may not forward unknown props.
- Paths project-relative (never absolute paths in DOM). Plugin root must equal companion root.
- Parser config shared between instrument and ast-editor so positions agree.
- Production builds verified to contain zero attributes.
- Future chain: injected metadata -> source maps -> React fiber (main-world script) -> AST heuristics -> agent.

## ADR-003 [2026-09-13] Deterministic editing: AST-located literal splicing
- Locate JSXOpeningElement by exact line/col + tag check. Edit only the inner range of class string literals. Rest of file byte-identical; output re-parsed as a guard.
- Supported sites: `className="..."`, `{"..."}`, template without expressions, `cn/clsx/classNames/cx/twMerge/twJoin(...)` string args. Absent className inserted only when no spread props.
- Refuse (route to agent) on: same-property variants (`md:`, `hover:`), conditional literals, `!important`, unresolvable values, logical radius, spread after className, runtime className.
- Browser computed values verify source classes are in effect (tolerance 0.5px). Mismatch = refuse. Catches parent `className` overrides, cva output, CSS.
- New token placed after kept lower-precedence tokens so tailwind-merge keeps it.
- Recast rejected: slower, reformats. Regex rejected: unsafe.

## ADR-004 [2026-09-13] Transactions = pre-image snapshots, Git for baseline
- `EditTransaction.track(file)` captures pre-image before writing; commit builds unified diff (jsdiff).
- Undo: exact pre-image if file still equals post-image; else reverse patch; else `conflict`. All-or-nothing across files.
- Git records HEAD and per-file porcelain status before edits. No commits, no stash, no index changes.
- Works without Git. `SessionStore` interface for later persistence (`.uihook/sessions`).
- Source mutations serialised by a companion mutex. Optimistic concurrency via content hash from context response.

## ADR-005 [2026-09-13] Security boundaries
- Companion binds 127.0.0.1. Host header must be loopback (DNS rebinding). Origin must equal allowlisted `chrome-extension://<id>`.
- Extension ID pinned through manifest `key` (`apps/extension/extension-key.json`), so default allowlist works for unpacked dev builds.
- Per-run random token (24 bytes) sent in first `session.hello`, compared in constant time; 5s auth timeout.
- Every frame Zod-validated, 512KB cap. No command execution message exists.
- Workspace: relative POSIX paths only, deny `..`, dotfiles, node_modules/.git/dist/.next, source extensions only, realpath confinement, O_NOFOLLOW writes, 2MB cap.
- Extension: content scripts only on localhost/127.0.0.1, isolated world, no postMessage listeners, `isTrusted` checks on clicks/keys, sender.id checks, panel CSP `connect-src ws://127.0.0.1:* ws://localhost:*`.
- Page-supplied metadata is untrusted data: can only point at confined source files, edits require user action in extension UI.

## ADR-006 [2026-09-13] Extension connection owner = side panel
- WebSocket lives in side panel page (lifetime = while user is editing). MV3 service worker stays thin (panel open, commands).
- `CompanionClient` isolated so moving to offscreen document/service worker later is local.
- Side panel: React 19 + Tailwind v4 + Zustand. TanStack Query skipped: request/response over WebSocket with broadcasts does not fit its cache model yet.

## ADR-007 [2026-09-13] Firefox support via thin platform layer (no WXT)
- Chrome API surface was ~20 call sites in 6 files; only `sidePanel` differs semantically. WXT migration rejected: rewrites build + entrypoints for no functional gain.
- `src/platform/ext.ts`: `browser ?? chrome` promise namespace for shared code.
- `src/platform/{chrome,firefox}.ts` implement `PlatformHost` (install panel host, open panel). Selected at build time via alias `@uihook/platform-host`; no runtime browser checks in product code.
- `src/manifest.ts`: shared manifest + overrides. Chrome: `key`, `side_panel`, service worker. Firefox: `gecko.id`, `sidebar_action`, `background.scripts`, `_execute_sidebar_action`.
- Output `dist/chrome`, `dist/firefox`. Same `sidepanel.html` for both hosts.
- Companion unchanged except allowlist: exact `moz-extension://<uuid>` origins only; dev UUID pinned via `extensions.webextensions.uuids`.
- Content script accepts messages only from extension documents (`sender.url` under `runtime.getURL("")`), replacing a `sender.tab` check that broke tab-hosted panels in Firefox.
- E2E: one scenario, two drivers. Firefox uses stock Firefox + BiDi (app page) + RDP (add-on install and panel document).

## ADR-008 [2026-09-13] Agents are local CLIs; login is the provider's own flow
- No API keys or OAuth handled by UIHook. `detect()` asks the CLI (`claude auth status --json`, `codex login status`) or checks credential file existence (Gemini) without reading contents.
- Login from panel spawns the adapter's fixed login argv; output relayed; only https URLs on provider hosts become links; optional code input goes to that process only. Gemini login is manual (interactive TUI).
- Runs: fixed argv per adapter, prompt on stdin (Gemini: `-p`), cwd = project root, `UIHOOK_*` env removed, process-group kill on cancel/timeout.
- Permission posture: Claude `acceptEdits` + file tools, shell/web denied; Codex `workspace-write` sandbox; Gemini `auto_edit`.
- Transactions: agent edits unknown files -> snapshot (git ls-files or walk, project policy) before, diff after. Failed/cancelled runs with edits still produce an undoable session.
- One active run; visual edits and undo return `busy` meanwhile.
- Context engine prompt: user request trusted; page-derived text in a dynamically sized fence marked untrusted.
