import { applyPatch, createTwoFilesPatch, reversePatch, structuredPatch } from "diff";

export function buildPatch(file: string, before: string | null, after: string | null) {
  const patch = createTwoFilesPatch(
    before === null ? "/dev/null" : `a/${file}`,
    after === null ? "/dev/null" : `b/${file}`,
    before ?? "",
    after ?? "",
    undefined,
    undefined,
    { context: 3 },
  );
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  // Drop the "=====" banner jsdiff emits; it is not part of the unified diff format git uses.
  return { patch: patch.replace(/^={10,}\n/m, ""), additions, deletions };
}

/**
 * Reverts an edit on top of content that may have changed since. Returns null when the reverse
 * patch does not apply cleanly, which callers must treat as a conflict.
 */
export function revertOnto(current: string, before: string, after: string): string | null {
  const forward = structuredPatch("file", "file", before, after, undefined, undefined, { context: 3 });
  const result = applyPatch(current, reversePatch(forward));
  return result === false ? null : result;
}
