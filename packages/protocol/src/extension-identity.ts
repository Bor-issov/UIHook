/**
 * Stable identities of the development builds of the extension. The companion allowlists the
 * resulting origins by default; anything else must be passed explicitly with --extension-origin.
 */

/** Chrome: derived from the public `key` in apps/extension/extension-key.json. */
export const CHROME_EXTENSION_ID = "dkaiipifgcpinbcifdkfgilclkjdmkom";

/** Firefox add-on ID (`browser_specific_settings.gecko.id`). Change before publishing to AMO. */
export const FIREFOX_ADDON_ID = "uihook@uihook.dev";

/**
 * Firefox assigns each install a random internal UUID, which becomes the page origin. Dev profiles
 * launched by `pnpm dev:firefox` and the E2E suite pin it through the
 * `extensions.webextensions.uuids` preference so the default allowlist works.
 */
export const FIREFOX_DEV_UUID = "9096d939-9e7f-4a10-b2e5-b2437dc0f17d";

export const DEFAULT_EXTENSION_ORIGINS = [
  `chrome-extension://${CHROME_EXTENSION_ID}`,
  `moz-extension://${FIREFOX_DEV_UUID}`,
] as const;

const ORIGIN_PATTERN = /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Only exact extension origins are accepted; wildcards and web origins are rejected. */
export function isValidExtensionOrigin(origin: string): boolean {
  return ORIGIN_PATTERN.test(origin);
}

/** Value for Firefox's `extensions.webextensions.uuids` preference. */
export function firefoxUuidPreference(): string {
  return JSON.stringify({ [FIREFOX_ADDON_ID]: FIREFOX_DEV_UUID });
}
