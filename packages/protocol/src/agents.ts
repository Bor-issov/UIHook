import { z } from "zod";
import { EditSessionSummary } from "./edits.js";
import { ElementSelection } from "./selection.js";

/** Built-in providers are claude, codex, gemini; the pattern leaves room for more adapters. */
export const AgentId = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
export type AgentId = z.infer<typeof AgentId>;

export const AgentAuthState = z.enum(["logged_in", "logged_out", "unknown"]);
export type AgentAuthState = z.infer<typeof AgentAuthState>;

export const AgentLoginMethod = z.discriminatedUnion("kind", [
  /** The companion can start the provider's own login flow (browser OAuth). */
  z.object({ kind: z.literal("command"), label: z.string(), display: z.string() }),
  /** Login needs the provider's interactive terminal UI; the user follows the instructions. */
  z.object({ kind: z.literal("manual"), instructions: z.string() }),
]);
export type AgentLoginMethod = z.infer<typeof AgentLoginMethod>;

export const AgentInfo = z.object({
  id: AgentId,
  name: z.string(),
  installed: z.boolean(),
  version: z.string().optional(),
  installHint: z.string().optional(),
  auth: AgentAuthState,
  authDetail: z.string().optional(),
  login: AgentLoginMethod,
});
export type AgentInfo = z.infer<typeof AgentInfo>;

export const AgentEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), text: z.string().max(2000) }),
  z.object({ kind: z.literal("message"), text: z.string().max(8000) }),
  z.object({ kind: z.literal("tool"), name: z.string().max(200), detail: z.string().max(1000).optional() }),
  z.object({ kind: z.literal("log"), text: z.string().max(2000) }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

export const AgentLoginState = z.enum(["running", "succeeded", "failed", "cancelled"]);
export type AgentLoginState = z.infer<typeof AgentLoginState>;

export const AgentRunStatus = z.enum(["applied", "no_changes", "failed", "cancelled"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatus>;

export const AgentEditRequest = z.object({
  agentId: AgentId,
  instruction: z.string().trim().min(1).max(4000),
  selection: ElementSelection,
});
export type AgentEditRequest = z.infer<typeof AgentEditRequest>;

export const AgentRunResult = z.object({
  runId: z.string(),
  agentId: AgentId,
  status: AgentRunStatus,
  session: EditSessionSummary.optional(),
  error: z.string().optional(),
  /** Final agent message, if any. */
  summary: z.string().max(8000).optional(),
});
export type AgentRunResult = z.infer<typeof AgentRunResult>;
