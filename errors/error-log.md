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
