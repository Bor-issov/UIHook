# Features

## Changelog

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
- [ ] M2 Claude Code adapter: context-engine + agent-sdk, `edit.agent.*`, agent transactions via Git change detection
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
