type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const COLORS: Record<Level, string> = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
}

/** Structured logger: `level event key=value`. JSON lines when stdout is not a TTY. */
export function createLogger(options: { json?: boolean; debug?: boolean } = {}): Logger {
  const json = options.json ?? !process.stdout.isTTY;
  const emit = (level: Level, event: string, fields: Fields = {}) => {
    if (level === "debug" && !options.debug) return;
    if (json) {
      process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, event, ...fields })}\n`);
      return;
    }
    const pairs = Object.entries(fields)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    process.stdout.write(`${COLORS[level]}${level.padEnd(5)}\x1b[0m ${event}${pairs ? ` \x1b[90m${pairs}\x1b[0m` : ""}\n`);
  };
  return {
    debug: (e, f) => emit("debug", e, f),
    info: (e, f) => emit("info", e, f),
    warn: (e, f) => emit("warn", e, f),
    error: (e, f) => emit("error", e, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
