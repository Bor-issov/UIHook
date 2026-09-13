/**
 * Manifest generation: one shared definition plus per-browser overrides. Imported by the build
 * script (Node type stripping) and by unit tests, so it must stay free of non-erasable TS syntax.
 */

export type TargetBrowser = "chrome" | "firefox";

export interface ManifestInput {
  browser: TargetBrowser;
  version: string;
  /** Chrome public key that pins the unpacked extension ID. */
  chromeKey?: string;
  firefoxAddonId: string;
}

/** Dev servers the extension may inspect. Match patterns without a port match every port. */
export const DEV_HOST_PATTERNS = ["http://localhost/*", "http://127.0.0.1/*"];

export const PANEL_PAGE = "sidepanel.html";

type Json = Record<string, unknown>;

function shared(input: ManifestInput): Json {
  return {
    manifest_version: 3,
    name: "UIHook",
    description: "Visual development layer for your running app and your coding agent.",
    version: input.version,
    permissions: ["storage"],
    host_permissions: DEV_HOST_PATTERNS,
    action: { default_title: "Open UIHook" },
    content_scripts: [{ matches: DEV_HOST_PATTERNS, js: ["content.js"], run_at: "document_idle" }],
    commands: {
      "toggle-select": { suggested_key: { default: "Alt+Shift+S" }, description: "Toggle element selection" },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src ws://127.0.0.1:* ws://localhost:*",
    },
  };
}

function chrome(input: ManifestInput): Json {
  const base = shared(input);
  return {
    ...base,
    minimum_chrome_version: "116",
    ...(input.chromeKey ? { key: input.chromeKey } : {}),
    permissions: [...(base.permissions as string[]), "sidePanel"],
    background: { service_worker: "background.js", type: "module" },
    side_panel: { default_path: PANEL_PAGE },
  };
}

function firefox(input: ManifestInput): Json {
  const base = shared(input);
  return {
    ...base,
    browser_specific_settings: {
      gecko: {
        id: input.firefoxAddonId,
        strict_min_version: "142.0",
        data_collection_permissions: { required: ["none"] },
      },
    },
    // Firefox MV3 runs background pages as non-persistent event pages, not service workers.
    background: { scripts: ["background.js"] },
    sidebar_action: { default_panel: PANEL_PAGE, default_title: "UIHook", open_at_install: false },
    commands: {
      ...(base.commands as Json),
      _execute_sidebar_action: { suggested_key: { default: "Alt+Shift+U" }, description: "Toggle the UIHook sidebar" },
    },
  };
}

export function buildManifest(input: ManifestInput): Json {
  return input.browser === "chrome" ? chrome(input) : firefox(input);
}
