import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EditConflictError, EditHistory, type FileAccess, GitClient, SessionStateError, summarize } from "./index.js";

class MemoryFiles implements FileAccess {
  constructor(readonly data = new Map<string, string>()) {}
  async read(file: string) { return this.data.get(file) ?? null; }
  async write(file: string, content: string) { this.data.set(file, content); }
  async remove(file: string) { this.data.delete(file); }
}

const original = "line1\n<div className=\"p-6\">\nline3\nline4\nline5\nline6\nline7\nline8\nline9\n";

async function visualEdit(history: EditHistory, files: MemoryFiles, file: string, from: string, to: string) {
  const tx = await history.begin("visual", `${from} -> ${to}`);
  const before = await tx.track(file);
  await tx.write(file, before!.replace(from, to));
  return (await tx.commit())!;
}

describe("EditHistory", () => {
  it("records a session with a unified diff and restores the exact pre-image on undo", async () => {
    const files = new MemoryFiles(new Map([["src/Card.tsx", original]]));
    const history = new EditHistory(files, null);
    const session = await visualEdit(history, files, "src/Card.tsx", "p-6", "p-4");

    const summary = summarize(session);
    expect(summary.files).toEqual([{ file: "src/Card.tsx", additions: 1, deletions: 1 }]);
    expect(summary.patch).toContain("--- a/src/Card.tsx");
    expect(summary.patch).toContain('-<div className="p-6">');
    expect(summary.patch).toContain('+<div className="p-4">');

    await history.undo(session.id);
    expect(files.data.get("src/Card.tsx")).toBe(original);
    expect(history.get(session.id)!.status).toBe("undone");
    await expect(history.undo(session.id)).rejects.toBeInstanceOf(SessionStateError);
  });

  it("returns null when nothing changed", async () => {
    const files = new MemoryFiles(new Map([["a.tsx", "x"]]));
    const history = new EditHistory(files, null);
    const tx = await history.begin("visual", "noop");
    await tx.track("a.tsx");
    expect(await tx.commit()).toBeNull();
    expect(history.list()).toHaveLength(0);
  });

  it("refuses writes to untracked files", async () => {
    const tx = await new EditHistory(new MemoryFiles(), null).begin("visual", "x");
    await expect(tx.write("a.tsx", "y")).rejects.toBeInstanceOf(SessionStateError);
  });

  it("undoes out of order when later edits do not overlap", async () => {
    const files = new MemoryFiles(new Map([["f.tsx", original]]));
    const history = new EditHistory(files, null);
    const first = await visualEdit(history, files, "f.tsx", "p-6", "p-4");
    await visualEdit(history, files, "f.tsx", "line9", "line9-changed");
    await history.undo(first.id);
    expect(files.data.get("f.tsx")).toBe(original.replace("line9", "line9-changed"));
  });

  it("refuses to undo over conflicting user changes and leaves files untouched", async () => {
    const files = new MemoryFiles(new Map([["f.tsx", original], ["g.tsx", "g-before\n"]]));
    const history = new EditHistory(files, null);
    const tx = await history.begin("agent", "two files");
    await tx.track("f.tsx");
    await tx.track("g.tsx");
    await tx.write("f.tsx", original.replace("p-6", "p-4"));
    await tx.write("g.tsx", "g-after\n");
    const session = (await tx.commit())!;

    files.data.set("f.tsx", original.replace("p-6", "p-2"));
    await expect(history.undo(session.id)).rejects.toBeInstanceOf(EditConflictError);
    expect(files.data.get("g.tsx")).toBe("g-after\n");
    expect(history.get(session.id)!.status).toBe("applied");
  });

  it("rolls back created and modified files", async () => {
    const files = new MemoryFiles(new Map([["a.tsx", "a"]]));
    const history = new EditHistory(files, null);
    const tx = await history.begin("agent", "x");
    await tx.track("a.tsx");
    await tx.track("new.tsx");
    await tx.write("a.tsx", "changed");
    await tx.write("new.tsx", "created");
    await tx.rollback();
    expect([...files.data]).toEqual([["a.tsx", "a"]]);
  });

  it("accepted sessions can no longer be undone", async () => {
    const files = new MemoryFiles(new Map([["f.tsx", original]]));
    const history = new EditHistory(files, null);
    const session = await visualEdit(history, files, "f.tsx", "p-6", "p-4");
    history.accept(session.id);
    await expect(history.undo(session.id)).rejects.toBeInstanceOf(SessionStateError);
  });
});

describe("GitClient", () => {
  it("reports project-relative status and records the baseline of dirty files", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "uihook-git-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    const app = path.join(repo, "app");
    execFileSync("mkdir", ["-p", path.join(app, "src")]);
    writeFileSync(path.join(app, "src/Card.tsx"), original);
    writeFileSync(path.join(app, "src/Other.tsx"), "other\n");
    git("add", ".");
    git("commit", "-qm", "init");
    writeFileSync(path.join(app, "src/Other.tsx"), "other dirty\n");
    writeFileSync(path.join(app, "src/New.tsx"), "new\n");

    const client = (await GitClient.detect(app))!;
    const status = await client.status();
    expect(status.get("src/Other.tsx")?.code).toBe(" M");
    expect(status.get("src/New.tsx")?.code).toBe("??");
    expect(status.has("src/Card.tsx")).toBe(false);

    const files = new MemoryFiles(new Map([["src/Card.tsx", original]]));
    const history = new EditHistory(files, client);
    const session = await visualEdit(history, files, "src/Card.tsx", "p-6", "p-4");
    expect(session.baseline.head).toMatch(/^[0-9a-f]{40}$/);
    expect(session.changes[0]!.gitStatusBefore).toBe("  ");
    expect(await GitClient.detect(tmpdir())).toBeNull();
  });
});
