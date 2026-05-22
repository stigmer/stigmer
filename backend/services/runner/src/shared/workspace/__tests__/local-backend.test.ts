import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalWorkspaceBackend, initializeLocalWorkspace } from "../local-backend.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "lb-test-"));
}

describe("LocalWorkspaceBackend", () => {
  let root: string;
  let backend: LocalWorkspaceBackend;

  beforeEach(() => {
    root = makeTempDir();
    backend = new LocalWorkspaceBackend(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── execute ───────────────────────────────────────────────────────

  describe("execute", () => {
    it("runs commands in workspace root by default", async () => {
      writeFileSync(join(root, "marker.txt"), "found");
      const output = await backend.execute("cat marker.txt");
      expect(output).toBe("found");
    });

    it("runs commands in relative cwd subdirectory", async () => {
      mkdirSync(join(root, "sub"));
      writeFileSync(join(root, "sub", "data.txt"), "sub-content");
      const output = await backend.execute("cat data.txt", { cwd: "sub" });
      expect(output).toBe("sub-content");
    });

    it("runs commands with absolute cwd", async () => {
      const absDir = makeTempDir();
      writeFileSync(join(absDir, "abs.txt"), "absolute");
      const output = await backend.execute("cat abs.txt", { cwd: absDir });
      expect(output).toBe("absolute");
      rmSync(absDir, { recursive: true, force: true });
    });

    it("rejects failed commands with stderr", async () => {
      await expect(backend.execute("exit 1")).rejects.toThrow("Command failed");
    });

    it("rejects non-existent commands", async () => {
      await expect(
        backend.execute("nonexistent_command_12345"),
      ).rejects.toThrow();
    });
  });

  // ── readFile / writeFile ──────────────────────────────────────────

  describe("readFile", () => {
    it("reads file content as utf-8", async () => {
      writeFileSync(join(root, "read-me.txt"), "content here");
      const content = await backend.readFile("read-me.txt");
      expect(content).toBe("content here");
    });

    it("supports absolute paths", async () => {
      const absPath = join(root, "abs-file.txt");
      writeFileSync(absPath, "absolute content");
      const content = await backend.readFile(absPath);
      expect(content).toBe("absolute content");
    });

    it("rejects non-existent files", async () => {
      await expect(backend.readFile("no-such-file.txt")).rejects.toThrow();
    });
  });

  describe("writeFile", () => {
    it("writes content to a file", async () => {
      await backend.writeFile("output.txt", "written");
      const content = await backend.readFile("output.txt");
      expect(content).toBe("written");
    });

    it("overwrites existing files", async () => {
      await backend.writeFile("target.txt", "first");
      await backend.writeFile("target.txt", "second");
      const content = await backend.readFile("target.txt");
      expect(content).toBe("second");
    });

    it("supports absolute paths", async () => {
      const absPath = join(root, "abs-write.txt");
      await backend.writeFile(absPath, "abs-content");
      const content = await backend.readFile(absPath);
      expect(content).toBe("abs-content");
    });
  });

  // ── exists ────────────────────────────────────────────────────────

  describe("exists", () => {
    it("returns true for existing files", async () => {
      writeFileSync(join(root, "present.txt"), "");
      expect(await backend.exists("present.txt")).toBe(true);
    });

    it("returns false for missing files", async () => {
      expect(await backend.exists("missing.txt")).toBe(false);
    });

    it("returns true for directories", async () => {
      mkdirSync(join(root, "subdir"));
      expect(await backend.exists("subdir")).toBe(true);
    });

    it("supports absolute paths", async () => {
      const absPath = join(root, "abs-exist.txt");
      writeFileSync(absPath, "");
      expect(await backend.exists(absPath)).toBe(true);
    });
  });

  // ── rootDir ───────────────────────────────────────────────────────

  it("exposes rootDir property", () => {
    expect(backend.rootDir).toBe(root);
  });
});

describe("initializeLocalWorkspace", () => {
  it("creates directory and returns backend", async () => {
    const dir = join(tmpdir(), `init-test-${Date.now()}`);
    try {
      const backend = await initializeLocalWorkspace(dir);
      expect(backend.rootDir).toBe(dir);
      expect(await backend.exists(".")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("succeeds if directory already exists", async () => {
    const dir = makeTempDir();
    try {
      const backend = await initializeLocalWorkspace(dir);
      expect(backend.rootDir).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
