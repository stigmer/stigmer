/**
 * Pins the runner's own repository for a clone (runner-git.ts) against real
 * git: where it lives and that it is closed to others; that a clone filled
 * from it carries every branch and tag, tracks the default branch, leaves an
 * empty repository empty and a named commit without a ref; that neither the
 * clone nor the runner's repository stores a byte of the token, and a hook
 * the agent planted never sees it; that a push reaches
 * `refs/heads/<session branch>` alone, whatever the clone configures; that a
 * deleted repository, or one recorded for another URL, is rebuilt; that a
 * malformed object in the agent's bundle is refused before anything is
 * pushed; that two operations on one repository never overlap; the git
 * floor; and that an error never carries the token.
 *
 * A github.com URL resolves to a local bare repository through
 * `url.<base>.insteadOf` in a private global configuration, and `HOME` is
 * the test's own, so nothing reaches the network or the person's state.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { GitWriteBackMode } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { GitRepositoryResourceSchema, SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { TranscriptBuilder } from "../../../harness/transcript/builder.js";
import { TurnRowsSchema } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { GitTooOldError } from "../git-credential.js";
import { LocalWorkspaceBackend } from "../local-backend.js";
import { bundlePackOffset, copyFromAgent, runnerRepositoryPath, withRunnerRepository } from "../runner-git.js";
import { provisionGit } from "../sources/git.js";
import type { ProvisionResult } from "../types.js";
import { WriteBackCoordinator } from "../writeback-coordinator.js";

const TOKEN = "ghp_runnergit_0123456789abcdef";
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const REPO_URL = "https://github.com/acme/app.git";
const EMPTY_URL = "https://github.com/acme/empty.git";

// Real git spawns are slow under full-suite parallel load.
const GIT_TEST_TIMEOUT_MS = 120_000;

let root: string;
let origin: string;
let home: string;

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-c", "user.name=seed", "-c", "user.email=seed@example.com", ...args], { cwd, encoding: "utf-8", stdio: "pipe" });
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Fails naming the first file under `dir` that holds the token in any form. */
function expectNoTokenUnder(dir: string): void {
  for (const file of filesUnder(dir)) {
    const bytes = readFileSync(file).toString("latin1");
    expect(bytes.includes(TOKEN) || bytes.includes(BASIC), `${file} holds the token`).toBe(false);
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "runner-git-"));
  origin = join(root, "origin.git");
  const empty = join(root, "empty.git");
  const seed = join(root, "seed");
  execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "pipe" });
  execFileSync("git", ["init", "--bare", "-b", "main", empty], { stdio: "pipe" });
  execFileSync("git", ["clone", origin, seed], { stdio: "pipe" });
  writeFileSync(join(seed, "README.md"), "# seed\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-m", "seed"]);
  git(seed, ["tag", "-a", "v1", "-m", "first"]);
  git(seed, ["push", "origin", "main", "v1"]);
  git(seed, ["checkout", "-b", "side"]);
  writeFileSync(join(seed, "side.md"), "side\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-m", "side"]);
  git(seed, ["push", "origin", "side"]);
  git(seed, ["checkout", "-b", "pr", "main"]);
  writeFileSync(join(seed, "pr.md"), "from a pull request\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-m", "pr"]);
  git(seed, ["push", "origin", "pr:refs/pull/1/head"]);

  const globalConfig = join(root, "gitconfig");
  writeFileSync(
    globalConfig,
    `[url "file://${origin}"]\n\tinsteadOf = ${REPO_URL}\n[url "file://${empty}"]\n\tinsteadOf = ${EMPTY_URL}\n[protocol "file"]\n\tallow = always\n`,
  );
  vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  home = join(root, "home");
  mkdirSync(home);
  vi.stubEnv("HOME", home);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/** A cloud clone of `url` at root/ws, with the token. */
async function cloneWorkspace(options: { readonly url?: string; readonly branch?: string; readonly commit?: string } = {}): Promise<{ workspace: string; provisioned: ProvisionResult }> {
  const workspace = join(root, "ws");
  mkdirSync(workspace, { recursive: true });
  const provisioned = await provisionGit({
    url: options.url ?? REPO_URL,
    branch: options.branch ?? "main",
    commit: options.commit,
    backend: new LocalWorkspaceBackend(workspace),
    token: TOKEN,
    isLocalMode: false,
    writeBack: true,
  });
  return { workspace, provisioned };
}

/** One write-back of the clone at `workspace` to `stigmer/<sessionId>`; returns the record. */
async function writeBack(workspace: string, provisioned: ProvisionResult, sessionId: string) {
  const status = create(RunStatusSchema, {});
  const entry = create(SessionResourceSchema, {
    name: "app",
    resource: { case: "gitRepository", value: create(GitRepositoryResourceSchema, { url: REPO_URL, writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR }) },
  });
  await new WriteBackCoordinator({
    writeBacks: new TranscriptBuilder(`exec-${sessionId}`, create(TurnRowsSchema), status),
    executionId: `exec-${sessionId}`,
    sessionId,
    repositories: [{ name: "app", url: REPO_URL, token: TOKEN }],
    provisionResults: [{ ...provisioned, entryName: "app" }],
    resources: [entry],
    workspaceBackend: new LocalWorkspaceBackend(workspace),
  }).finalize();
  return status.workspaceWriteBacks[0]!;
}

/** The refs of the repository at `dir`, one "<sha> <name>" per line. */
function refsOf(dir: string): string {
  return git(dir, ["for-each-ref", "--format=%(objectname) %(refname)"]);
}

describe("the runner's repository", () => {
  it("lives under the runner's state directory, closed to others, one per clone path the runner computed", async () => {
    await withRunnerRepository("/clones/a", REPO_URL, TOKEN, (repository) => repository.fetch(["+refs/heads/*:refs/heads/*"]));
    const dir = runnerRepositoryPath("/clones/a");
    expect(dir.startsWith(join(home, ".stigmer", "git") + "/")).toBe(true);
    expect(statSync(join(home, ".stigmer", "git")).mode & 0o077, "no one but the runner's user enters it").toBe(0);
    expect(git(dir, ["rev-parse", "refs/heads/main"]).trim()).toBe(git(origin, ["rev-parse", "main"]).trim());
    expect(runnerRepositoryPath("/clones/b")).not.toBe(dir);
  }, GIT_TEST_TIMEOUT_MS);

  it("names GitHub's default branch, and none for an empty repository", async () => {
    expect(await withRunnerRepository("/clones/a", REPO_URL, TOKEN, (repository) => repository.defaultBranch())).toBe("main");
    expect(await withRunnerRepository("/clones/e", EMPTY_URL, TOKEN, (repository) => repository.defaultBranch())).toBe("");
  }, GIT_TEST_TIMEOUT_MS);

  it("fills a clone with every branch and tag, tracking the default branch, and neither stores a byte of the token", async () => {
    const { workspace, provisioned } = await cloneWorkspace({ branch: "" });

    expect(provisioned.gitMetadata?.branch).toBe("main");
    const refs = refsOf(workspace);
    for (const name of ["refs/remotes/origin/main", "refs/remotes/origin/side", "refs/tags/v1"]) expect(refs).toContain(name);
    expect(git(workspace, ["symbolic-ref", "refs/remotes/origin/HEAD"]).trim()).toBe("refs/remotes/origin/main");
    expect(git(workspace, ["config", "--get", "remote.origin.url"]).trim()).toBe(REPO_URL);
    expect(readdirSync(join(workspace, ".git")).filter((name) => name.startsWith("stigmer-")), "no handoff file is left").toEqual([]);
    expectNoTokenUnder(join(workspace, ".git"));
    expectNoTokenUnder(join(home, ".stigmer"));
  }, GIT_TEST_TIMEOUT_MS);

  it("leaves the clone of an empty repository empty", async () => {
    const { workspace, provisioned } = await cloneWorkspace({ url: EMPTY_URL, branch: "" });

    expect(provisioned.gitMetadata?.baseCommit).toBe("");
    expect(refsOf(workspace).trim()).toBe("");
  }, GIT_TEST_TIMEOUT_MS);

  it("hands over a named commit no branch holds, leaving no ref behind in the clone", async () => {
    const pr = git(origin, ["rev-parse", "refs/pull/1/head"]).trim();
    const { workspace } = await cloneWorkspace({ commit: pr });

    expect(git(workspace, ["rev-parse", "HEAD"]).trim()).toBe(pr);
    const naming = refsOf(workspace).split("\n").filter((line) => line.startsWith(pr)).map((line) => line.split(" ")[1]);
    expect(naming, "only the branch put at the commit names it").toEqual(["refs/heads/main"]);
  }, GIT_TEST_TIMEOUT_MS);

  it("pushes refs/heads/<session branch> alone, whatever push the clone configures and whatever branches it holds", async () => {
    const { workspace, provisioned } = await cloneWorkspace();
    const mainBefore = git(origin, ["rev-parse", "main"]).trim();
    git(workspace, ["config", "--add", "remote.origin.push", "refs/heads/*:refs/heads/*"]);
    git(workspace, ["config", "push.default", "matching"]);
    git(workspace, ["branch", "extra"]);
    writeFileSync(join(workspace, "change.txt"), "agent work\n");

    const record = await writeBack(workspace, provisioned, "ses_wide");

    expect(record.error).toBe("");
    const tip = git(origin, ["rev-parse", "stigmer/ses_wide"]).trim();
    expect(record.commitSha).toBe(tip);
    expect(git(origin, ["show", `${tip}:change.txt`])).toBe("agent work\n");
    expect(git(origin, ["branch", "--list", "extra"]).trim()).toBe("");
    expect(git(origin, ["rev-parse", "main"]).trim()).toBe(mainBefore);
    // The clone reads as `push -u` would have left it.
    expect(git(workspace, ["rev-parse", "refs/remotes/origin/stigmer/ses_wide"]).trim()).toBe(tip);
    expect(git(workspace, ["rev-parse", "--abbrev-ref", "@{upstream}"]).trim()).toBe("origin/stigmer/ses_wide");
  }, GIT_TEST_TIMEOUT_MS);

  it("never lets a hook the agent planted see the token", async () => {
    const { workspace, provisioned } = await cloneWorkspace();
    // The plant: hooks in .git/hooks and in a directory the clone's
    // core.hooksPath names, each writing git's whole environment out.
    const loot = join(root, "loot.txt");
    const ownHooks = join(root, "own-hooks");
    mkdirSync(ownHooks);
    for (const dir of [join(workspace, ".git", "hooks"), ownHooks]) {
      for (const name of ["pre-push", "reference-transaction", "post-checkout", "pre-commit", "post-commit"]) {
        writeFileSync(join(dir, name), `#!/bin/sh\nenv >> ${loot}\n`, { mode: 0o755 });
      }
    }
    git(workspace, ["config", "core.hooksPath", ownHooks]);
    writeFileSync(join(workspace, "change.txt"), "agent work\n");

    expect((await writeBack(workspace, provisioned, "ses_hook")).error).toBe("");

    const seen = (() => {
      try {
        return readFileSync(loot, "utf-8");
      } catch {
        return "";
      }
    })();
    expect(seen, "the clone's own hooks ran").not.toBe("");
    expect(seen.includes(TOKEN) || seen.includes(BASIC), "a planted hook saw the token").toBe(false);
    expectNoTokenUnder(join(workspace, ".git"));
  }, GIT_TEST_TIMEOUT_MS);

  it("is rebuilt from GitHub when deleted", async () => {
    const { workspace, provisioned } = await cloneWorkspace();
    rmSync(runnerRepositoryPath(workspace), { recursive: true, force: true });
    writeFileSync(join(workspace, "change.txt"), "agent work\n");

    expect((await writeBack(workspace, provisioned, "ses_rebuilt")).error).toBe("");
    expect(git(origin, ["show", "stigmer/ses_rebuilt:change.txt"])).toBe("agent work\n");
  }, GIT_TEST_TIMEOUT_MS);

  it("is rebuilt, not reused, when it was recorded for another URL", async () => {
    await withRunnerRepository("/clones/a", REPO_URL, TOKEN, (repository) => repository.fetch(["+refs/heads/*:refs/heads/*"]));
    const dir = runnerRepositoryPath("/clones/a");
    git(dir, ["config", "remote.origin.url", "https://github.com/evil/fork.git"]);

    const heads = await withRunnerRepository("/clones/a", REPO_URL, TOKEN, (repository) => repository.heads());

    expect(heads, "nothing of the old repository is kept").toEqual([]);
    expect(git(dir, ["config", "--get", "remote.origin.url"]).trim()).toBe(REPO_URL);
  }, GIT_TEST_TIMEOUT_MS);

  it("pushes a commit it already holds without a bundle", async () => {
    const main = git(origin, ["rev-parse", "main"]).trim();
    const pushed = await withRunnerRepository("/clones/a", REPO_URL, TOKEN, async (repository) => {
      await repository.fetch(["+refs/heads/main:refs/heads/main"]);
      return repository.pushCommit(main, "stigmer/ses_held");
    });
    expect(pushed).toBe(main);
    expect(git(origin, ["rev-parse", "stigmer/ses_held"]).trim()).toBe(main);
  }, GIT_TEST_TIMEOUT_MS);

  it("refuses a malformed object in the agent's bundle, pushing nothing", async () => {
    const { workspace } = await cloneWorkspace();
    // A tree with a duplicate entry: fsck's duplicateEntries.
    const blob = git(workspace, ["rev-parse", "HEAD:README.md"]).trim();
    const tree = execFileSync("git", ["mktree"], { cwd: workspace, input: `100644 blob ${blob}\tREADME.md\n100644 blob ${blob}\tREADME.md\n`, encoding: "utf-8" }).trim();
    const commit = git(workspace, ["commit-tree", tree, "-p", "HEAD", "-m", "malformed"]).trim();
    git(workspace, ["update-ref", "refs/heads/stigmer/ses_bad", commit]);
    const bundle = join(workspace, ".git", "stigmer-outgoing-test.bundle");
    git(workspace, ["bundle", "create", bundle, "refs/heads/stigmer/ses_bad", "^HEAD"]);

    await expect(
      withRunnerRepository(workspace, REPO_URL, TOKEN, (repository) => repository.pushBundle(bundle, "stigmer/ses_bad")),
    ).rejects.toThrow(/git index-pack failed: .*duplicate/is);
    expect(git(origin, ["branch", "--list", "stigmer/ses_bad"]).trim()).toBe("");
  }, GIT_TEST_TIMEOUT_MS);

  it("refuses a bundle that does not carry the session branch, pushing nothing", async () => {
    const { workspace } = await cloneWorkspace();
    const bundle = join(workspace, ".git", "stigmer-outgoing-test.bundle");
    git(workspace, ["bundle", "create", bundle, "refs/remotes/origin/side", "^HEAD"]);

    await expect(
      withRunnerRepository(workspace, REPO_URL, TOKEN, (repository) => repository.pushBundle(bundle, "stigmer/ses_other")),
    ).rejects.toThrow("does not carry refs/heads/stigmer/ses_other");
  }, GIT_TEST_TIMEOUT_MS);

  it("refuses to push a commit it does not hold", async () => {
    await expect(
      withRunnerRepository("/clones/a", REPO_URL, TOKEN, (repository) => repository.pushCommit("0".repeat(40), "stigmer/ses_none")),
    ).rejects.toThrow("is not in the runner's repository");
  }, GIT_TEST_TIMEOUT_MS);

  it("never runs two operations on one repository at once", async () => {
    const spans: Array<[number, number]> = [];
    const hold = (repository: { heads(): Promise<string[]> }) => async () => {
      const start = Date.now();
      await repository.heads();
      await new Promise((resolve) => setTimeout(resolve, 300));
      spans.push([start, Date.now()]);
    };
    await Promise.all([
      withRunnerRepository("/clones/a", REPO_URL, TOKEN, (repository) => hold(repository)()),
      withRunnerRepository("/clones/a", REPO_URL, TOKEN, (repository) => hold(repository)()),
    ]);
    spans.sort((a, b) => a[0] - b[0]);
    expect(spans[1]![0], "the second began after the first ended").toBeGreaterThanOrEqual(spans[0]![1]);
  }, GIT_TEST_TIMEOUT_MS);
});

describe("the runner's git", () => {
  /** A `git` on PATH that answers `--version` with `version` and runs `script` for everything else. */
  function fakeGit(version: string, script: string): void {
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version ${version}"; exit 0; fi\n${script}\n`, { mode: 0o755 });
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
  }

  it("refuses a git older than 2.31 before running anything, naming the floor", async () => {
    fakeGit("2.30.2", "exit 0");
    const use = vi.fn(async () => {});
    const err = await withRunnerRepository("/clones/old", REPO_URL, TOKEN, use).then(() => undefined, (e: unknown) => e);

    expect(err).toBeInstanceOf(GitTooOldError);
    expect((err as Error).message).toMatch(/this runner's git is 2\.30\.2; handing a repository's token to git without storing it needs git 2\.31 or newer/i);
    expect(use).not.toHaveBeenCalled();
  });

  it("is found on the runner's PATH, or nothing runs", async () => {
    mkdirSync(join(root, "nobin"));
    vi.stubEnv("PATH", join(root, "nobin"));
    await expect(withRunnerRepository("/clones/none", REPO_URL, TOKEN, async () => {})).rejects.toThrow("git is not on this runner's PATH");
  });

  it("says which step failed when it cannot make the repository", async () => {
    fakeGit("2.39.5", `case "$1" in init) echo "no space left" >&2; exit 1;; esac\nexit 0`);
    await expect(withRunnerRepository("/clones/full", REPO_URL, TOKEN, async () => {})).rejects.toThrow("git init failed: no space left");
  });

  it("is stopped when it prints more than the runner reads", async () => {
    fakeGit("2.39.5", `case "$1" in init) mkdir -p "$4";; for-each-ref) head -c 70000000 /dev/zero;; esac\nexit 0`);
    await expect(withRunnerRepository("/clones/loud", REPO_URL, TOKEN, (repository) => repository.heads())).rejects.toThrow("printed more than the runner reads");
  });

  it("never carries the token in an error, even when git prints its environment", async () => {
    // Every command succeeds but a fetch, which prints git's environment;
    // `init` makes the directory the rest run in.
    fakeGit("2.39.5", `case "$1" in fetch) env >&2; exit 1;; init) mkdir -p "$4";; esac\nexit 0`);
    const err = await withRunnerRepository("/clones/masked", REPO_URL, TOKEN, (repository) => repository.fetch(["+refs/heads/*:refs/heads/*"]))
      .then(() => undefined, (e: unknown) => e as Error);

    expect(err?.message).toContain("git fetch failed");
    expect(err?.message, "the header was in what git printed, masked").toContain("AUTHORIZATION: basic ***");
    expect(err?.message.includes(TOKEN) || err?.message.includes(BASIC)).toBe(false);
  });
});

describe("a bundle crossing", () => {
  it("is read past its header to its pack, and a file that is not a bundle is refused", async () => {
    const bundle = join(root, "main.bundle");
    git(join(root, "seed"), ["bundle", "create", bundle, "main"]);
    const offset = await bundlePackOffset(bundle);
    expect(readFileSync(bundle).subarray(offset, offset + 4).toString("latin1")).toBe("PACK");

    const other = join(root, "not.bundle");
    writeFileSync(other, "# v2 git bundle\nno pack here\n");
    await expect(bundlePackOffset(other)).rejects.toThrow("is not a git bundle");
  });

  it("is refused from the agent past the limit, before more is copied", async () => {
    const from = join(root, "large.bundle");
    writeFileSync(from, Buffer.alloc(100));
    await expect(copyFromAgent(from, join(root, "copy.bundle"), 10)).rejects.toThrow("larger than GitHub accepts in one push");
    await copyFromAgent(from, join(root, "whole.bundle"));
    expect(readFileSync(join(root, "whole.bundle")).length).toBe(100);
  });
});
