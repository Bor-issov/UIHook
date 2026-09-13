import { z } from "zod";
import { ClassNameKind, VisualProperty } from "./edits.js";
import { SourceLocation } from "./primitives.js";

export const SourceSnippet = z.object({
  startLine: z.number().int().positive(),
  lines: z.array(z.string()),
});
export type SourceSnippet = z.infer<typeof SourceSnippet>;

export const ElementContext = z.object({
  source: SourceLocation,
  /** sha256 of the file content the context was built from. */
  hash: z.string(),
  component: z.string().optional(),
  /** Opening JSX tag as written in source, e.g. `<div className="p-6">`. */
  openingTag: z.string(),
  snippet: SourceSnippet,
  className: z.object({
    kind: ClassNameKind,
    classes: z.array(z.string()),
    /** Why the class list cannot be edited deterministically, if it cannot. */
    limitation: z.string().optional(),
  }),
  /** Properties the deterministic engine is prepared to try for this element. */
  editable: z.array(VisualProperty),
  styling: z.object({
    tailwind: z.enum(["v3", "v4"]).nullable(),
  }),
});
export type ElementContext = z.infer<typeof ElementContext>;
