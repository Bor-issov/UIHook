# Fix Registry

## [2026-09-13] pnpm 12 native binary missing
- Fix: `node ~/.local/lib/node_modules/pnpm/install.js` to fetch native binary.

## [2026-09-13] pnpm 12 blocked esbuild postinstall
- Fix: single `allowBuilds: { esbuild: true }` block in `pnpm-workspace.yaml`.

## [2026-09-13] Vitest workspace condition resolution
- Fix: in `vitest.config.ts` set `resolve.conditions` and `ssr.resolve.conditions` (plus `externalConditions`) to include `@uihook/source`.

## [2026-09-13] TS2882 CSS side-effect import
- Fix: add `src/**/vite-env.d.ts` with `/// <reference types="vite/client" />`.
