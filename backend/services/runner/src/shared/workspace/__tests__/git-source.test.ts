/**
 * Pins the git workspace source: the clone-in-place flow, default-branch
 * resolution, idempotent reuse, and how a repository's token reaches git —
 * through the environment of the two network commands only, for a
 * github.com URL only, never in a remote URL, argv or a file — plus the
 * reuse scrub of what earlier runners stored, the git version floor, shell
 * quoting, error sanitization, multi-entry subdirectories and git excludes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import { provisionGit } from "../sources/git.js";
import { forgetGitVersion } from "../git-credential.js";
import { WorkspaceProvisionError } from "../types.js";

/**
 * Command-routing mock for `backend.execute`.
 *
 * The git source clones in place via a sequence of git commands
 * (init → remote add → fetch → [set-head → symbolic-ref] → checkout) followed
 * by metadata extraction and optional credential setup. Rather than couple each
 * test to the exact call order, we route responses by command content and let
 * tests inspect `mock.calls` for the assertions they care about.
 */
function routingExecute(opts: {
  branch?: string;
  sha?: string;
  defaultRef?: string;
  fail?: (cmd: string) => Error | undefined;
} = {}) {
  // The origin the clone was given, as git would store it.
  let origin = "";
  return vi.fn(async (cmd: string, _options?: { cwd?: string; env?: Record<string, string> }) => {
    const failErr = opts.fail?.(cmd);
    if (failErr) throw failErr;
    const setOrigin = /^git remote (?:add|set-url) origin '(.*)'$/.exec(cmd);
    if (setOrigin !== null) origin = setOrigin[1]!;
    if (cmd === "git --version") return "git version 2.39.5\n";
    if (cmd === "git config --list --show-scope --name-only") return "local\tremote.origin.url\nlocal\tremote.origin.fetch\n";
    if (cmd === "git config --local --get remote.origin.url") return `${origin}\n`;
    if (cmd.includes("rev-parse --abbrev-ref")) return opts.branch ?? "main\n";
    if (cmd.includes("rev-parse HEAD")) return opts.sha ?? "abc123\n";
    if (cmd.includes("symbolic-ref")) return opts.defaultRef ?? "origin/main\n";
    return "";
  });
}

function calls(backend: ReturnType<typeof mockWorkspaceBackend>): string[] {
  return (backend.execute as ReturnType<typeof vi.fn>).mock.calls.map(
    (args: unknown[]) => args[0] as string,
  );
}

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://github.com/org/repo.git",
    branch: "main",
    backend: mockWorkspaceBackend({ execute: routingExecute() }),
    isLocalMode: true,
    ...overrides,
  };
}

describe("provisionGit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    forgetGitVersion();
  });

  // ── Clone-in-place command flow ───────────────────────────────────

  it("returns GIT_REPO source type", async () => {
    const result = await provisionGit(makeOptions());
    expect(result.sourceType).toBe("git_repo");
  });

  it("clones in place (init/remote/fetch/checkout) instead of git clone", async () => {
    const backend = mockWorkspaceBackend({ rootDir: "/workspace", execute: routingExecute() });
    await provisionGit(makeOptions({ backend, branch: "develop" }));

    const cmds = calls(backend);
    // A plain `git clone` is what breaks on a non-empty mount — it must be gone.
    expect(cmds.some((c) => c.startsWith("git clone") || c.includes(" clone "))).toBe(false);

    expect(cmds[0]).toContain("git init");
    expect(cmds[0]).toContain("/workspace");
    expect(cmds.some((c) => c.includes("git remote add origin"))).toBe(true);
    expect(cmds.some((c) => c.includes("git fetch"))).toBe(true);
    expect(cmds.some((c) => c.includes("git checkout 'develop'"))).toBe(true);
  });

  it("describes the clone by repo URL and branch, never by its commit", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute({ branch: "main\n", sha: "sha789\n" }),
    });
    const result = await provisionGit(makeOptions({ backend }));
    expect(result.workspaceDescription).toContain("github.com/org/repo.git");
    expect(result.workspaceDescription).toContain("(branch: main)");
    // The native system prompt carries this text on every turn; write-back
    // commits move HEAD every approved turn, so a commit here would change it.
    expect(result.workspaceDescription).not.toContain("sha789");
    expect(result.gitMetadata?.baseCommit, "the commit stays in the metadata write-back reads").toBe("sha789");
  });

  // ── Default-branch resolution ─────────────────────────────────────

  it("resolves the default branch when no branch is requested", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute({ defaultRef: "origin/trunk\n", branch: "trunk\n" }),
    });
    await provisionGit(makeOptions({ backend, branch: "" }));

    const cmds = calls(backend);
    expect(cmds.some((c) => c.includes("git remote set-head origin --auto"))).toBe(true);
    expect(cmds.some((c) => c.includes("symbolic-ref"))).toBe(true);
    expect(cmds.some((c) => c.includes("git checkout 'trunk'"))).toBe(true);
  });

  it("skips checkout when the remote exposes no default branch (empty repo)", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute({
        // symbolic-ref fails on an empty remote → resolveDefaultBranch returns ""
        fail: (cmd) => (cmd.includes("symbolic-ref") ? new Error("no HEAD") : undefined),
      }),
    });
    await provisionGit(makeOptions({ backend, branch: "" }));

    const cmds = calls(backend);
    expect(cmds.some((c) => c.includes("git checkout"))).toBe(false);
  });

  // ── Idempotent re-clone ───────────────────────────────────────────

  it("skips clone when .git already exists", async () => {
    const backend = mockWorkspaceBackend({
      exists: vi.fn().mockResolvedValue(true),
      execute: routingExecute(),
    });

    const result = await provisionGit(makeOptions({ backend }));
    expect(result.sourceType).toBe("git_repo");
    const fresh = await provisionGit(
      makeOptions({ backend: mockWorkspaceBackend({ execute: routingExecute() }) }),
    );
    expect(result.workspaceDescription, "a reused clone is described exactly as a fresh one").toBe(fresh.workspaceDescription);

    expect(calls(backend).some((c) => c.includes("git init"))).toBe(false);
    expect(calls(backend).some((c) => c.includes("git fetch"))).toBe(false);
  });

  // ── The repository's token ────────────────────────────────────────

  const TOKEN = "ghp_secret123";

  /** Every (command, env) the backend ran. */
  function runs(backend: ReturnType<typeof mockWorkspaceBackend>): Array<{ cmd: string; env?: Record<string, string> }> {
    return (backend.execute as ReturnType<typeof vi.fn>).mock.calls.map((args: unknown[]) => ({
      cmd: args[0] as string,
      env: (args[1] as { env?: Record<string, string> } | undefined)?.env,
    }));
  }

  it("hands the token to the fetch and set-head alone, through their environment, never argv or the remote URL", async () => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });
    await provisionGit(makeOptions({ backend, branch: "", token: TOKEN }));

    const withEnv = runs(backend).filter((run) => run.env !== undefined);
    expect(withEnv.map((run) => run.cmd)).toEqual(["git fetch --quiet origin", "git remote set-head origin --auto"]);
    const basic = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
    for (const run of withEnv) {
      expect(run.env).toMatchObject({
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: "/dev/null",
        GIT_CONFIG_KEY_2: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_2: `AUTHORIZATION: basic ${basic}`,
      });
    }
    for (const run of runs(backend)) expect(run.cmd).not.toContain(TOKEN);
    expect(calls(backend)).toContain("git remote add origin 'https://github.com/org/repo.git'");
  });

  it("writes no file holding the token: no credential store, no helper", async () => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });
    const result = await provisionGit(makeOptions({ backend, token: TOKEN, isLocalMode: false, writeBack: true }));

    const written = (backend.writeFile as ReturnType<typeof vi.fn>).mock.calls.map((args: unknown[]) => String(args[1]));
    for (const content of written) expect(content).not.toContain(TOKEN);
    expect(calls(backend).some((c) => c.includes("credential.helper"))).toBe(false);
    expect(result.gitMetadata?.writeBackReady, "a cloud clone with a token may be written back").toBe(true);
  });

  it("is ready for write-back only in cloud mode with a token", async () => {
    const ready = async (overrides: Record<string, unknown>) =>
      (await provisionGit(makeOptions(overrides))).gitMetadata?.writeBackReady;
    expect(await ready({ token: TOKEN, writeBack: false })).toBe(false);
    expect(await ready({ writeBack: true })).toBe(false);
    expect(await ready({ token: TOKEN, writeBack: true })).toBe(true);
  });

  it("strips credentials a GitHub URL already carries from the remote", async () => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });
    await provisionGit(makeOptions({ backend, url: "https://someone:pw@github.com/org/repo.git", token: TOKEN }));

    expect(calls(backend)).toContain("git remote add origin 'https://github.com/org/repo.git'");
  });

  it("refuses a clone that needs a token on a git older than 2.31, naming the floor", async () => {
    const execute = vi.fn(async (cmd: string) => (cmd === "git --version" ? "git version 2.30.2\n" : ""));
    const backend = mockWorkspaceBackend({ execute });

    await expect(provisionGit(makeOptions({ backend, token: TOKEN }))).rejects.toThrow(
      /this runner's git is 2\.30\.2; handing a repository's token to git without storing it needs git 2\.31 or newer/i,
    );
    expect(calls(backend).some((c) => c.includes("git fetch"))).toBe(false);
  });

  it("clones a public repository on an older git: no token, no floor", async () => {
    const execute = vi.fn(async (cmd: string) => (cmd === "git --version" ? "git version 2.30.2\n" : ""));
    const backend = mockWorkspaceBackend({ execute });

    await provisionGit(makeOptions({ backend }));

    expect(calls(backend)).toContain("git fetch --quiet origin");
  });

  // A URL that only mentions github.com is not GitHub: the token would travel
  // to whichever host the URL names.
  const lookalikes = [
    ["a longer host", "https://github.com.example.net/org/repo.git"],
    ["github.com in the path", "https://example.net/github.com/org/repo.git"],
    ["github.com as the userinfo", "https://github.com@example.net/org/repo.git"],
    ["plain http", "http://github.com/org/repo.git"],
  ];

  it.each(lookalikes)("never hands the token to git for %s", async (_label, url) => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });
    const result = await provisionGit(makeOptions({ backend, url, token: TOKEN, writeBack: true }));

    for (const run of runs(backend)) {
      expect(run.cmd).not.toContain(TOKEN);
      expect(run.env).toBeUndefined();
    }
    expect(result.gitMetadata!.writeBackReady).toBe(false);
  });

  // ── Reuse scrubs what earlier runners stored ──────────────────────

  function reusing(origin: string, stored: { credFile?: boolean; helper?: string } = {}) {
    return mockWorkspaceBackend({
      exists: vi.fn(async (path: string) => path.endsWith(".git") || (stored.credFile === true && path.endsWith(".git-credentials"))),
      execute: vi.fn(async (cmd: string) => {
        if (cmd.includes("remote get-url origin")) return `${origin}\n`;
        if (cmd.includes("--get-all credential.helper")) return stored.helper ? `${stored.helper}\n` : "";
        if (cmd.includes("rev-parse --abbrev-ref")) return "main\n";
        if (cmd.includes("rev-parse HEAD")) return "abc123\n";
        return "";
      }),
    });
  }

  it("rewrites a token-bearing origin clean, deletes the stored file and unsets the store helper", async () => {
    const backend = reusing(`https://x-access-token:${TOKEN}@github.com/org/repo.git`, {
      credFile: true,
      helper: "store --file=/tmp/test-workspace/.git/.git-credentials",
    });

    await provisionGit(makeOptions({ backend, token: TOKEN }));

    const cmds = calls(backend);
    expect(cmds).toContain("git remote set-url origin 'https://github.com/org/repo.git'");
    expect(cmds).toContain("rm -f '/tmp/test-workspace/.git/.git-credentials'");
    expect(cmds.some((c) => c.startsWith("git config --local --unset-all credential.helper"))).toBe(true);
    expect(cmds.some((c) => c.includes("git fetch")), "reuse fetches nothing").toBe(false);
  });

  it("leaves a clean clone, and a helper the owner set, alone", async () => {
    const backend = reusing("https://github.com/org/repo.git", { helper: "osxkeychain" });

    await provisionGit(makeOptions({ backend }));

    const cmds = calls(backend);
    expect(cmds.some((c) => c.includes("set-url"))).toBe(false);
    expect(cmds.some((c) => c.startsWith("rm "))).toBe(false);
    expect(cmds.some((c) => c.includes("--unset-all"))).toBe(false);
  });

  it("keeps going when the scrub cannot read the clone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const backend = mockWorkspaceBackend({
      exists: vi.fn().mockResolvedValue(true),
      execute: vi.fn(async (cmd: string) => {
        if (cmd.includes("get-url") || cmd.startsWith("rm ")) throw new Error("locked");
        if (cmd.includes("--get-all")) return "store --file=/x/.git/.git-credentials\n";
        if (cmd.includes("--unset-all")) throw new Error("locked");
        return "";
      }),
    });

    const result = await provisionGit(makeOptions({ backend }));

    expect(result.sourceType).toBe("git_repo");
    expect(warn).toHaveBeenCalledTimes(3);
  });

  // ── Shell quoting ─────────────────────────────────────────────────

  it("passes a URL holding a quote to git as one argument", async () => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });
    await provisionGit(makeOptions({
      backend,
      url: "https://gitlab.com/org/repo';touch pwned;'.git",
    }));

    const remoteAdd = calls(backend).find((c) => c.includes("git remote add origin"));
    expect(remoteAdd).toBe("git remote add origin 'https://gitlab.com/org/repo'\\'';touch pwned;'\\''.git'");
  });

  it("passes a branch holding a quote to git as one argument", async () => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });
    await provisionGit(makeOptions({ backend, branch: "main';touch pwned;'" }));

    const checkout = calls(backend).find((c) => c.startsWith("git checkout"));
    expect(checkout).toBe("git checkout 'main'\\'';touch pwned;'\\'''");
  });

  // ── Token sanitization in errors ──────────────────────────────────

  it("sanitizes token in error messages", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute({
        fail: (cmd) => (cmd.includes("git fetch")
          ? new Error(
            "fatal: unable to access 'https://x-access-token:ghp_secret@github.com/org/repo.git': Could not resolve host",
          )
          : undefined),
      }),
    });

    try {
      await provisionGit(makeOptions({
        backend,
        token: "ghp_secret",
      }));
      expect.unreachable("provisionGit should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceProvisionError);
      expect((err as Error).message).not.toContain("ghp_secret");
      expect((err as Error).message).toContain("***");
    }
  });

  it("marks clone errors as transient", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute({
        fail: (cmd) => (cmd.includes("git fetch") ? new Error("network timeout") : undefined),
      }),
    });

    try {
      await provisionGit(makeOptions({ backend }));
      expect.unreachable("provisionGit should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceProvisionError);
      expect((err as WorkspaceProvisionError).transient).toBe(true);
    }
  });

  // ── targetSubdir (multi-entry) ────────────────────────────────────

  it("clones into targetSubdir when provided", async () => {
    const backend = mockWorkspaceBackend({ rootDir: "/workspace", execute: routingExecute() });
    (backend.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const result = await provisionGit(makeOptions({
      backend,
      targetSubdir: "frontend",
    }));

    const initCmd = calls(backend).find((c) => c.includes("git init"));
    expect(initCmd!).toContain("/workspace/frontend");
    expect(result.rootDir).toBe("/workspace/frontend");
  });

  it("checks .git existence in targetSubdir", async () => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });
    (backend.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await provisionGit(makeOptions({ backend, targetSubdir: "app" }));

    expect(backend.exists).toHaveBeenCalledWith("app/.git");
  });

  // ── Git excludes ──────────────────────────────────────────────────

  it("adds .stigmer and lost+found to git excludes", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute(),
      readFile: vi.fn().mockResolvedValue("# existing\n"),
    });

    await provisionGit(makeOptions({ backend }));

    expect(backend.writeFile).toHaveBeenCalledWith(
      ".git/info/exclude",
      expect.stringContaining(".stigmer"),
    );
    expect(backend.writeFile).toHaveBeenCalledWith(
      ".git/info/exclude",
      expect.stringContaining("lost+found"),
    );
  });

  it("does not rewrite excludes when all entries already present", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute(),
      readFile: vi.fn().mockResolvedValue("# existing\n.stigmer\nlost+found\n"),
    });

    await provisionGit(makeOptions({ backend }));

    expect(backend.writeFile).not.toHaveBeenCalled();
  });

  it("adds only the missing exclude entry", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute(),
      readFile: vi.fn().mockResolvedValue("# existing\n.stigmer\n"),
    });

    await provisionGit(makeOptions({ backend }));

    const excludeWrite = (backend.writeFile as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => (args[0] as string).includes(".git/info/exclude"),
    );
    expect(excludeWrite).toBeDefined();
    const written = excludeWrite![1] as string;
    expect(written).toContain("lost+found");
    // .stigmer was already present, so it must appear exactly once (not re-appended).
    expect(written.match(/\.stigmer/g)?.length ?? 0).toBe(1);
    expect(written.match(/lost\+found/g)?.length ?? 0).toBe(1);
  });

  // ── Git metadata extraction ───────────────────────────────────────

  it("extracts branch and commit from git commands", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute({ branch: "feature\n", sha: "deadbeef\n" }),
    });

    const result = await provisionGit(makeOptions({ backend }));

    expect(result.gitMetadata!.branch).toBe("feature");
    expect(result.gitMetadata!.baseCommit).toBe("deadbeef");
    expect(result.gitMetadata!.repoUrl).toBe("https://github.com/org/repo.git");
  });

  it("strips token from git metadata repoUrl", async () => {
    const result = await provisionGit(makeOptions({
      url: "https://x-access-token:ghp_xxx@github.com/org/repo.git",
    }));

    expect(result.gitMetadata!.repoUrl).toBe("https://github.com/org/repo.git");
  });

  it("handles failed git metadata extraction gracefully", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute({
        fail: (cmd) => (cmd.includes("rev-parse") ? new Error("not a git repo") : undefined),
      }),
    });

    const result = await provisionGit(makeOptions({ backend }));
    expect(result.gitMetadata!.branch).toBe("");
    expect(result.gitMetadata!.baseCommit).toBe("");
  });
});
