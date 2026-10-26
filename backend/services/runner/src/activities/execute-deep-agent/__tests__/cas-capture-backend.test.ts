import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemBackend, LocalShellBackend, createDeepAgent, isSandboxBackend } from "deepagents";
import {
  CasCaptureFilesystemBackend,
  CasCaptureShellBackend,
  createCasCaptureBackend,
} from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../../../shared/filereview/cas-capture-observer.js";
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

  it("a whole-file write over an existing gitignored file records its pre-turn bytes (a MODIFY)", async () => {
    // deepagents (1.12+) lets write_file replace an existing file; before, it
    // refused and the model had to edit. The before side is what makes file
    // review author a MODIFY rather than an ADD.
    await writeFile(join(root, "ignored/cfg.txt"), "v0");
    const { backend, observer } = makeBackend();

    const result = await backend.write("ignored/cfg.txt", "v1 replaced");

    expect(result.error).toBeUndefined();
    expect(await readFile(join(root, "ignored/cfg.txt"), "utf8")).toBe("v1 replaced");
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

  it("execute keeps what a command printed at its timeout, and stops it", async () => {
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored });
    const backend = new CasCaptureShellBackend({ rootDir: root, virtualMode: true, timeout: 1, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } }, { observer });
    await backend.initialize();

    const result = await backend.execute("echo compiled-half; sleep 30");

    expect(result.exitCode).toBe(124);
    expect(result.output).toBe("compiled-half\n\nError: Command timed out after 1 seconds; its processes were stopped.");
  });

  it("execute returns when the shell exits although a background child holds its pipes (#2432)", async () => {
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored });
    const backend = await createCasCaptureBackend({ rootDir: root, observer, shellEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" } }) as CasCaptureShellBackend;
    const started = Date.now();

    const result = await backend.execute("sleep 3 & echo detached");

    expect(Date.now() - started).toBeLessThan(2_500);
    expect(result).toEqual({ output: "detached\n", exitCode: 0, truncated: false });
  });

  it("execute answers a failed exit, an empty command and a failed spawn in deepagents' words", async () => {
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored });
    const backend = await createCasCaptureBackend({ rootDir: root, observer, shellEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" } }) as CasCaptureShellBackend;
    expect(await backend.execute("echo nope >&2; exit 3")).toEqual({ output: "[stderr] nope\n\nExit code: 3", exitCode: 3, truncated: false });
    expect(await backend.execute("")).toEqual({ output: "Error: Command must be a non-empty string.", exitCode: 1, truncated: false });
    const gone = new CasCaptureShellBackend({ rootDir: join(root, "missing"), virtualMode: true, env: {} }, { observer });
    expect((await gone.execute("echo hi")).output).toMatch(/^Error executing command: /);
  });

  it("execute says a command the caller stopped was stopped", async () => {
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored });
    const backend = await createCasCaptureBackend({ rootDir: root, observer, shellEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" } }) as CasCaptureShellBackend;
    const controller = new AbortController();
    const result = await backend.runShell("echo going; sleep 30", { timeoutSeconds: 60, signal: controller.signal, onOutput: () => controller.abort() });
    expect(result.aborted).toBe(true);
    expect(result.stdout).toBe("going\n");
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

/**
 * The issue #754 regression pins: the backends are virtual-rooted, so a
 * leading-"/" tool path resolves INSIDE the workspace — never onto the host
 * filesystem — and the CAS observer sees it under the same key the
 * turn-boundary capture resolve. Before the fix, an
 * absolute `write_file("/tmp/x")` landed in the REAL /tmp: outside the
 * workspace, outside CAS capture, outside the file_review ledger — an
 * auto-approved, unreviewed host write.
 */
describe("virtual-root confinement (issue #754)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cas-virtual-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function makeBackend(): { backend: CasCaptureFilesystemBackend; observer: CasCaptureObserver } {
    // Non-git shape: the observer owns EVERY touched path (turn-setup.ts wires
    // isIgnored to always-true when there is no git work tree).
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored: async () => true });
    const backend = new CasCaptureFilesystemBackend(
      { rootDir: root, virtualMode: true },
      { observer },
    );
    return { backend, observer };
  }

  it("an absolute write resolves inside the workspace, never onto the host", async () => {
    const { backend, observer } = makeBackend();
    const hostPath = `/tmp/stigmer-754-escape-${Date.now()}.txt`;

    await backend.write(hostPath, "confined");

    // Landed under the workspace root, keyed workspace-relative for capture…
    expect(await readFile(join(root, hostPath.slice(1)), "utf8")).toBe("confined");
    expect(observer.before.get(hostPath.slice(1))).toBeNull();
    // …and the REAL host path was never touched.
    await expect(readFile(hostPath, "utf8")).rejects.toThrow();
  });

  it("reads resolve inside the workspace — '/etc/hosts' is the workspace's, not the host's", async () => {
    const { backend } = makeBackend();

    const result = await backend.read("/etc/hosts");

    // The workspace has no etc/hosts: the honest not-found, never host bytes.
    expect(JSON.stringify(result)).toMatch(/not found|no such file/i);
    expect(JSON.stringify(result)).not.toContain("localhost");
  });

  it("traversal is rejected at resolution", async () => {
    const { backend } = makeBackend();

    const result = await backend.write("../escape.txt", "nope");

    expect((result as { error?: string }).error).toMatch(/traversal/i);
    await expect(readFile(join(root, "..", "escape.txt"), "utf8")).rejects.toThrow();
  });

  it("the shell variant is confined identically", async () => {
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored: async () => true });
    const backend = await createCasCaptureBackend({ rootDir: root, observer, shellEnv: {} });
    const hostPath = `/tmp/stigmer-754-shell-escape-${Date.now()}.txt`;

    await backend.write(hostPath, "confined");

    expect(await readFile(join(root, hostPath.slice(1)), "utf8")).toBe("confined");
    await expect(readFile(hostPath, "utf8")).rejects.toThrow();
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

/**
 * An edit the model quoted loosely lands through both capture backends as an
 * ordinary edit: before-bytes recorded once, first, and every other edit
 * byte-identical to deepagents' own (the matcher's table is
 * `shared/__tests__/edit-match.test.ts`).
 */
describe.each(["filesystem", "shell"] as const)("loose edits on the %s capture backend", (kind) => {
  let root: string;

  const isIgnored = async (relPath: string): Promise<boolean> => relPath.startsWith("ignored/");

  async function makeBackend(): Promise<{ backend: CasCaptureFilesystemBackend | CasCaptureShellBackend; observer: CasCaptureObserver }> {
    const observer = new CasCaptureObserver({ rootDir: root, isIgnored });
    const backend = await createCasCaptureBackend({
      rootDir: root,
      observer,
      ...(kind === "shell" ? { shellEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" } } : {}),
    });
    return { backend, observer };
  }

  /** deepagents' own backend of the same kind, the today the capture backend must equal. */
  function stockBackend(): FilesystemBackend {
    return kind === "shell"
      ? new LocalShellBackend({ rootDir: root, virtualMode: true, env: {} })
      : new FilesystemBackend({ rootDir: root, virtualMode: true });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cas-loose-edit-"));
    await mkdir(join(root, "ignored"), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("lands a straight-quoted edit on a curly-quoted CRLF file, recording the before-bytes once and first", async () => {
    const before = "// it’s “fine”\r\nconst limit = 1;\r\n";
    await writeFile(join(root, "ignored/cfg.ts"), before);
    const { backend, observer } = await makeBackend();
    const order: string[] = [];
    const record = vi.spyOn(observer, "recordBefore").mockImplementation(async function (this: CasCaptureObserver, path: string) {
      order.push(`record ${path}`);
      return CasCaptureObserver.prototype.recordBefore.call(this, path);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => order.push("repaired"));

    const result = await backend.edit("ignored/cfg.ts", '// it\'s "fine"\nconst limit = 1;', '// it\'s "fine"\nconst limit = 2;');

    expect(result.error).toBeUndefined();
    expect(result.occurrences).toBe(1);
    expect(await readFile(join(root, "ignored/cfg.ts"), "utf8")).toBe("// it’s “fine”\r\nconst limit = 2;\r\n");
    expect(record).toHaveBeenCalledTimes(1);
    expect(Buffer.from(observer.before.get("ignored/cfg.ts")!).toString("utf8")).toBe(before);
    expect(order).toEqual(["record ignored/cfg.ts", "repaired"]);
    expect(warn).toHaveBeenCalledWith("[EDIT-REPAIRED] tier=typography");
  });

  it("answers every edit no tier repairs exactly as deepagents' own backend does", async () => {
    const cases: Array<[string, string, string, boolean?]> = [
      ["exact", "const a = 1;", "const a = 2;"],
      ["not found", "const b = 1;", "const b = 2;"],
      ["exact twice", "x();", "y();"],
      ["exact twice, replace_all", "x();", "y();", true],
    ];
    const content = "const a = 1;\nx();\nx();\n";
    for (const [label, oldString, newString, replaceAll] of cases) {
      await writeFile(join(root, "ignored/ours.ts"), content);
      await writeFile(join(root, "ignored/theirs.ts"), content);
      const { backend } = await makeBackend();
      const stock = stockBackend();

      const ours = await backend.edit("ignored/ours.ts", oldString, newString, replaceAll);
      const theirs = await stock.edit("ignored/theirs.ts", oldString, newString, replaceAll);

      expect({ ...ours, path: undefined }, label).toEqual({ ...theirs, path: undefined });
      expect(await readFile(join(root, "ignored/ours.ts"), "utf8"), label).toBe(await readFile(join(root, "ignored/theirs.ts"), "utf8"));
    }
  });

  it("refuses an ambiguous loose match in deepagents' words and leaves the file alone", async () => {
    const content = "say(“hi”);\nsay(“hi”);\n";
    await writeFile(join(root, "ignored/a.ts"), content);
    const { backend } = await makeBackend();

    const result = await backend.edit("ignored/a.ts", 'say("hi");', 'say("bye");');

    expect(result.error).toMatch(/^Error: String 'say\("hi"\);' has multiple occurrences \(appears 2 times\) in file\./);
    expect(await readFile(join(root, "ignored/a.ts"), "utf8")).toBe(content);
  });

  it("fails as today when the file changed between the repair's read and the edit", async () => {
    await writeFile(join(root, "ignored/a.ts"), "status: draft\n");
    const { backend } = await makeBackend();
    // The read the repair makes sees a curly-quoted file that the edit then no longer finds.
    vi.spyOn(backend, "readRaw").mockResolvedValue({
      data: { content: "say(“hi”);\n", mimeType: "text/plain", created_at: "", modified_at: "" },
    });
    const warn = vi.spyOn(console, "warn");

    const result = await backend.edit("ignored/a.ts", 'say("hi");', 'say("bye");');

    expect(result.error).toBe("Error: String not found in file: 'say(\"hi\");'");
    expect(await readFile(join(root, "ignored/a.ts"), "utf8")).toBe("status: draft\n");
    expect(warn).not.toHaveBeenCalled();
  });

  it("takes today's path for a missing file and for a binary one", async () => {
    const { backend } = await makeBackend();
    const stock = stockBackend();
    expect(await backend.edit("ignored/missing.ts", "a", "b")).toEqual(await stock.edit("ignored/missing.ts", "a", "b"));

    await writeFile(join(root, "ignored/logo.png"), "it’s");
    const result = await backend.edit("ignored/logo.png", "it's", "it is");
    expect(result.error).toBe("Error: String not found in file: 'it's'");
    expect(await readFile(join(root, "ignored/logo.png"), "utf8")).toBe("it’s");
  });
});
