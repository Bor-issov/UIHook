import type { ErrorCode } from "@uihook/protocol";

/** Errors that are safe to report to the client verbatim. Anything else becomes `internal`. */
export class RequestError extends Error {
  override name = "RequestError";
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
