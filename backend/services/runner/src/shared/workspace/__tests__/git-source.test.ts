import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import { provisionGit } from "../sources/git.js";
import { SourceType, WorkspaceProvisionError } from "../types.js";

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
  return vi.fn(async (cmd: string) => {
    const failErr = opts.fail?.(cmd);
    if (failErr) throw failErr;
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
    envVars: {} as Record<string, string>,
    isLocalMode: true,
    ...overrides,
  };
}

describe("provisionGit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  // ── Clone-in-place command flow ───────────────────────────────────

  it("returns GIT_REPO source type", async () => {
    const result = await provisionGit(makeOptions());
    expect(result.sourceType).toBe(SourceType.GIT_REPO);
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

  it("sets workspace description with repo URL and branch", async () => {
    const backend = mockWorkspaceBackend({
      execute: routingExecute({ branch: "main\n", sha: "sha789\n" }),
    });
    const result = await provisionGit(makeOptions({ backend }));
    expect(result.workspaceDescription).toContain("github.com/org/repo.git");
    expect(result.workspaceDescription).toContain("main");
    expect(result.workspaceDescription).toContain("sha789");
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
    expect(result.sourceType).toBe(SourceType.GIT_REPO);
    expect(result.workspaceDescription).toContain("existing repo detected");

    expect(calls(backend).some((c) => c.includes("git init"))).toBe(false);
    expect(calls(backend).some((c) => c.includes("git fetch"))).toBe(false);
  });

  it("returns empty consumedKeys when reusing existing repo", async () => {
    const backend = mockWorkspaceBackend({
      exists: vi.fn().mockResolvedValue(true),
      execute: routingExecute(),
    });
    const result = await provisionGit(makeOptions({ backend }));
    expect(result.consumedKeys).toEqual([]);
  });

  // ── GitHub token injection ────────────────────────────────────────

  it("injects GitHub token into the origin remote URL", async () => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });
    await provisionGit(makeOptions({
      backend,
      envVars: { GITHUB_TOKEN: "ghp_secret123" },
    }));

    const remoteAdd = calls(backend).find((c) => c.includes("git remote add origin"));
    expect(remoteAdd).toBeDefined();
    expect(remoteAdd!).toContain("x-access-token:ghp_secret123@github.com");
  });

  it("adds GITHUB_TOKEN to consumedKeys when used", async () => {
    const result = await provisionGit(makeOptions({
      envVars: { GITHUB_TOKEN: "ghp_secret123" },
    }));
    expect(result.consumedKeys).toContain("GITHUB_TOKEN");
  });

  it("does not inject token for non-GitHub URLs", async () => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });
    const result = await provisionGit(makeOptions({
      backend,
      url: "https://gitlab.com/org/repo.git",
      envVars: { GITHUB_TOKEN: "ghp_secret123" },
    }));

    const remoteAdd = calls(backend).find((c) => c.includes("git remote add origin"));
    expect(remoteAdd!).not.toContain("x-access-token");
    expect(result.consumedKeys).toEqual([]);
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
        envVars: { GITHUB_TOKEN: "ghp_secret" },
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

  // ── Credential configuration ─────────────────────────────────────

  it("configures git credentials when configureCredentials=true and token is present", async () => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });

    const result = await provisionGit(makeOptions({
      backend,
      envVars: { GITHUB_TOKEN: "ghp_testtoken" },
      configureCredentials: true,
    }));

    expect(result.gitMetadata!.gitCredentialsConfigured).toBe(true);

    const cmds = calls(backend);
    const setUrlCall = cmds.find((c) => c.includes("git remote set-url"));
    expect(setUrlCall).toBeDefined();
    expect(setUrlCall!).toContain("https://github.com/org/repo.git");
    expect(setUrlCall!).not.toContain("ghp_testtoken");

    const configCall = cmds.find((c) => c.includes("credential.helper"));
    expect(configCall).toBeDefined();
    expect(configCall!).toContain("store --file=");
    expect(configCall!).toContain(".git-credentials");

    expect(backend.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".git-credentials"),
      expect.stringContaining("x-access-token:ghp_testtoken@github.com"),
    );
  });

  it("does not configure credentials when configureCredentials is false", async () => {
    const backend = mockWorkspaceBackend({ execute: routingExecute() });

    const result = await provisionGit(makeOptions({
      backend,
      envVars: { GITHUB_TOKEN: "ghp_testtoken" },
      configureCredentials: false,
    }));

    expect(result.gitMetadata!.gitCredentialsConfigured).toBe(false);
    expect(calls(backend).some((c) => c.includes("credential.helper"))).toBe(false);
  });

  it("does not configure credentials when no GITHUB_TOKEN", async () => {
    const result = await provisionGit(makeOptions({
      envVars: {},
      configureCredentials: true,
    }));

    expect(result.gitMetadata!.gitCredentialsConfigured).toBe(false);
  });

  it("does not configure credentials for non-GitHub URLs", async () => {
    const result = await provisionGit(makeOptions({
      url: "https://gitlab.com/org/repo.git",
      envVars: { GITHUB_TOKEN: "ghp_testtoken" },
      configureCredentials: true,
    }));

    expect(result.gitMetadata!.gitCredentialsConfigured).toBe(false);
  });

  it("configures credentials on existing repo reuse", async () => {
    const backend = mockWorkspaceBackend({
      exists: vi.fn().mockResolvedValue(true),
      execute: routingExecute(),
    });

    const result = await provisionGit(makeOptions({
      backend,
      envVars: { GITHUB_TOKEN: "ghp_reuse" },
      configureCredentials: true,
    }));

    expect(result.gitMetadata!.gitCredentialsConfigured).toBe(true);
    expect(result.workspaceDescription).toContain("existing repo detected");
  });

  it("handles credential setup failure gracefully", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const backend = mockWorkspaceBackend({
      execute: routingExecute({
        fail: (cmd) => (cmd.includes("git remote set-url")
          ? new Error("permission denied")
          : undefined),
      }),
    });

    const result = await provisionGit(makeOptions({
      backend,
      envVars: { GITHUB_TOKEN: "ghp_fail" },
      configureCredentials: true,
    }));

    expect(result.gitMetadata!.gitCredentialsConfigured).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[git] Failed to clean remote URL"),
    );
    warnSpy.mockRestore();
  });
});
