/**
 * Pins session workspace provisioning: git repositories are cloned
 * locally (never delegated to a cloud agent), with their history, at the
 * commit a repository names when it names one; local folders are mounted; and a
 * session with no repository or folder (Files alone are none) gets its own
 * empty per-session root.
 * Harness-agnostic; the Cursor activity was its only caller until the turn
 * runtime took it over in #1070.
 *
 * Uses a real, hermetic local git repository (no network, no harness API) so
 * the clone is deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  FileResourceSchema,
  GitRepositoryResourceSchema,
  LocalPathResourceSchema,
  SessionResourceSchema,
  type SessionResource,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { provisionSessionWorkspace, type SessionProvisionConfig } from "../session-provision.js";

const MARKER_FILE = "MARKER.txt";
const MARKER_CONTENT = "stigmer-cursor-clone-proof-7e3a1c";

let tmpRoot: string;
let originalHome: string | undefined;

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@stigmer.ai",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@stigmer.ai",
    },
  });
}

/** Creates a bare-minimum git repo on the given branch with a marker file. */
function seedSourceRepo(branch = "main", content = MARKER_CONTENT): string {
  const repo = mkdtempSync(join(tmpRoot, "src-repo-"));
  git(repo, ["init", "-b", branch]);
  writeFileSync(join(repo, MARKER_FILE), content);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "seed"]);
  return repo;
}

function makeConfig(workspaceRootDir: string): SessionProvisionConfig {
  return { mode: "local", workspaceRootDir };
}

function sessionOf(resources: SessionResource[]): Session {
  return { spec: { resources } } as unknown as Session;
}

function gitRepository(name: string, url: string, fields: { branch?: string; commit?: string } = {}): SessionResource {
  return create(SessionResourceSchema, {
    name,
    resource: { case: "gitRepository", value: create(GitRepositoryResourceSchema, { url, ...fields }) },
  });
}

/** A File the conversation holds: a resource of the session, no part of its workspace. */
function fileResource(fileId: string): SessionResource {
  return create(SessionResourceSchema, {
    resource: { case: "file", value: create(FileResourceSchema, { fileId, mountPath: `${fileId}.txt` }) },
  });
}

function gitRepoSession(url: string, branch = "main"): Session {
  return sessionOf([gitRepository("repo", url, { branch })]);
}

/** Single git repository with no branch set (proto default ""). */
function gitRepoSessionNoBranch(url: string): Session {
  return sessionOf([gitRepository("repo", url)]);
}

/** Multiple git repositories (multi-repo workspace). */
function multiGitRepoSession(repos: { name: string; url: string }[]): Session {
  return sessionOf(repos.map(({ name, url }) => gitRepository(name, url, { branch: "main" })));
}

function localPathSession(path: string): Session {
  return sessionOf([
    create(SessionResourceSchema, {
      name: "local",
      resource: { case: "localPath", value: create(LocalPathResourceSchema, { path }) },
    }),
  ]);
}

function emptySession(): Session {
  return sessionOf([]);
}

// Real git spawns (init/commit/clone) are slow under parallel test load, so
// these tests use a generous timeout instead of vitest's 5s default.
const GIT_TEST_TIMEOUT_MS = 30_000;

describe("provisionSessionWorkspace", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "cursor-ws-"));
    // Redirect the platform dir (~/.stigmer/...) into the temp tree so the
    // test does not pollute the developer's home directory.
    originalHome = process.env.HOME;
    process.env.HOME = join(tmpRoot, "home");
    mkdirSync(process.env.HOME, { recursive: true });
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("clones a git-repo workspace entry into the workspace root", async () => {
    const source = seedSourceRepo();
    const workspaceRoot = join(tmpRoot, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });

    const { workspaceDirs: dirs, provisionResults, workspaceBackend } =
      await provisionSessionWorkspace(
        makeConfig(workspaceRoot),
        gitRepoSession(source),
        [],
        "test-session-clone",
      );

    expect(dirs).toHaveLength(1);
    const clonedFile = join(dirs[0], MARKER_FILE);
    expect(existsSync(clonedFile)).toBe(true);
    expect(readFileSync(clonedFile, "utf-8")).toBe(MARKER_CONTENT);
    // The clone must be a real git repo (so the agent can run git in it).
    expect(existsSync(join(dirs[0], ".git"))).toBe(true);

    // The provision results carry the git metadata the write-back
    // coordinator consumes (repo URL, base branch), through the same backend.
    expect(provisionResults).toHaveLength(1);
    expect(provisionResults[0].gitMetadata?.branch).toBe("main");
    expect(workspaceBackend).toBeDefined();
  }, GIT_TEST_TIMEOUT_MS);

  it("checks out the commit a repository names on its branch, with the branch's history", async () => {
    const source = seedSourceRepo("main", "first");
    const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf-8" }).trim();
    writeFileSync(join(source, MARKER_FILE), "second");
    git(source, ["commit", "-am", "second"]);
    const workspaceRoot = join(tmpRoot, "commit-workspace");
    mkdirSync(workspaceRoot, { recursive: true });

    const { workspaceDirs: dirs, provisionResults } = await provisionSessionWorkspace(
      makeConfig(workspaceRoot),
      sessionOf([gitRepository("repo", source, { branch: "main", commit: first })]),
      [],
      "test-session-commit",
    );

    expect(readFileSync(join(dirs[0]!, MARKER_FILE), "utf-8")).toBe("first");
    const head = (args: string[]) => execFileSync("git", args, { cwd: dirs[0]!, encoding: "utf-8" }).trim();
    expect(head(["rev-parse", "HEAD"])).toBe(first);
    expect(head(["rev-parse", "--abbrev-ref", "HEAD"]), "the clone stays on its branch, the base write-back opens against").toBe("main");
    expect(provisionResults[0]!.gitMetadata?.baseCommit).toBe(first);
    expect(head(["rev-parse", "--is-shallow-repository"])).toBe("false");
    expect(head(["rev-parse", "origin/main"]), "the remote branch still names its tip").not.toBe(first);
  }, GIT_TEST_TIMEOUT_MS);

  it("clones the branch's tip, with its history, when the repository names no commit", async () => {
    const source = seedSourceRepo();
    writeFileSync(join(source, MARKER_FILE), "tip");
    git(source, ["commit", "-am", "tip"]);
    const workspaceRoot = join(tmpRoot, "tip-workspace");
    mkdirSync(workspaceRoot, { recursive: true });

    const { workspaceDirs: dirs } = await provisionSessionWorkspace(makeConfig(workspaceRoot), gitRepoSession(source), [], "test-session-tip");

    expect(readFileSync(join(dirs[0]!, MARKER_FILE), "utf-8")).toBe("tip");
    expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dirs[0]!, encoding: "utf-8" }).trim()).toBe("2");
  }, GIT_TEST_TIMEOUT_MS);

  it("leaves the session's Files out of its workspace: a repository beside a File is cloned in place", async () => {
    const source = seedSourceRepo();
    const workspaceRoot = join(tmpRoot, "file-beside-repo");
    mkdirSync(workspaceRoot, { recursive: true });

    const { workspaceDirs: dirs } = await provisionSessionWorkspace(
      makeConfig(workspaceRoot),
      sessionOf([fileResource("file_1"), gitRepository("repo", source, { branch: "main" })]),
      [],
      "test-session-file-and-repo",
    );

    expect(dirs).toEqual([workspaceRoot]);
    expect(existsSync(join(workspaceRoot, MARKER_FILE))).toBe(true);
  }, GIT_TEST_TIMEOUT_MS);

  it("gives a session holding only Files its own empty per-session directory", async () => {
    const workspaceRoot = join(tmpRoot, "files-only");
    mkdirSync(workspaceRoot, { recursive: true });

    const { workspaceDirs: dirs, provisionResults } = await provisionSessionWorkspace(
      makeConfig(workspaceRoot),
      sessionOf([fileResource("file_1")]),
      [],
      "test-session-files-only",
    );

    expect(provisionResults).toEqual([]);
    expect(dirs).toEqual([join(workspaceRoot, "sessions", "test-session-files-only")]);
  }, GIT_TEST_TIMEOUT_MS);

  it("clones into a workspace root that already contains lost+found (PVC simulation)", async () => {
    // A freshly provisioned ext4 PersistentVolume ships a `lost+found` directory
    // at its mount root, making `/workspace` non-empty before the first clone.
    const source = seedSourceRepo();
    const workspaceRoot = join(tmpRoot, "pvc-workspace");
    mkdirSync(join(workspaceRoot, "lost+found"), { recursive: true });
    writeFileSync(join(workspaceRoot, "lost+found", "stray"), "fsck-artifact");

    const { workspaceDirs: dirs } = await provisionSessionWorkspace(
      makeConfig(workspaceRoot),
      gitRepoSession(source),
      [],
      "test-session-lostfound",
    );

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(workspaceRoot);

    // The clone must have succeeded despite the non-empty root.
    const clonedFile = join(workspaceRoot, MARKER_FILE);
    expect(existsSync(clonedFile)).toBe(true);
    expect(readFileSync(clonedFile, "utf-8")).toBe(MARKER_CONTENT);
    expect(existsSync(join(workspaceRoot, ".git"))).toBe(true);

    // The PVC artifact must be preserved and git-excluded so the agent never
    // sees it as an untracked change.
    expect(existsSync(join(workspaceRoot, "lost+found", "stray"))).toBe(true);
    const exclude = readFileSync(join(workspaceRoot, ".git", "info", "exclude"), "utf-8");
    expect(exclude).toContain("lost+found");

    // git itself must agree the working tree is clean (no lost+found noise).
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });
    expect(status.trim()).toBe("");
  }, GIT_TEST_TIMEOUT_MS);

  it("resolves the default branch when the session entry omits a branch", async () => {
    const source = seedSourceRepo("trunk");
    const workspaceRoot = join(tmpRoot, "default-branch-workspace");
    mkdirSync(workspaceRoot, { recursive: true });

    const { workspaceDirs: dirs } = await provisionSessionWorkspace(
      makeConfig(workspaceRoot),
      gitRepoSessionNoBranch(source),
      [],
      "test-session-default-branch",
    );

    expect(dirs).toHaveLength(1);
    expect(existsSync(join(workspaceRoot, MARKER_FILE))).toBe(true);

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    }).trim();
    expect(branch).toBe("trunk");
  }, GIT_TEST_TIMEOUT_MS);

  it("clones multiple git-repo entries into per-entry subdirectories", async () => {
    const frontend = seedSourceRepo("main", "frontend-marker");
    const backend = seedSourceRepo("main", "backend-marker");
    const workspaceRoot = join(tmpRoot, "multi-workspace");
    // The PVC root carries lost+found even in multi-entry mode; the root is not
    // a worktree here, so it must be left untouched.
    mkdirSync(join(workspaceRoot, "lost+found"), { recursive: true });

    const { workspaceDirs: dirs } = await provisionSessionWorkspace(
      makeConfig(workspaceRoot),
      multiGitRepoSession([
        { name: "frontend", url: frontend },
        { name: "backend", url: backend },
      ]),
      [],
      "test-session-multi",
    );

    expect(dirs).toHaveLength(2);
    expect(new Set(dirs).size).toBe(2);

    const frontendDir = join(workspaceRoot, "frontend");
    const backendDir = join(workspaceRoot, "backend");
    expect(dirs).toContain(frontendDir);
    expect(dirs).toContain(backendDir);

    expect(readFileSync(join(frontendDir, MARKER_FILE), "utf-8")).toBe("frontend-marker");
    expect(readFileSync(join(backendDir, MARKER_FILE), "utf-8")).toBe("backend-marker");
    expect(existsSync(join(frontendDir, ".git"))).toBe(true);
    expect(existsSync(join(backendDir, ".git"))).toBe(true);

    // The root lost+found is preserved and is not a git repo itself.
    expect(existsSync(join(workspaceRoot, "lost+found"))).toBe(true);
    expect(existsSync(join(workspaceRoot, ".git"))).toBe(false);
  }, GIT_TEST_TIMEOUT_MS);

  it("gives a session with no workspace entries its own empty per-session directory", async () => {
    // A session with no repository or folder works in an empty workspace
    // directory of its own. The shared root would leak other sessions' files
    // into a "new" session (and falsely serialize unrelated sessions under
    // the workspace turn lock), so no-entry sessions get sessions/{sessionId}.
    const workspaceRoot = join(tmpRoot, "empty-workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    // Leftovers from other sessions at the shared root must not be visible.
    writeFileSync(join(workspaceRoot, "other-session-leftover.md"), "not yours");

    const { workspaceDirs: dirs, provisionResults } = await provisionSessionWorkspace(
      makeConfig(workspaceRoot),
      emptySession(),
      [],
      "test-session-empty",
    );

    expect(provisionResults).toEqual([]);
    expect(dirs).toEqual([join(workspaceRoot, "sessions", "test-session-empty")]);
    expect(existsSync(dirs[0])).toBe(true);
    expect(existsSync(join(dirs[0], "other-session-leftover.md"))).toBe(false);
  }, GIT_TEST_TIMEOUT_MS);

  it("resolves the same per-session directory on every turn of a no-entry session", async () => {
    const workspaceRoot = join(tmpRoot, "empty-workspace-stable");
    mkdirSync(workspaceRoot, { recursive: true });
    const config = makeConfig(workspaceRoot);

    const turn1 = (await provisionSessionWorkspace(config, emptySession(), [], "stable-session")).workspaceDirs;
    writeFileSync(join(turn1[0], "notes.md"), "turn 1 output");
    const turn2 = (await provisionSessionWorkspace(config, emptySession(), [], "stable-session")).workspaceDirs;

    expect(turn2).toEqual(turn1);
    expect(readFileSync(join(turn2[0], "notes.md"), "utf-8")).toBe("turn 1 output");
  }, GIT_TEST_TIMEOUT_MS);

  it("isolates distinct no-entry sessions from each other", async () => {
    const workspaceRoot = join(tmpRoot, "empty-workspace-isolated");
    mkdirSync(workspaceRoot, { recursive: true });
    const config = makeConfig(workspaceRoot);

    const [dirA] = (await provisionSessionWorkspace(config, emptySession(), [], "session-a")).workspaceDirs;
    const [dirB] = (await provisionSessionWorkspace(config, emptySession(), [], "session-b")).workspaceDirs;

    expect(dirA).not.toBe(dirB);
    writeFileSync(join(dirA, "a.md"), "session a");
    expect(existsSync(join(dirB, "a.md"))).toBe(false);
  }, GIT_TEST_TIMEOUT_MS);

  it("mounts a local-path workspace entry without cloning", async () => {
    const projectDir = join(tmpRoot, "existing-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "file.txt"), "local");
    const workspaceRoot = join(tmpRoot, "workspace-local");
    mkdirSync(workspaceRoot, { recursive: true });

    const { workspaceDirs: dirs } = await provisionSessionWorkspace(
      makeConfig(workspaceRoot),
      localPathSession(projectDir),
      [],
      "test-session-local",
    );

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(projectDir);
  }, GIT_TEST_TIMEOUT_MS);
});
