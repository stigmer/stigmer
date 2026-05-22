import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalWorkspaceBackend, initializeLocalWorkspace } from "../local-backend.js";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("LocalWorkspaceBackend with platformDir", () => {
  let wsRoot: string;
  let platformDir: string;
  let backend: LocalWorkspaceBackend;

  beforeEach(() => {
    wsRoot = makeTempDir("ws-test-");
    platformDir = makeTempDir("platform-test-");
    backend = new LocalWorkspaceBackend(wsRoot, platformDir);
  });

  afterEach(() => {
    rmSync(wsRoot, { recursive: true, force: true });
    rmSync(platformDir, { recursive: true, force: true });
  });

  // ── writeFile routing ──────────────────────────────────────────────

  describe("writeFile", () => {
    it("routes .stigmer/ paths to platformDir", async () => {
      await backend.writeFile(".stigmer/skills/my-skill/SKILL.md", "# My Skill");

      const physical = join(platformDir, "skills", "my-skill", "SKILL.md");
      expect(readFileSync(physical, "utf-8")).toBe("# My Skill");
    });

    it("creates parent directories under platformDir automatically", async () => {
      await backend.writeFile(
        ".stigmer/skills/deep/nested/skill/SKILL.md",
        "content",
      );

      const physical = join(platformDir, "skills", "deep", "nested", "skill", "SKILL.md");
      expect(readFileSync(physical, "utf-8")).toBe("content");
    });

    it("routes regular paths to workspace root", async () => {
      mkdirSync(join(wsRoot, "src"), { recursive: true });
      await backend.writeFile("src/main.ts", "console.log('hello')");

      expect(readFileSync(join(wsRoot, "src", "main.ts"), "utf-8")).toBe(
        "console.log('hello')",
      );
    });

    it("does not create .stigmer/ in workspace root", async () => {
      await backend.writeFile(".stigmer/skills/a/SKILL.md", "data");

      const wsContents = require("node:fs").readdirSync(wsRoot);
      expect(wsContents).not.toContain(".stigmer");
    });

    it("writes regular files to workspace root unchanged", async () => {
      mkdirSync(join(wsRoot, "src"), { recursive: true });
      await backend.writeFile("src/main.py", "print('hi')");

      expect(readFileSync(join(wsRoot, "src", "main.py"), "utf-8")).toBe(
        "print('hi')",
      );
    });

    it("does not route .stigmer files to platformDir for absolute paths", async () => {
      const absPath = join(wsRoot, ".stigmer-test.txt");
      await backend.writeFile(absPath, "abs content");
      expect(readFileSync(absPath, "utf-8")).toBe("abs content");
    });
  });

  // ── readFile routing ───────────────────────────────────────────────

  describe("readFile", () => {
    it("reads .stigmer/ files from platformDir", async () => {
      mkdirSync(join(platformDir, "skills", "code-review"), { recursive: true });
      writeFileSync(
        join(platformDir, "skills", "code-review", "SKILL.md"),
        "# Code Review",
      );

      const content = await backend.readFile(
        ".stigmer/skills/code-review/SKILL.md",
      );
      expect(content).toBe("# Code Review");
    });

    it("reads regular files from workspace root", async () => {
      writeFileSync(join(wsRoot, "README.md"), "# Hello");

      const content = await backend.readFile("README.md");
      expect(content).toBe("# Hello");
    });

    it("reads .stigmer/inputs/ from platformDir", async () => {
      mkdirSync(join(platformDir, "inputs"), { recursive: true });
      writeFileSync(
        join(platformDir, "inputs", "requirements.txt"),
        "flask==3.0\n",
      );

      const content = await backend.readFile(".stigmer/inputs/requirements.txt");
      expect(content).toBe("flask==3.0\n");
    });
  });

  // ── exists routing ─────────────────────────────────────────────────

  describe("exists", () => {
    it("checks .stigmer/ paths in platformDir", async () => {
      expect(await backend.exists(".stigmer/skills")).toBe(false);

      mkdirSync(join(platformDir, "skills"), { recursive: true });
      expect(await backend.exists(".stigmer/skills")).toBe(true);
    });

    it("checks regular paths in workspace root", async () => {
      expect(await backend.exists("package.json")).toBe(false);

      writeFileSync(join(wsRoot, "package.json"), "{}");
      expect(await backend.exists("package.json")).toBe(true);
    });

    it("checks .stigmer directory itself", async () => {
      expect(await backend.exists(".stigmer")).toBe(true);
    });
  });

  // ── execute with env injection ─────────────────────────────────────

  describe("execute", () => {
    it("injects STIGMER_PLATFORM_DIR env var", async () => {
      const output = await backend.execute("echo $STIGMER_PLATFORM_DIR");
      expect(output.trim()).toBe(platformDir);
    });

    it("rewrites .stigmer in commands to $STIGMER_PLATFORM_DIR", async () => {
      mkdirSync(join(platformDir, "skills"), { recursive: true });
      writeFileSync(join(platformDir, "skills", "test.txt"), "skill content");

      const output = await backend.execute("cat .stigmer/skills/test.txt");
      expect(output.trim()).toBe("skill content");
    });

    it("does not rewrite .stigmer when part of another word", async () => {
      const output = await backend.execute("echo my.stigmer");
      expect(output.trim()).toBe("my.stigmer");
    });

    it("runs commands in workspace root by default", async () => {
      const output = await backend.execute("pwd -P");
      const { realpathSync } = require("node:fs");
      expect(output.trim()).toBe(realpathSync(wsRoot));
    });
  });

  // ── Path traversal safety ──────────────────────────────────────────

  describe("path traversal", () => {
    it("rejects .stigmer/../../etc/passwd", async () => {
      await expect(
        backend.readFile(".stigmer/../../etc/passwd"),
      ).rejects.toThrow("Path traversal detected");
    });

    it("rejects .stigmer/../../../ escape via writeFile", async () => {
      await expect(
        backend.writeFile(".stigmer/../../../tmp/evil.txt", "pwned"),
      ).rejects.toThrow("Path traversal detected");
    });

    it("rejects .stigmer/../ via exists", async () => {
      await expect(backend.exists(".stigmer/../..")).rejects.toThrow(
        "Path traversal detected",
      );
    });

    it("allows nested platform paths that stay within bounds", async () => {
      mkdirSync(join(platformDir, "skills", "a"), { recursive: true });
      writeFileSync(join(platformDir, "skills", "a", "SKILL.md"), "ok");

      const content = await backend.readFile(".stigmer/skills/a/SKILL.md");
      expect(content).toBe("ok");
    });
  });
});

// ── Backward compat: no platformDir ──────────────────────────────────

describe("LocalWorkspaceBackend without platformDir", () => {
  let wsRoot: string;

  beforeEach(() => {
    wsRoot = makeTempDir("ws-noplatform-");
  });

  afterEach(() => {
    rmSync(wsRoot, { recursive: true, force: true });
  });

  it(".stigmer paths go to workspace (no virtual mount)", async () => {
    const backend = new LocalWorkspaceBackend(wsRoot);
    mkdirSync(join(wsRoot, ".stigmer", "skills"), { recursive: true });
    writeFileSync(join(wsRoot, ".stigmer", "skills", "a.md"), "direct");

    const content = await backend.readFile(".stigmer/skills/a.md");
    expect(content).toBe("direct");
  });

  it("does not inject STIGMER_PLATFORM_DIR env var", async () => {
    const backend = new LocalWorkspaceBackend(wsRoot);
    const output = await backend.execute(
      "echo ${STIGMER_PLATFORM_DIR:-UNSET}",
    );
    expect(output.trim()).toBe("UNSET");
  });

  it("does not rewrite .stigmer in commands", async () => {
    const backend = new LocalWorkspaceBackend(wsRoot);
    mkdirSync(join(wsRoot, ".stigmer"), { recursive: true });
    writeFileSync(join(wsRoot, ".stigmer", "test.txt"), "real");

    const output = await backend.execute("cat .stigmer/test.txt");
    expect(output.trim()).toBe("real");
  });

  it("platformDir property is undefined", () => {
    const backend = new LocalWorkspaceBackend(wsRoot);
    expect(backend.platformDir).toBeUndefined();
  });
});

// ── initializeLocalWorkspace with platformDir ────────────────────────

describe("initializeLocalWorkspace", () => {
  let wsRoot: string;

  afterEach(() => {
    if (wsRoot) rmSync(wsRoot, { recursive: true, force: true });
  });

  it("creates workspace root and sets platformDir", async () => {
    wsRoot = join(tmpdir(), `init-platform-test-${Date.now()}`);
    const pDir = join(tmpdir(), `init-platform-pdir-${Date.now()}`);

    const backend = await initializeLocalWorkspace(wsRoot, pDir);
    expect(backend.rootDir).toBe(wsRoot);
    expect(backend.platformDir).toBe(pDir);

    rmSync(pDir, { recursive: true, force: true });
  });
});
