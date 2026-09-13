// `@uihook/platform-host` is aliased at build time to ./chrome.ts or ./firefox.ts.
export { platform } from "@uihook/platform-host";
export { ext } from "./ext.js";
export type { PlatformHost } from "./types.js";
