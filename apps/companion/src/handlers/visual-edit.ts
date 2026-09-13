import { type AppliedChange, applyVisualEdit } from "@uihook/ast-editor";
import { contentHash, summarize } from "@uihook/git-engine";
import type { ClientPayload, VisualEditResult } from "@uihook/protocol";
import { RequestError } from "../errors.js";
import type { Services } from "../services.js";

export async function handleVisualEdit(services: Services, payload: ClientPayload<"edit.visual.request">): Promise<VisualEditResult> {
  if (!services.project.tailwind) {
    return { status: "unsupported", reason: "deterministic edits currently require Tailwind CSS", routeToAgent: true };
  }
  const { source, tag, changes, observed, expectedHash } = payload;

  return services.mutex.run(async () => {
    const tx = await services.history.begin("visual", "");
    const code = await tx.track(source.file);
    if (code === null) throw new RequestError("not_found", `${source.file} does not exist`);
    if (contentHash(code) !== expectedHash) {
      await tx.rollback();
      throw new RequestError("stale_source", `${source.file} changed since the element was selected; reselect it`);
    }

    const outcome = applyVisualEdit(code, { ...source, tag, changes, observed }, services.editor);
    switch (outcome.status) {
      case "not_found":
        await tx.rollback();
        throw new RequestError("stale_source", outcome.reason);
      case "unsupported":
        await tx.rollback();
        services.logger.info("edit.visual.refused", { file: source.file, line: source.line, reason: outcome.reason });
        return { status: "unsupported", reason: outcome.reason, routeToAgent: true };
      case "unchanged":
        await tx.rollback();
        return { status: "unchanged" };
    }

    try {
      await tx.write(source.file, outcome.code);
      const instruction = describe(tag, outcome.applied);
      const session = await tx.commit({ instruction });
      if (!session) return { status: "unchanged" };
      services.logger.info("edit.visual.applied", { file: source.file, line: source.line, instruction, session: session.id });
      return { status: "applied", session: summarize(session) };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  });
}

const LABELS: Record<AppliedChange["property"], string> = {
  padding: "padding",
  paddingX: "horizontal padding",
  paddingY: "vertical padding",
  margin: "margin",
  marginX: "horizontal margin",
  marginY: "vertical margin",
  gap: "gap",
  gapX: "column gap",
  gapY: "row gap",
  borderRadius: "radius",
};

function describe(tag: string, applied: AppliedChange[]): string {
  return applied
    .map((c) => {
      const from = [...new Set(c.fromPx)].map((px) => `${px}px`).join("/");
      const classes = c.removed.length ? `${c.removed.join(" ")} -> ${c.added}` : `+${c.added}`;
      return `<${tag}> ${LABELS[c.property]} ${from} -> ${c.toPx}px (${classes})`;
    })
    .join("; ");
}
