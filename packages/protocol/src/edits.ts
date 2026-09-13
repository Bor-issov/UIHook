import { z } from "zod";
import { SourceLocation } from "./primitives.js";

export const VisualProperty = z.enum([
  "padding",
  "paddingX",
  "paddingY",
  "margin",
  "marginX",
  "marginY",
  "gap",
  "gapX",
  "gapY",
  "borderRadius",
]);
export type VisualProperty = z.infer<typeof VisualProperty>;

export const VisualChange = z.object({
  property: VisualProperty,
  /** Target value in CSS pixels. */
  px: z.number().min(0).max(4096),
});
export type VisualChange = z.infer<typeof VisualChange>;

/** Observed computed box values in px, used to verify the source classes are actually in effect. */
export const ObservedBox = z.object({
  paddingTop: z.number(),
  paddingRight: z.number(),
  paddingBottom: z.number(),
  paddingLeft: z.number(),
  marginTop: z.number(),
  marginRight: z.number(),
  marginBottom: z.number(),
  marginLeft: z.number(),
  rowGap: z.number(),
  columnGap: z.number(),
  borderTopLeftRadius: z.number(),
  borderTopRightRadius: z.number(),
  borderBottomRightRadius: z.number(),
  borderBottomLeftRadius: z.number(),
});
export type ObservedBox = z.infer<typeof ObservedBox>;

export const ClassNameKind = z.enum(["static", "call", "absent", "dynamic"]);
export type ClassNameKind = z.infer<typeof ClassNameKind>;

export const FileTouch = z.object({
  file: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type FileTouch = z.infer<typeof FileTouch>;

export const EditSessionSummary = z.object({
  id: z.string(),
  timestamp: z.number(),
  type: z.enum(["visual", "agent"]),
  instruction: z.string(),
  status: z.enum(["applied", "accepted", "undone"]),
  files: z.array(FileTouch),
  patch: z.string(),
});
export type EditSessionSummary = z.infer<typeof EditSessionSummary>;

export const VisualEditRequest = z.object({
  source: SourceLocation,
  tag: z.string().min(1).max(64),
  /** Content hash returned by element.context.response; guards against stale selections. */
  expectedHash: z.string().min(1).max(128),
  changes: z.array(VisualChange).min(1).max(16),
  observed: ObservedBox,
});
export type VisualEditRequest = z.infer<typeof VisualEditRequest>;

export const VisualEditResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("applied"), session: EditSessionSummary }),
  z.object({ status: z.literal("unchanged") }),
  z.object({
    status: z.literal("unsupported"),
    reason: z.string(),
    /** Deterministic editing refused; the request is a candidate for the agent engine. */
    routeToAgent: z.literal(true),
  }),
]);
export type VisualEditResult = z.infer<typeof VisualEditResult>;
