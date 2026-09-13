import { z } from "zod";
import { ComputedStyleSnapshot, Rect, SourceLocation } from "./primitives.js";

/**
 * Everything the content script knows about a selected DOM element.
 * All of it originates from page content and must be treated as untrusted data.
 */
export const ElementSelection = z.object({
  source: SourceLocation.optional(),
  /** Enclosing component name as reported by build-time instrumentation. */
  component: z.string().max(256).optional(),
  element: z.object({
    tag: z.string().min(1).max(64),
    id: z.string().max(256).optional(),
    classes: z.array(z.string().max(512)).max(256),
    text: z.string().max(280).optional(),
  }),
  rect: Rect,
  styles: ComputedStyleSnapshot,
  /** Number of rendered DOM nodes produced by the same source location (e.g. list items). */
  instanceCount: z.number().int().nonnegative(),
  /** Nearest instrumented ancestors, closest first. Bounded to keep payloads small. */
  ancestors: z
    .array(z.object({ source: SourceLocation, component: z.string().max(256).optional(), tag: z.string().max(64) }))
    .max(8),
  pageUrl: z.string().max(2048),
});
export type ElementSelection = z.infer<typeof ElementSelection>;
