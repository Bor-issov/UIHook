#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_EXTENSION_ORIGINS, isValidExtensionOrigin } from "@uihook/protocol";
import { startCompanion } from "./app.js";
import { createLogger } from "./logger.js";
import { generateToken } from "./server.js";


const { values } = parseArgs({
  options: {
    root: { type: "string", default: process.cwd() },
    port: { type: "string", default: "4317" },
    "extension-id": { type: "string", multiple: true },
    "extension-origin": { type: "string", multiple: true },
    "token-file": { type: "string" },
    debug: { type: "boolean", default: false },
    json: { type: "boolean" },
  },
});

const logger = createLogger({ debug: values.debug, ...(values.json !== undefined ? { json: values.json } : {}) });
// Defaults cover the pinned Chrome ID and the pinned Firefox dev UUID. Extra origins are added, never wildcarded.
const extraOrigins = [
  ...(values["extension-id"] ?? []).map((id) => `chrome-extension://${id}`),
  ...(values["extension-origin"] ?? []),
  ...(process.env.UIHOOK_EXTENSION_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? []),
];
const invalid = extraOrigins.filter((origin) => !isValidExtensionOrigin(origin));
if (invalid.length > 0) {
  logger.error("cli.invalid_extension_origin", { invalid, expected: "chrome-extension://<32 letters> or moz-extension://<uuid>" });
  process.exit(1);
}
const allowedOrigins = [...new Set([...DEFAULT_EXTENSION_ORIGINS, ...extraOrigins])];
const token = values["token-file"] ? readFileSync(values["token-file"], "utf8").trim() : (process.env.UIHOOK_TOKEN ?? generateToken());
const port = Number(values.port);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  logger.error("cli.invalid_port", { port: values.port });
  process.exit(1);
}

try {
  const { services, server } = await startCompanion({
    root: values.root,
    port,
    token,
    allowedOrigins,
    logger,
  });
  logger.info("[v0.1] companion - listening", {
    url: `ws://127.0.0.1:${server.port}`,
    project: services.project.name,
    root: services.workspace.root,
    framework: services.project.framework,
    tailwind: services.project.tailwind,
    git: services.project.git,
    origins: allowedOrigins,
  });
  process.stdout.write(`\n  Pair the extension with:\n\n    port   ${server.port}\n    token  ${token}\n\n`);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  logger.error("cli.start_failed", { error: (error as Error).message });
  process.exit(1);
}
