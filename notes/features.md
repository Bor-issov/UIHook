# Features

## Changelog

### [v0.3] 2026-09-13 - Milestone 2: AI agents (branch feat/ai-agents, based on feat/firefox-support)
- `packages/agent-sdk`: CodingAgent interface; Claude Code, Codex, Gemini CLI adapters; process runner (no shell, env scrubbed of UIHOOK_*, process-group kill).
- `packages/context-engine`: structured task prompt with untrusted page data fenced.
- `git-engine`: SnapshotTransaction for agent edits (modified/created/deleted), size limits.
- Companion: agent registry, provider login manager (CLI login, allowlisted URLs, code input), run manager (single run, cancel, timeout, busy guard), broadcast hub, project workspace policy.
- Panel: AI provider card with login, Ask agent prompt, run log, cancel, "Ask agent instead" on refused visual edits; toolbar Ask AI enabled.
- Tests: 108 unit/integration; E2E agent slice in Chromium + Firefox; real Claude and Codex smoke runs verified.

### [v0.2] 2026-09-13 - Firefox support (branch feat/firefox-support)
- Platform layer: `ext` namespace, Chrome side panel host, Firefox sidebar host.
- Manifest generator with Chrome/Firefox overrides; `dist/chrome`, `dist/firefox`.
- Companion: Firefox extension origins, `--extension-origin`, rejection hints.
- Panel: host-permission grant flow, origin-aware connection errors; page toast when the browser refuses to open the panel.
- Commands: `dev:chrome`, `dev:firefox`, `build:*`, `package:*`, `e2e`, `e2e:chrome`, `e2e:firefox`, `e2e:setup`.
- Tests: 82 unit/integration; shared E2E passes in Chromium and Firefox.

### [v0.1] 2026-09-13 - Milestone 1: visual edit loop (branch feat/visual-edit-loop)
- Protocol: Zod schemas for extension <-> companion messages, selection, context, visual edits, history.
- Instrument: Vite plugin injects `data-uihook-src` / `data-uihook-component` in dev only.
- AST editor: Tailwind padding / padding X/Y / margin (+X/Y) / gap (+X/Y) / radius edits with safe refusal.
- Git engine: edit transactions, unified diffs, conflict-aware undo, accept, Git baseline.
- Companion: localhost WebSocket, origin + host + token auth, path confinement, context + edit + history handlers.
- Extension (MV3): hover/select overlay in closed shadow DOM, floating toolbar, side panel with element info, controls, source snippet, diff, history.
- Demo: `examples/react-vite-demo` (React 19, Vite 8, Tailwind 4).
- Tests: 66 unit/integration (vitest) + Chromium E2E (`pnpm e2e`).

## Roadmap
- [x] M1 visual edit loop
- [x] Firefox support
- [x] M2 agents (Claude Code, Codex, Gemini) with provider login: context-engine + agent-sdk, `edit.agent.*`, agent transactions via Git change detection
- [ ] Area selection
- [ ] Screenshots for agent tasks
- [ ] Next.js instrumentation (webpack loader / SWC)
- [ ] Theme-aware scales (read `@theme` `--spacing`, `--radius-*`)

## Tech stack
- pnpm 12 workspace, TypeScript 7 (strict, NodeNext), Node >= 22
- Zod 4, ws 8, @babel/parser 8, magic-string, jsdiff 9
- Vite 8, React 19, Tailwind CSS 4, Zustand 5, esbuild
- Vitest 5, Playwright 1.63 (Chromium)

## File map
- `packages/protocol/src/{primitives,selection,edits,context,messages,extension}.ts`
- `packages/instrument/src/{instrument,vite,attributes,component-name}.ts`
- `packages/ast-editor/src/{visual-edit,inspect,class-site,locate}.ts`, `tailwind/{families,mutate,tokens}.ts`
- `packages/git-engine/src/{history,session,patch,git}.ts`
- `apps/companion/src/{cli,app,server}.ts`, `handlers/*`, `project/{workspace,detect}.ts`
- `apps/extension/src/content/{index,overlay,collect}.ts`, `src/sidepanel/{App,store,companion-client,tab-bridge}.tsx?`, `src/background.ts`
- `scripts/e2e.mjs`
- `docs/extension-setup.md` (install + test guide), `docs/browser-testing.md`
