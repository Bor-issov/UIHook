import { z } from "zod";

export const PROTOCOL_VERSION = 1;

/** Project-relative POSIX path. Absolute paths and traversal never cross the wire. */
export const RelativePath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith("/") && !/^[a-zA-Z]:/.test(p), "path must be project-relative")
  .refine((p) => !p.split(/[\\/]/).includes(".."), "path traversal is not allowed")
  .refine((p) => !p.includes("\0"), "null bytes are not allowed");

export const SourceLocation = z.object({
  file: RelativePath,
  line: z.number().int().positive(),
  /** 1-based column of the JSX opening tag `<`. */
  column: z.number().int().positive(),
});
export type SourceLocation = z.infer<typeof SourceLocation>;

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type Rect = z.infer<typeof Rect>;

/** Computed styles captured from the browser, all lengths already resolved to px strings. */
export const ComputedStyleSnapshot = z.object({
  display: z.string().max(64).optional(),
  position: z.string().max(64).optional(),
  flexDirection: z.string().max(64).optional(),
  alignItems: z.string().max(64).optional(),
  justifyContent: z.string().max(64).optional(),
  paddingTop: z.string().max(64).optional(),
  paddingRight: z.string().max(64).optional(),
  paddingBottom: z.string().max(64).optional(),
  paddingLeft: z.string().max(64).optional(),
  marginTop: z.string().max(64).optional(),
  marginRight: z.string().max(64).optional(),
  marginBottom: z.string().max(64).optional(),
  marginLeft: z.string().max(64).optional(),
  rowGap: z.string().max(64).optional(),
  columnGap: z.string().max(64).optional(),
  width: z.string().max(64).optional(),
  height: z.string().max(64).optional(),
  fontSize: z.string().max(64).optional(),
  fontWeight: z.string().max(64).optional(),
  borderTopLeftRadius: z.string().max(64).optional(),
  borderTopRightRadius: z.string().max(64).optional(),
  borderBottomRightRadius: z.string().max(64).optional(),
  borderBottomLeftRadius: z.string().max(64).optional(),
  backgroundColor: z.string().max(128).optional(),
  color: z.string().max(128).optional(),
});
export type ComputedStyleSnapshot = z.infer<typeof ComputedStyleSnapshot>;
