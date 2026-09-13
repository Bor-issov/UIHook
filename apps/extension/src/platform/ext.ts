/**
 * Promise-based WebExtension namespace: `browser` in Firefox, `chrome` in Chrome (MV3 returns
 * promises). The APIs used by shared code have the same shape in both, so no polyfill is needed.
 */
export const ext: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? globalThis.chrome;
