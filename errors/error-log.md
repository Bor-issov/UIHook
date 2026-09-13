# Error Log

## [2026-09-13] pnpm 12 global install: "Exec format error"
- Symptom: `pnpm install` failed with `Exec format error (os error 8)`.
- Context: `npm i -g --prefix ~/.local pnpm@12.4.1` blocked pnpm's install script, leaving a text placeholder instead of the native binary.

## [2026-09-13] pnpm-workspace.yaml duplicate `allowBuilds` key
- Symptom: `duplicate mapping key: allowBuilds`.
- Context: pnpm 12 auto-appended `allowBuilds` placeholder after ERR_PNPM_IGNORED_BUILDS for esbuild; manual append duplicated it.

## [2026-09-13] Vitest cannot resolve workspace package entry
- Symptom: `Failed to resolve entry for package "@uihook/ast-editor"` in companion server test.
- Context: `resolve.conditions` alone did not apply to Vitest's SSR/node environment; `dist` not built.

## [2026-09-13] TS2882 side-effect CSS import
- Symptom: `Cannot find module or type declarations for side-effect import of './styles.css'` (TS 7).
- Context: extension side panel and demo app lacked Vite client types.

## [2026-09-13] Firefox: panel messages ignored by content script
- Symptom: Firefox E2E stuck; panel showed "Content script could not access this page" while background messages worked.
- Cause: content script rejected any sender with `sender.tab`; Firefox sets `sender.tab` for extension pages opened in tabs.

## [2026-09-13] Playwright Firefox cannot drive extension pages
- Symptom: `page.goto("moz-extension://...")` and later evaluations time out (Juggler).

## [2026-09-13] WebDriver BiDi refuses moz-extension navigation
- Symptom: `Navigation to "moz-extension://..." is not allowed in this context`.

## [2026-09-13] Firefox RDP `getTarget` removed
- Symptom: `does not recognize the packet type 'getTarget'` on webExtensionDescriptor (Firefox 155).

## [2026-09-13] dev orchestrator issues
- `spawn node_modules/.bin/web-ext ENOENT` (bin lives in apps/extension).
- web-ext `ENOENT mkdir .uihook/profiles/firefox` (non-recursive mkdir).
- Child processes survived SIGTERM, leaving companion on :4317 (`EADDRINUSE`).

## [2026-09-13] Tool input rejected: raw control characters
- Symptom: shell heredocs containing a literal ESC in an ANSI regex / test string were rejected before execution.

## [2026-09-13] Panel showed agent summary twice
- Symptom: final agent message and run summary rendered as duplicate paragraphs.
