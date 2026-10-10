/**
 * Pins how a repository's token reaches git (git-credential.ts): the header
 * git's per-command configuration carries beside hooks and the fsmonitor
 * switched off, appended after the runner's own per-command configuration;
 * the version floor (read again after a failed read); the refusal of a
 * clone whose own configuration could carry the token elsewhere or whose
 * origin moved; the masking of a failed command's text; and — against real
 * git — that git reads the header from the environment, that a hook the
 * agent planted (in `.git/hooks` or through `core.hooksPath`) never runs
 * with the token, and that a clone, a reused clone (in local and cloud
 * modes) and a write-back leave no byte of the token anywhere under `.git`
 * or in the origin URL. The real arms point a github.com URL
 * at a local bare repository through `url.<base>.insteadOf` in a private
 * global config, so nothing reaches the network.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { GitWriteBackMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import { TranscriptBuilder } from "../../../harness/transcript/builder.js";
import {
  forgetGitVersion,
  gitTokenEnv,
  GitTooOldError,
  maskToken,
  UntrustedGitConfigError,
  meetsGitCredentialFloor,
  runNetworkGit,
} from "../git-credential.js";
import { LocalWorkspaceBackend } from "../local-backend.js";
import { provisionGit } from "../sources/git.js";
import { WriteBackCoordinator } from "../writeback-coordinator.js";

const TOKEN = "ghp_realtoken_0123456789";
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const REPO_URL = "https://github.com/acme/app.git";

// Real git spawns are slow under full-suite parallel load.
const GIT_TEST_TIMEOUT_MS = 120_000;

const AT = { cwd: "/w", remoteUrl: REPO_URL } as const;

/**
 * A backend whose git is 2.39.5, whose clone at /w holds `localConfig` (one
 * name per line, the clone's own unless a line names its scope as git
 * prints it, "worktree\thttp.proxy") and an origin of `origin`.
 */
function gitBackend(init: { localConfig?: string; origin?: string; run?: (cmd: string) => string } = {}) {
  const scoped = (init.localConfig ?? "remote.origin.url\ncore.bare\n")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => (line.includes("\t") ? line : `local\t${line}`))
    .join("\n");
  const execute = vi.fn(async (cmd: string) => {
    if (cmd === "git --version") return "git version 2.39.5 (Apple Git-146)\n";
    if (cmd === "git config --list --show-scope --name-only") return `global\tuser.name\nglobal\turl.git@github.com:.insteadof\n${scoped}\n`;
    if (cmd === "git config --local --get remote.origin.url") return `${init.origin ?? REPO_URL}\n`;
    return init.run?.(cmd) ?? "ok";
  });
  return { backend: mockWorkspaceBackend({ execute }), execute };
}

beforeEach(() => forgetGitVersion());

describe("the header and the floor", () => {
  it("carries the token as GitHub's basic header, scoped to https://github.com/, with hooks and the fsmonitor off", () => {
    expect(gitTokenEnv(TOKEN, {})).toEqual({
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/dev/null",
      GIT_CONFIG_KEY_1: "core.fsmonitor",
      GIT_CONFIG_VALUE_1: "false",
      GIT_CONFIG_KEY_2: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_2: `AUTHORIZATION: basic ${BASIC}`,
    });
  });

  it("appends after the per-command configuration the runner already carries, never over it", () => {
    const env = gitTokenEnv(TOKEN, { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" });
    expect(env.GIT_CONFIG_COUNT).toBe("5");
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_2).toBe("core.hooksPath");
    expect(env.GIT_CONFIG_KEY_4).toBe("http.https://github.com/.extraheader");
    expect(gitTokenEnv(TOKEN, { GIT_CONFIG_COUNT: "garbage" }).GIT_CONFIG_COUNT).toBe("3");
  });

  it("reads 2.31 and later as meeting the floor, and nothing older or unreadable", () => {
    expect(meetsGitCredentialFloor("2.31.0")).toBe(true);
    expect(meetsGitCredentialFloor("2.39.5")).toBe(true);
    expect(meetsGitCredentialFloor("3.0")).toBe(true);
    expect(meetsGitCredentialFloor("2.30.9")).toBe(false);
    expect(meetsGitCredentialFloor("1.99")).toBe(false);
    expect(meetsGitCredentialFloor("")).toBe(false);
  });

  it("masks the token and its basic form in a failed command's text", () => {
    expect(maskToken(`fatal: ${TOKEN} and ${BASIC}`, TOKEN)).toBe("fatal: *** and ***");
    expect(maskToken("untouched", "")).toBe("untouched");
  });

  it("reads the version once per process", async () => {
    const { backend, execute } = gitBackend();

    await runNetworkGit(backend, "git fetch", { ...AT, token: TOKEN });
    await runNetworkGit(backend, "git push", { ...AT, token: TOKEN });

    expect(execute.mock.calls.filter((call) => call[0] === "git --version")).toHaveLength(1);
  });

  it("refuses before running anything on an older or unreadable git, and runs a tokenless command as it is", async () => {
    const old = mockWorkspaceBackend({ execute: vi.fn(async () => "git version 2.30.2\n") });
    await expect(runNetworkGit(old, "git fetch", { ...AT, token: TOKEN })).rejects.toBeInstanceOf(GitTooOldError);

    forgetGitVersion();
    const broken = mockWorkspaceBackend({
      execute: vi.fn(async (cmd: string) => {
        if (cmd === "git --version") throw new Error("no git");
        return "";
      }),
    });
    await expect(runNetworkGit(broken, "git fetch", { ...AT, token: TOKEN })).rejects.toThrow(/git is unreadable/);

    const plain = mockWorkspaceBackend({ execute: vi.fn(async () => "ok") });
    await expect(runNetworkGit(plain, "git fetch", AT)).resolves.toBe("ok");
    expect(plain.execute).toHaveBeenCalledWith("git fetch", { cwd: "/w" });
  });

  it("asks for the version again after a read that failed, and keeps only a successful one", async () => {
    let attempts = 0;
    const { backend, execute } = gitBackend();
    execute.mockImplementation(async (cmd: string) => {
      if (cmd === "git --version") {
        attempts += 1;
        if (attempts === 1) throw new Error("spawn EAGAIN");
        return "git version 2.39.5\n";
      }
      if (cmd === "git config --list --show-scope --name-only") return "local\tremote.origin.url\n";
      if (cmd === "git config --local --get remote.origin.url") return `${REPO_URL}\n`;
      return "ok";
    });

    await expect(runNetworkGit(backend, "git fetch", { ...AT, token: TOKEN })).rejects.toBeInstanceOf(GitTooOldError);
    await expect(runNetworkGit(backend, "git fetch", { ...AT, token: TOKEN })).resolves.toBe("ok");
    await expect(runNetworkGit(backend, "git push", { ...AT, token: TOKEN })).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it.each([
    ["http.sslverify", "a TLS setting"],
    ["http.https://github.com/acme/app.git.proxy", "a URL-scoped proxy"],
    ["https.proxy", "an https setting"],
    ["url.https://evil.example/.insteadof", "a rewrite"],
    ["include.path", "an include"],
    ["includeif.gitdir:/w.path", "a conditional include"],
    ["credential.helper", "a credential helper"],
    ["core.sshcommand", "an ssh command"],
    ["core.gitproxy", "a proxy command"],
    ["remote.origin.pushurl", "a push URL"],
    ["remote.origin.proxy", "a remote's proxy"],
    ["remote.origin.receivepack", "a remote's receive-pack"],
    ["core.alternaterefscommand", "a program run during a fetch"],
    ["filter.lfs.process", "a filter program"],
    ["extensions.worktreeconfig", "a worktree configuration"],
    ["worktree\thttp.proxy", "a proxy in the worktree configuration"],
    ["worktree\thttp.sslverify", "a TLS setting in the worktree configuration"],
  ])("refuses a clone whose own configuration sets %s (%s), running nothing with the token", async (key) => {
    const { backend, execute } = gitBackend({ localConfig: `remote.origin.url\n${key}\n` });
    await expect(runNetworkGit(backend, "git push", { ...AT, token: TOKEN })).rejects.toBeInstanceOf(UntrustedGitConfigError);
    expect(execute).not.toHaveBeenCalledWith("git push", expect.anything());
  });

  it("refuses a clone whose origin holds more than one URL, the second one the agent's", async () => {
    const { backend, execute } = gitBackend({ localConfig: "remote.origin.url\nremote.origin.url\n" });
    await expect(runNetworkGit(backend, "git push", { ...AT, token: TOKEN })).rejects.toThrow(/more than one URL/);
    expect(execute).not.toHaveBeenCalledWith("git push", expect.anything());
  });

  it("refuses a clone whose origin no longer is the conversation's repository", async () => {
    const { backend, execute } = gitBackend({ origin: "https://github.com/evil/fork.git" });
    await expect(runNetworkGit(backend, "git push", { ...AT, token: TOKEN })).rejects.toThrow(/points origin somewhere other/);
    expect(execute).not.toHaveBeenCalledWith("git push", expect.anything());
  });

  it("hands the token past a clone's ordinary settings and the operator's own, a hook path of the clone's own included", async () => {
    const { backend, execute } = gitBackend({ localConfig: "core.bare\ncore.hookspath\nremote.origin.url\nremote.origin.fetch\nbranch.main.remote\nuser.name\n" });
    await expect(runNetworkGit(backend, "git push", { ...AT, token: TOKEN })).resolves.toBe("ok");
    expect(execute).toHaveBeenCalledWith("git push", { cwd: "/w", env: expect.objectContaining({ GIT_CONFIG_VALUE_0: "/dev/null" }) });
  });

  it("masks the token in the error a failing command throws", async () => {
    const { backend } = gitBackend({
      run: () => {
        throw new Error(`Command failed: header ${BASIC}`);
      },
    });
    await expect(runNetworkGit(backend, "git push", { ...AT, token: TOKEN })).rejects.toThrow("Command failed: header ***");
  });
});

describe("against real git", () => {
  let root: string;
  let origin: string;

  /** Every file under `dir`, recursively. */
  function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
  }

  /** Fails naming the first file under `.git` that holds the token in any form. */
  function expectNoTokenIn(clone: string): void {
    for (const file of filesUnder(join(clone, ".git"))) {
      const bytes = readFileSync(file).toString("latin1");
      expect(bytes.includes(TOKEN) || bytes.includes(BASIC), `${file} holds the token`).toBe(false);
    }
    // The stored URL, not `remote get-url`, which applies the insteadOf rewrite.
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: clone, encoding: "utf-8" }).trim();
    expect(remote).toBe(REPO_URL);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "git-cred-"));
    origin = join(root, "origin.git");
    const seed = join(root, "seed");
    execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "pipe" });
    execFileSync("git", ["clone", origin, seed], { stdio: "pipe" });
    writeFileSync(join(seed, "README.md"), "# seed\n");
    const identity = ["-c", "user.name=seed", "-c", "user.email=seed@example.com"];
    execFileSync("git", [...identity, "add", "-A"], { cwd: seed, stdio: "pipe" });
    execFileSync("git", [...identity, "commit", "-m", "seed"], { cwd: seed, stdio: "pipe" });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: seed, stdio: "pipe" });
    // The github.com URL resolves to the local origin; nothing leaves the host.
    const globalConfig = join(root, "gitconfig");
    writeFileSync(globalConfig, `[url "file://${origin}"]\n\tinsteadOf = ${REPO_URL}\n[protocol "file"]\n\tallow = always\n`);
    vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  /** A repository at root/repo whose origin is the conversation's URL. */
  function repoWithOrigin(): string {
    const repo = join(root, "repo");
    execFileSync("git", ["init", "-q", repo], { stdio: "pipe" });
    execFileSync("git", ["remote", "add", "origin", REPO_URL], { cwd: repo, stdio: "pipe" });
    return repo;
  }

  it("hands git the header through the environment alone", async () => {
    const repo = repoWithOrigin();
    const backend = new LocalWorkspaceBackend(root);
    const header = await runNetworkGit(backend, "git config --get http.https://github.com/.extraheader", { cwd: repo, remoteUrl: REPO_URL, token: TOKEN });
    expect(header.trim()).toBe(`AUTHORIZATION: basic ${BASIC}`);
    // Without the command's environment git holds no such setting (exit 1).
    expect(() => execFileSync("git", ["config", "--get-all", "http.https://github.com/.extraheader"], { cwd: repo, stdio: "pipe" })).toThrow();
  }, GIT_TEST_TIMEOUT_MS);

  it("refuses a real clone whose own configuration turns TLS checks off", async () => {
    const repo = repoWithOrigin();
    execFileSync("git", ["config", "http.https://github.com/acme/app.git.sslVerify", "false"], { cwd: repo, stdio: "pipe" });
    const backend = new LocalWorkspaceBackend(root);
    await expect(
      runNetworkGit(backend, "git ls-remote origin", { cwd: repo, remoteUrl: REPO_URL, token: TOKEN }),
    ).rejects.toBeInstanceOf(UntrustedGitConfigError);
  }, GIT_TEST_TIMEOUT_MS);

  it("never runs an alternate-refs program the clone names while the token is in git's environment", async () => {
    const repo = repoWithOrigin();
    // The plant: an alternate object store and the program git runs to list
    // its refs during a fetch, writing git's whole environment out.
    const loot = join(root, "alt-loot.txt");
    const program = join(root, "alt-refs.sh");
    writeFileSync(program, `#!/bin/sh\nenv >> ${loot}\n`, { mode: 0o755 });
    execFileSync("mkdir", ["-p", join(repo, ".git", "objects", "info")]);
    writeFileSync(join(repo, ".git", "objects", "info", "alternates"), `${join(origin, "objects")}\n`);
    execFileSync("git", ["config", "core.alternateRefsCommand", program], { cwd: repo, stdio: "pipe" });

    await expect(
      runNetworkGit(new LocalWorkspaceBackend(root), "git fetch --quiet origin", { cwd: repo, remoteUrl: REPO_URL, token: TOKEN }),
    ).rejects.toThrow(/sets core\.alternaterefscommand/);
    const seen = (() => {
      try {
        return readFileSync(loot, "utf-8");
      } catch {
        return "";
      }
    })();
    expect(seen.includes(TOKEN) || seen.includes(BASIC), "the clone's program saw the token").toBe(false);
  }, GIT_TEST_TIMEOUT_MS);

  it("reads the worktree configuration too, and refuses a proxy set there", async () => {
    const repo = repoWithOrigin();
    execFileSync("git", ["config", "extensions.worktreeConfig", "true"], { cwd: repo, stdio: "pipe" });
    execFileSync("git", ["config", "--worktree", "http.proxy", "http://127.0.0.1:9"], { cwd: repo, stdio: "pipe" });
    // Only the worktree's own setting would remain if extensions were allowed.
    await expect(
      runNetworkGit(new LocalWorkspaceBackend(root), "git ls-remote origin", { cwd: repo, remoteUrl: REPO_URL, token: TOKEN }),
    ).rejects.toBeInstanceOf(UntrustedGitConfigError);
  }, GIT_TEST_TIMEOUT_MS);

  it("refuses a real clone whose origin gained a second URL", async () => {
    const repo = repoWithOrigin();
    execFileSync("git", ["config", "--add", "remote.origin.url", "https://github.com/evil/fork.git"], { cwd: repo, stdio: "pipe" });
    await expect(
      runNetworkGit(new LocalWorkspaceBackend(root), "git ls-remote origin", { cwd: repo, remoteUrl: REPO_URL, token: TOKEN }),
    ).rejects.toThrow(/more than one URL/);
  }, GIT_TEST_TIMEOUT_MS);

  it("never runs a hook the agent planted while the token is in git's environment", async () => {
    const workspace = join(root, "ws");
    const backend = new LocalWorkspaceBackend(workspace);
    execFileSync("mkdir", ["-p", workspace]);
    const provisioned = await provisionGit({ url: REPO_URL, branch: "main", backend, token: TOKEN, isLocalMode: false, writeBack: true });
    // The agent's plant: hooks in .git/hooks, and a hook directory of its
    // own named by the clone's core.hooksPath, each writing git's whole
    // environment where the agent reads it next turn.
    const loot = join(root, "loot.txt");
    const hook = `#!/bin/sh
env >> ${loot}
`;
    const ownHooks = join(root, "own-hooks");
    execFileSync("mkdir", ["-p", ownHooks]);
    for (const dir of [join(workspace, ".git", "hooks"), ownHooks]) {
      for (const name of ["pre-push", "reference-transaction", "post-checkout", "pre-commit", "post-commit"]) {
        writeFileSync(join(dir, name), hook, { mode: 0o755 });
      }
    }
    execFileSync("git", ["config", "core.hooksPath", ownHooks], { cwd: workspace, stdio: "pipe" });
    writeFileSync(join(workspace, "change.txt"), "agent work\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const entry = {
      name: "app",
      source: { source: { case: "gitRepo", value: { url: REPO_URL, writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR } } },
    } as unknown as WorkspaceEntry;

    await new WriteBackCoordinator({
      writeBacks: new TranscriptBuilder("exec-hook", create(RunStatusSchema, {})),
      executionId: "exec-hook",
      sessionId: "ses-hook",
      repositories: [{ name: "app", url: REPO_URL, token: TOKEN }],
      provisionResults: [{ ...provisioned, entryName: "app" }],
      workspaceEntries: [entry],
      workspaceBackend: backend,
    }).finalize();

    expect(execFileSync("git", ["branch", "--list", "stigmer/ses-hook"], { cwd: origin, encoding: "utf-8" })).toContain("stigmer/ses-hook");
    // Hooks of tokenless commands (the commit) may run; none ever saw the token.
    const seen = (() => {
      try {
        return readFileSync(loot, "utf-8");
      } catch {
        return "";
      }
    })();
    expect(seen.includes(TOKEN) || seen.includes(BASIC), "a planted hook saw the token").toBe(false);
  }, GIT_TEST_TIMEOUT_MS);

  it.each([
    ["local", false],
    ["cloud", true],
  ])("a %s clone, and its reuse, hold no byte of the token", async (_mode, cloud) => {
    const workspace = join(root, "ws");
    const backend = new LocalWorkspaceBackend(workspace);
    execFileSync("mkdir", ["-p", workspace]);

    const cloned = await provisionGit({ url: REPO_URL, branch: "main", backend, token: TOKEN, isLocalMode: !cloud, writeBack: cloud });
    expect(cloned.gitMetadata?.branch).toBe("main");
    expectNoTokenIn(workspace);

    const reused = await provisionGit({ url: REPO_URL, branch: "main", backend, token: TOKEN, isLocalMode: !cloud, writeBack: cloud });
    expect(reused.gitMetadata?.writeBackReady).toBe(cloud);
    expectNoTokenIn(workspace);
  }, GIT_TEST_TIMEOUT_MS);

  it("scrubs a clone an earlier runner left holding the token", async () => {
    const workspace = join(root, "ws");
    execFileSync("git", ["clone", origin, workspace], { stdio: "pipe" });
    // What the earlier runner wrote: the token in the origin URL (local
    // mode), or a repo-local credential store and its helper (cloud mode).
    execFileSync("git", ["remote", "set-url", "origin", `https://x-access-token:${TOKEN}@github.com/acme/app.git`], { cwd: workspace });
    const store = join(workspace, ".git", ".git-credentials");
    writeFileSync(store, `https://x-access-token:${TOKEN}@github.com\n`);
    execFileSync("git", ["config", "credential.helper", `store --file=${store}`], { cwd: workspace });

    await provisionGit({ url: REPO_URL, branch: "main", backend: new LocalWorkspaceBackend(workspace), token: TOKEN, isLocalMode: false, writeBack: true });

    expectNoTokenIn(workspace);
    expect(() => execFileSync("git", ["config", "--local", "--get-all", "credential.helper"], { cwd: workspace, stdio: "pipe" })).toThrow();
  }, GIT_TEST_TIMEOUT_MS);

  it("a write-back pushes the session branch and leaves no byte of the token", async () => {
    const workspace = join(root, "ws");
    const backend = new LocalWorkspaceBackend(workspace);
    execFileSync("mkdir", ["-p", workspace]);
    const provisioned = await provisionGit({ url: REPO_URL, branch: "main", backend, token: TOKEN, isLocalMode: false, writeBack: true });
    writeFileSync(join(workspace, "change.txt"), "agent work\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const entry = {
      name: "app",
      source: { source: { case: "gitRepo", value: { url: REPO_URL, writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR } } },
    } as unknown as WorkspaceEntry;

    await new WriteBackCoordinator({
      writeBacks: new TranscriptBuilder("exec-cred", create(RunStatusSchema, {})),
      executionId: "exec-cred",
      sessionId: "ses-cred",
      repositories: [{ name: "app", url: REPO_URL, token: TOKEN }],
      provisionResults: [{ ...provisioned, entryName: "app" }],
      workspaceEntries: [entry],
      workspaceBackend: backend,
    }).finalize();

    expect(execFileSync("git", ["branch", "--list", "stigmer/ses-cred"], { cwd: origin, encoding: "utf-8" })).toContain("stigmer/ses-cred");
    expectNoTokenIn(workspace);
  }, GIT_TEST_TIMEOUT_MS);
});
