# UIHook

Edit your real application visually inside the browser while your existing coding agent handles the code.

The browser provides visual intent. The source code remains the source of truth.

## Quick start (milestone 1)

```bash
pnpm install
pnpm build                      # packages, companion, extension
pnpm dev:demo                   # React/Vite demo on :5173 (skip if already running)
pnpm dev:companion              # prints port + pairing token
```

1. Chrome -> `chrome://extensions` -> Developer mode -> Load unpacked -> `apps/extension/dist`.
2. Open `http://localhost:5173`, click the UIHook toolbar icon to open the side panel.
3. Paste the token, Connect, Start editing, click an element, change Padding.

Own app (Vite + React + Tailwind):

```ts
// vite.config.ts - uihook() must come before react()
import { uihook } from "@uihook/instrument/vite";
plugins: [uihook(), react(), tailwindcss()]
```

Run the companion from the same directory as `vite.config.ts` (`--root` overrides).

## Layout

| Path | Role |
| --- | --- |
| `apps/extension` | MV3 extension: overlay content script, side panel, service worker |
| `apps/companion` | Local Node server: auth, file access, edits, history |
| `packages/protocol` | Zod message schemas shared by both sides |
| `packages/instrument` | Dev-only JSX source metadata injection (Vite plugin) |
| `packages/ast-editor` | AST-located Tailwind class edits with safe refusal |
| `packages/git-engine` | Edit transactions, diffs, conflict-aware undo |
| `examples/react-vite-demo` | Demo app |

## Checks

```bash
pnpm typecheck
pnpm test        # unit + WebSocket integration
pnpm e2e         # Chromium + extension + Vite + companion, on a temp copy of the demo
```

Decisions: `notes/architecture-decisions.md`. Roadmap: `notes/features.md`.
