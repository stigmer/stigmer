import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import { provisionGit } from "../sources/git.js";
import { SourceType, WorkspaceProvisionError } from "../types.js";

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://github.com/org/repo.git",
    branch: "main",
    backend: mockWorkspaceBackend(),
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

  // ── Basic clone ───────────────────────────────────────────────────

  it("returns GIT_REPO source type", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")          // clone
      .mockResolvedValueOnce("main\n")    // branch
      .mockResolvedValueOnce("abc123\n")  // HEAD sha
      .mockResolvedValue("");             // excludes

    const result = await provisionGit(makeOptions({ backend }));
    expect(result.sourceType).toBe(SourceType.GIT_REPO);
  });

  it("clone command includes branch args", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("def456\n")
      .mockResolvedValue("");

    await provisionGit(makeOptions({ backend, branch: "develop" }));

    const cloneCall = (backend.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(cloneCall).toContain("'-b' 'develop'");
    expect(cloneCall).toContain("git clone");
  });

  it("sets workspace description with repo URL and branch", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("sha789\n")
      .mockResolvedValue("");

    const result = await provisionGit(makeOptions({ backend }));
    expect(result.workspaceDescription).toContain("github.com/org/repo.git");
    expect(result.workspaceDescription).toContain("main");
    expect(result.workspaceDescription).toContain("sha789");
  });

  // ── Idempotent re-clone ───────────────────────────────────────────

  it("skips clone when .git already exists", async () => {
    const backend = mockWorkspaceBackend({
      exists: vi.fn().mockResolvedValue(true),
    });
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("main\n")    // branch
      .mockResolvedValueOnce("abc123\n"); // HEAD sha

    const result = await provisionGit(makeOptions({ backend }));
    expect(result.sourceType).toBe(SourceType.GIT_REPO);
    expect(result.workspaceDescription).toContain("existing repo detected");

    const calls = (backend.execute as ReturnType<typeof vi.fn>).mock.calls;
    const hasClone = calls.some((args: unknown[]) => (args[0] as string).includes("git clone"));
    expect(hasClone).toBe(false);
  });

  it("returns empty consumedKeys when reusing existing repo", async () => {
    const backend = mockWorkspaceBackend({
      exists: vi.fn().mockResolvedValue(true),
    });
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("abc\n");

    const result = await provisionGit(makeOptions({ backend }));
    expect(result.consumedKeys).toEqual([]);
  });

  // ── GitHub token injection ────────────────────────────────────────

  it("injects GitHub token into clone URL", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("abc\n")
      .mockResolvedValue("");

    await provisionGit(makeOptions({
      backend,
      envVars: { GITHUB_TOKEN: "ghp_secret123" },
    }));

    const cloneCmd = (backend.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(cloneCmd).toContain("x-access-token:ghp_secret123@github.com");
  });

  it("adds GITHUB_TOKEN to consumedKeys when used", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("abc\n")
      .mockResolvedValue("");

    const result = await provisionGit(makeOptions({
      backend,
      envVars: { GITHUB_TOKEN: "ghp_secret123" },
    }));

    expect(result.consumedKeys).toContain("GITHUB_TOKEN");
  });

  it("does not inject token for non-GitHub URLs", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("abc\n")
      .mockResolvedValue("");

    const result = await provisionGit(makeOptions({
      backend,
      url: "https://gitlab.com/org/repo.git",
      envVars: { GITHUB_TOKEN: "ghp_secret123" },
    }));

    const cloneCmd = (backend.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(cloneCmd).not.toContain("x-access-token");
    expect(result.consumedKeys).toEqual([]);
  });

  // ── Token sanitization in errors ──────────────────────────────────

  it("sanitizes token in error messages", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error(
        "fatal: unable to access 'https://x-access-token:ghp_secret@github.com/org/repo.git': Could not resolve host",
      ));

    await expect(
      provisionGit(makeOptions({
        backend,
        envVars: { GITHUB_TOKEN: "ghp_secret" },
      })),
    ).rejects.toThrow(WorkspaceProvisionError);

    try {
      await provisionGit(makeOptions({
        backend: mockWorkspaceBackend({
          execute: vi.fn().mockRejectedValueOnce(
            new Error("failed with ghp_secret in url"),
          ),
        }),
        envVars: { GITHUB_TOKEN: "ghp_secret" },
      }));
    } catch (err) {
      expect((err as Error).message).not.toContain("ghp_secret");
      expect((err as Error).message).toContain("***");
    }
  });

  it("marks clone errors as transient", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("network timeout"));

    try {
      await provisionGit(makeOptions({ backend }));
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceProvisionError);
      expect((err as WorkspaceProvisionError).transient).toBe(true);
    }
  });

  // ── targetSubdir (multi-entry) ────────────────────────────────────

  it("clones into targetSubdir when provided", async () => {
    const backend = mockWorkspaceBackend({ rootDir: "/workspace" });
    (backend.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("abc\n")
      .mockResolvedValue("");

    const result = await provisionGit(makeOptions({
      backend,
      targetSubdir: "frontend",
    }));

    const cloneCmd = (backend.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(cloneCmd).toContain("/workspace/frontend");
    expect(result.rootDir).toBe("/workspace/frontend");
  });

  it("checks .git existence in targetSubdir", async () => {
    const backend = mockWorkspaceBackend();
    (backend.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("abc\n")
      .mockResolvedValue("");

    await provisionGit(makeOptions({ backend, targetSubdir: "app" }));

    expect(backend.exists).toHaveBeenCalledWith("app/.git");
  });

  // ── Git excludes ──────────────────────────────────────────────────

  it("adds .stigmer to git excludes", async () => {
    const backend = mockWorkspaceBackend({
      readFile: vi.fn().mockResolvedValue("# existing\n"),
    });
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("abc\n");

    await provisionGit(makeOptions({ backend }));

    expect(backend.writeFile).toHaveBeenCalledWith(
      ".git/info/exclude",
      expect.stringContaining(".stigmer"),
    );
  });

  it("does not duplicate .stigmer in excludes", async () => {
    const backend = mockWorkspaceBackend({
      readFile: vi.fn().mockResolvedValue("# existing\n.stigmer\n"),
    });
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("abc\n");

    await provisionGit(makeOptions({ backend }));

    expect(backend.writeFile).not.toHaveBeenCalled();
  });

  // ── Git metadata extraction ───────────────────────────────────────

  it("extracts branch and commit from git commands", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")           // clone
      .mockResolvedValueOnce("feature\n")  // branch
      .mockResolvedValueOnce("deadbeef\n") // HEAD sha
      .mockResolvedValue("");              // excludes

    const result = await provisionGit(makeOptions({ backend }));

    expect(result.gitMetadata!.branch).toBe("feature");
    expect(result.gitMetadata!.baseCommit).toBe("deadbeef");
    expect(result.gitMetadata!.repoUrl).toBe("https://github.com/org/repo.git");
  });

  it("strips token from git metadata repoUrl", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main\n")
      .mockResolvedValueOnce("abc\n")
      .mockResolvedValue("");

    const result = await provisionGit(makeOptions({
      backend,
      url: "https://x-access-token:ghp_xxx@github.com/org/repo.git",
    }));

    expect(result.gitMetadata!.repoUrl).toBe("https://github.com/org/repo.git");
  });

  it("handles failed git metadata extraction gracefully", async () => {
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")        // clone
      .mockRejectedValueOnce(new Error("not a git repo")) // branch
      .mockRejectedValueOnce(new Error("no HEAD"))        // sha
      .mockResolvedValue("");           // excludes

    const result = await provisionGit(makeOptions({ backend }));
    expect(result.gitMetadata!.branch).toBe("");
    expect(result.gitMetadata!.baseCommit).toBe("");
  });
});
