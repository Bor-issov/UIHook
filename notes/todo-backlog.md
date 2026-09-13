# Todo Backlog

## Next (Milestone 2: Claude Code adapter)
- [ ] `packages/context-engine`: structured task from selection + context (JSX, nearby code, parents, computed styles, git status). Page text in a delimited untrusted block.
- [ ] `packages/agent-sdk`: `CodingAgent` interface, `AgentTask`, `AgentEvent`.
- [ ] Claude Code adapter: `claude -p` with stream-json output, restricted tools, cwd = project root.
- [ ] Agent transactions: snapshot dirty files + Git change detection after run; undo via same history.
- [ ] Protocol `edit.agent.request/progress/result`, cancel.
- [ ] Enable toolbar Ask AI + panel prompt box; route `unsupported` visual edits into prompt.

## Known limits / follow-ups
- [ ] Tailwind theme scale detection (custom `--spacing`, shadcn `--radius`) - currently refuses on mismatch.
- [ ] Variant-aware edits (edit `md:p-8` when viewport matches `md`).
- [ ] Component call-site resolution (React fiber owner) - edits land on component definition today.
- [ ] Next.js instrumentation.
- [ ] Persist session history to `.uihook/sessions`.
- [ ] Redo.
- [ ] Toolbar Undo E2E coverage (closed shadow root).
- [ ] Bundle companion for `npx uihook`.
