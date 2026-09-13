import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenPathError, Workspace } from "./workspace.js";

describe("Workspace path confinement", () => {
  let root: string;
  let outside: string;
  let ws: Workspace;

  beforeAll(async () => {
    const base = mkdtempSync(path.join(tmpdir(), "uihook-ws-"));
    root = path.join(base, "app");
    outside = path.join(base, "secret");
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(root, "src/App.tsx"), "export {}");
    writeFileSync(path.join(outside, "keys.ts"), "secret");
    writeFileSync(path.join(root, ".env"), "SECRET=1");
    symlinkSync(outside, path.join(root, "src/linked"));
    symlinkSync(path.join(outside, "keys.ts"), path.join(root, "src/key.ts"));
    ws = await Workspace.open(root);
  });

  it("reads files inside the root", async () => {
    expect(await ws.read("src/App.tsx")).toBe("export {}");
    expect(await ws.read("src/Missing.tsx")).toBeNull();
  });

  it.each([
    "../secret/keys.ts",
    "src/../../secret/keys.ts",
    "/etc/passwd.ts",
    "src\\..\\..\\secret\\keys.ts",
    "C:/x.ts",
    "./src/App.tsx",
    "src//App.tsx",
    ".env",
    "src/.env.ts",
    "node_modules/react/index.js",
    ".git/config.ts",
    "package.json",
    "src/App.tsx\0.ts",
    "src/linked/keys.ts",
    "src/key.ts",
  ])("rejects %s", async (file) => {
    await expect(ws.read(file)).rejects.toBeInstanceOf(ForbiddenPathError);
  });

  it("refuses to write through symlinks or outside the root", async () => {
    await expect(ws.write("src/key.ts", "pwned")).rejects.toBeInstanceOf(ForbiddenPathError);
    await expect(ws.write("../secret/keys.ts", "pwned")).rejects.toBeInstanceOf(ForbiddenPathError);
  });
});
