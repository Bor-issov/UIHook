import { createHash } from "node:crypto";

export function contentHash(content: string | null): string {
  return content === null ? "absent" : createHash("sha256").update(content).digest("hex");
}
