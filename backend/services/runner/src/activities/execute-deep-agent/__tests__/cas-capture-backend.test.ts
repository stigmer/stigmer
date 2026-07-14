import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeepAgent, isSandboxBackend } from "deepagents";
import {
  CasCaptureFilesystemBackend,
  CasCaptureShellBackend,
  createCasCaptureBackend,
} from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import { ScriptedModel } from "../__test-utils__/scripted-model.js";

/**
 * The backend is a thin adapter: it forwards each mutation point to the shared
 * {@link CasCaptureObserver} (which owns all capture state and logic) and then
 * delegates to the base `FilesystemBackend` to apply the write to disk. These
 * tests assert exactly that delegation contract — the write lands on disk AND the
 * observer sees the pre-turn bytes. The recording semantics themselves (first
 * touch, concurrency, memoization) are covered in cas-capture-observer.test.ts.
 */
describe("CasCaptureFilesystemBackend (thin CAS adapter)", () => {
  let root: string;

  const isIgnored = async (relPath: string): Promise<boolean> => relPath.startsWith("ignored/");

  function makeBackend(): { backend: CasCaptureFilesystemBackend; observer: CasCaptureObserver } {
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored });
    const backend = new CasCaptureFilesystemBackend({ rootDir: root }, { observer });
    return { backend, observer };
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cas-backend-"));
    await mkdir(join(root, "ignored"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("write applies to disk AND records before=null for a new gitignored file", async () => {
    const { backend, observer } = makeBackend();

    await backend.write("ignored/new.txt", "hello");

    expect(await readFile(join(root, "ignored/new.txt"), "utf8")).toBe("hello");
    expect(observer.before.get("ignored/new.txt")).toBeNull();
  });

  it("edit applies to disk AND records the pre-turn bytes for a gitignored file", async () => {
    await writeFile(join(root, "ignored/cfg.txt"), "v0");
    const { backend, observer } = makeBackend();

    await backend.edit("ignored/cfg.txt", "v0", "v1");

    expect(await readFile(join(root, "ignored/cfg.txt"), "utf8")).toBe("v1");
    expect(Buffer.from(observer.before.get("ignored/cfg.txt")!).toString("utf8")).toBe("v0");
  });

  it("a git-tracked write applies to disk but is NOT observed (the git diff owns it)", async () => {
    const { backend, observer } = makeBackend();

    await backend.write("src/app.ts", "export const x = 1;");

    expect(await readFile(join(root, "src/app.ts"), "utf8")).toBe("export const x = 1;");
    expect(observer.before.size).toBe(0);
  });
});

describe("CasCaptureShellBackend (shell + CAS adapter)", () => {
  let root: string;

  const isIgnored = async (relPath: string): Promise<boolean> => relPath.startsWith("ignored/");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cas-shell-backend-"));
    await mkdir(join(root, "ignored"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is recognized as a sandbox backend by deepagents", async () => {
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored });
    const backend = await createCasCaptureBackend({
      rootDir: root,
      observer,
      shellEnv: { STIGMER_TEST_MARKER: "visible" },
    });

    expect(isSandboxBackend(backend)).toBe(true);
  });

  it("execute runs a command with the merged shell env", async () => {
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored });
    const backend = await createCasCaptureBackend({
      rootDir: root,
      observer,
      shellEnv: { STIGMER_TEST_MARKER: "from-shell-env" },
    }) as CasCaptureShellBackend;

    const result = await backend.execute("printenv STIGMER_TEST_MARKER");

    expect(result.exitCode).toBe(0);
    expect(result.output.trim()).toBe("from-shell-env");
  });

  it("write/edit CAS capture still records before-bytes on the shell backend", async () => {
    await writeFile(join(root, "ignored/cfg.txt"), "v0");
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored });
    const backend = await createCasCaptureBackend({
      rootDir: root,
      observer,
      shellEnv: {},
    }) as CasCaptureShellBackend;

    await backend.edit("ignored/cfg.txt", "v0", "v1");

    expect(await readFile(join(root, "ignored/cfg.txt"), "utf8")).toBe("v1");
    expect(Buffer.from(observer.before.get("ignored/cfg.txt")!).toString("utf8")).toBe("v0");
  });
});

describe("plan-mode filesystem backend", () => {
  it("is not sandbox-capable", async () => {
    const root = await mkdtemp(join(tmpdir(), "cas-plan-"));
    try {
      const observer = new CasCaptureObserver({
        rootDir: root,
        isIgnored: async () => false,
      });
      const backend = await createCasCaptureBackend({
        rootDir: root,
        observer,
      });
      expect(isSandboxBackend(backend)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/**
 * Locks in the deepagents constraint that forced the plan-mode backend split:
 * filesystem `permissions` (our plan-mode enforcement) are rejected at
 * construction when combined with an execution-capable backend. If a future
 * refactor recombines them, these tests fail before any execution regresses.
 * Note createDeepAgent is synchronous in deepagents 1.10.x — the guard throws,
 * it does not reject.
 */
describe("createDeepAgent plan-mode backend guard", () => {
  it("constructs with plan-mode permissions on the filesystem CAS backend", async () => {
    const root = await mkdtemp(join(tmpdir(), "cas-plan-agent-"));
    try {
      const observer = new CasCaptureObserver({
        rootDir: root,
        isIgnored: async () => false,
      });
      const backend = new CasCaptureFilesystemBackend({ rootDir: root }, { observer });

      const agent = createDeepAgent({
        model: new ScriptedModel(() => ({ toolCalls: [], done: "ok" })),
        backend,
        permissions: [{ operations: ["write"], paths: ["/**"], mode: "deny" }],
      } as Parameters<typeof createDeepAgent>[0]);
      expect(agent).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("throws when plan-mode permissions meet a shell CAS backend", async () => {
    const root = await mkdtemp(join(tmpdir(), "cas-plan-shell-agent-"));
    try {
      const observer = new CasCaptureObserver({
        rootDir: root,
        isIgnored: async () => false,
      });
      const backend = await createCasCaptureBackend({
        rootDir: root,
        observer,
        shellEnv: {},
      });

      expect(() => createDeepAgent({
        model: new ScriptedModel(() => ({ toolCalls: [], done: "ok" })),
        backend,
        permissions: [{ operations: ["write"], paths: ["/**"], mode: "deny" }],
      } as Parameters<typeof createDeepAgent>[0])).toThrow(/command execution/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
