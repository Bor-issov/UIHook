import { z } from "zod";
import { ElementSelection } from "./selection.js";

/**
 * Messages exchanged inside the extension (content script <-> side panel) over chrome.runtime.
 * Validated on receipt: the content script runs next to untrusted page code.
 */
export const ContentToPanel = z.discriminatedUnion("type", [
  /** `refresh` is sent when the selected element re-rendered (e.g. after HMR). */
  z.object({ type: z.literal("content.selected"), selection: ElementSelection, reason: z.enum(["user", "refresh"]) }),
  z.object({ type: z.literal("content.cleared") }),
  z.object({ type: z.literal("content.mode"), active: z.boolean() }),
  z.object({ type: z.literal("content.action"), action: z.enum(["undo", "askAi", "inspect"]) }),
]);
export type ContentToPanel = z.infer<typeof ContentToPanel>;

export const PanelToContent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("panel.setMode"), active: z.boolean() }),
  z.object({ type: z.literal("panel.toggleMode") }),
  z.object({ type: z.literal("panel.refreshSelection") }),
  z.object({ type: z.literal("panel.clearSelection") }),
  z.object({ type: z.literal("panel.getMode") }),
]);
export type PanelToContent = z.infer<typeof PanelToContent>;
