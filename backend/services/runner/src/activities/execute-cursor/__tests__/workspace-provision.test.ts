import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
  GitRepoSourceSchema,
  LocalPathSourceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Config } from "../../../config.js";
import { provisionCursorWorkspace } from "../workspace-provision.js";

/**
 * Verifies that the Cursor harness provisions git-repo workspace entries
 * locally (clones them) instead of relying on Cursor cloud agents. This is
 * the behavior that makes git-backed Cursor sessions work now that cloud is
 * disabled.
 *
 * Uses a real, hermetic local git repository (no network, no Cursor API) so
 * the clone is deterministic.
 */

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

/** Creates a bare-minimum git repo on branch `main` with a marker file. */
function seedSourceRepo(): string {
  const repo = mkdtempSync(join(tmpRoot, "src-repo-"));
  git(repo, ["init", "-b", "main"]);
  writeFileSync(join(repo, MARKER_FILE), MARKER_CONTENT);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "seed"]);
  return repo;
}

function makeConfig(workspaceRootDir: string): Config {
  return {
    mode: "local",
    workspaceRootDir,
  } as unknown as Config;
}

function gitRepoSession(url: string, branch = "main"): Session {
  const entry: WorkspaceEntry = create(WorkspaceEntrySchema, {
    name: "repo",
    source: create(WorkspaceSourceSchema, {
      source: { case: "gitRepo", value: create(GitRepoSourceSchema, { url, branch }) },
    }),
  });
  return { spec: { workspaceEntries: [entry] } } as unknown as Session;
}

function localPathSession(path: string): Session {
  const entry: WorkspaceEntry = create(WorkspaceEntrySchema, {
    name: "local",
    source: create(WorkspaceSourceSchema, {
      source: { case: "localPath", value: create(LocalPathSourceSchema, { path }) },
    }),
  });
  return { spec: { workspaceEntries: [entry] } } as unknown as Session;
}

function emptySession(): Session {
  return { spec: { workspaceEntries: [] } } as unknown as Session;
}

// Real git spawns (init/commit/clone) are slow under parallel test load, so
// these tests use a generous timeout instead of vitest's 5s default.
const GIT_TEST_TIMEOUT_MS = 30_000;

describe("provisionCursorWorkspace", () => {
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

    const dirs = await provisionCursorWorkspace(
      makeConfig(workspaceRoot),
      gitRepoSession(source),
      {},
      "test-session-clone",
    );

    expect(dirs).toHaveLength(1);
    const clonedFile = join(dirs[0], MARKER_FILE);
    expect(existsSync(clonedFile)).toBe(true);
    expect(readFileSync(clonedFile, "utf-8")).toBe(MARKER_CONTENT);
    // The clone must be a real git repo (so the agent can run git in it).
    expect(existsSync(join(dirs[0], ".git"))).toBe(true);
  }, GIT_TEST_TIMEOUT_MS);

  it("falls back to the workspace root when there are no workspace entries", async () => {
    const workspaceRoot = join(tmpRoot, "empty-workspace");
    mkdirSync(workspaceRoot, { recursive: true });

    const dirs = await provisionCursorWorkspace(
      makeConfig(workspaceRoot),
      emptySession(),
      {},
      "test-session-empty",
    );

    expect(dirs).toEqual([workspaceRoot]);
  }, GIT_TEST_TIMEOUT_MS);

  it("mounts a local-path workspace entry without cloning", async () => {
    const projectDir = join(tmpRoot, "existing-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "file.txt"), "local");
    const workspaceRoot = join(tmpRoot, "workspace-local");
    mkdirSync(workspaceRoot, { recursive: true });

    const dirs = await provisionCursorWorkspace(
      makeConfig(workspaceRoot),
      localPathSession(projectDir),
      {},
      "test-session-local",
    );

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(projectDir);
  }, GIT_TEST_TIMEOUT_MS);
});
