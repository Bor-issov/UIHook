/** Hosts provider CLIs legitimately send users to during login. Anything else is not surfaced as a link. */
const LOGIN_HOSTS = [
  "claude.ai",
  "claude.com",
  "console.anthropic.com",
  "platform.claude.com",
  "auth.openai.com",
  "chatgpt.com",
  "platform.openai.com",
  "accounts.google.com",
];

export function extractLoginUrls(line: string): string[] {
  const urls: string[] = [];
  for (const match of line.matchAll(/https:\/\/[^\s"'<>`)\]]+/g)) {
    try {
      const url = new URL(match[0]);
      if (url.protocol === "https:" && LOGIN_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
        urls.push(url.toString());
      }
    } catch {
      // not a URL
    }
  }
  return urls;
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
