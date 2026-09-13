# Fix Registry

## [2026-09-13] pnpm 12 native binary missing
- Fix: `node ~/.local/lib/node_modules/pnpm/install.js` to fetch native binary.

## [2026-09-13] pnpm 12 blocked esbuild postinstall
- Fix: single `allowBuilds: { esbuild: true }` block in `pnpm-workspace.yaml`.

## [2026-09-13] Vitest workspace condition resolution
- Fix: in `vitest.config.ts` set `resolve.conditions` and `ssr.resolve.conditions` (plus `externalConditions`) to include `@uihook/source`.

## [2026-09-13] TS2882 CSS side-effect import
- Fix: add `src/**/vite-env.d.ts` with `/// <reference types="vite/client" />`.

## [2026-09-13] Firefox content script sender check
- Fix: accept messages when `sender.id === runtime.id` and `sender.url` starts with `runtime.getURL("")`.

## [2026-09-13] Firefox E2E driver
- Fix: stock Firefox via Puppeteer (BiDi) for web pages; RDP `installTemporaryAddon` + watcher `watchTargets(frame)` + console `evaluateJSAsync` for extension documents; open panel via `browser.tabs.create` from background.

## [2026-09-13] dev orchestrator
- Fix: web-ext path `apps/extension/node_modules/.bin/web-ext`; pre-create `.uihook/profiles`; kill children on SIGINT/SIGTERM/exit; handle child `error` events.

## [2026-09-13] Control characters in source
- Fix: build ANSI patterns with `String.fromCharCode(27)`; never embed raw ESC bytes.

## [2026-09-13] Duplicate agent summary
- Fix: hide summary when an identical `message` event is already in the run log.
