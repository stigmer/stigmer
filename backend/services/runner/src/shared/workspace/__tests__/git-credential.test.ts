/**
 * Pins how a repository's token reaches git (git-credential.ts): the header
 * git's per-command configuration carries, the version floor, the masking of
 * a failed command's text, and — against real git — that git reads the
 * header from the environment, and that a clone, a reused clone (in local
 * and cloud modes) and a write-back leave no byte of the token anywhere
 * under `.git` or in the origin URL. The real arms point a github.com URL
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

beforeEach(() => forgetGitVersion());

describe("the header and the floor", () => {
  it("carries the token as GitHub's basic header, scoped to https://github.com/", () => {
    expect(gitTokenEnv(TOKEN)).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${BASIC}`,
    });
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
    const execute = vi.fn(async (cmd: string) => (cmd === "git --version" ? "git version 2.39.5 (Apple Git-146)\n" : ""));
    const backend = mockWorkspaceBackend({ execute });

    await runNetworkGit(backend, "git fetch", { token: TOKEN });
    await runNetworkGit(backend, "git push", { token: TOKEN });

    expect(execute.mock.calls.filter((call) => call[0] === "git --version")).toHaveLength(1);
  });

  it("refuses before running anything on an older or unreadable git, and runs a tokenless command as it is", async () => {
    const old = mockWorkspaceBackend({ execute: vi.fn(async () => "git version 2.30.2\n") });
    await expect(runNetworkGit(old, "git fetch", { token: TOKEN })).rejects.toBeInstanceOf(GitTooOldError);

    forgetGitVersion();
    const broken = mockWorkspaceBackend({
      execute: vi.fn(async (cmd: string) => {
        if (cmd === "git --version") throw new Error("no git");
        return "";
      }),
    });
    await expect(runNetworkGit(broken, "git fetch", { token: TOKEN })).rejects.toThrow(/git is unreadable/);

    const plain = mockWorkspaceBackend({ execute: vi.fn(async () => "ok") });
    await expect(runNetworkGit(plain, "git fetch", { cwd: "/w" })).resolves.toBe("ok");
    expect(plain.execute).toHaveBeenCalledWith("git fetch", { cwd: "/w" });
  });

  it("masks the token in the error a failing command throws", async () => {
    const backend = mockWorkspaceBackend({
      execute: vi.fn(async (cmd: string) => {
        if (cmd === "git --version") return "git version 2.39.5\n";
        throw new Error(`Command failed: header ${BASIC}`);
      }),
    });
    await expect(runNetworkGit(backend, "git push", { token: TOKEN })).rejects.toThrow("Command failed: header ***");
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
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("hands git the header through the environment alone", async () => {
    const backend = new LocalWorkspaceBackend(root);
    const header = await runNetworkGit(backend, "git config --get http.https://github.com/.extraheader", { token: TOKEN });
    expect(header.trim()).toBe(`AUTHORIZATION: basic ${BASIC}`);
    // Without the command's environment git holds no such setting (exit 1).
    expect(() => execFileSync("git", ["config", "--get-all", "http.https://github.com/.extraheader"], { cwd: root, stdio: "pipe" })).toThrow();
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
    globalThis.fetch = vi.fn(async () => new Response("[]", { status: 200 })) as typeof fetch;
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
