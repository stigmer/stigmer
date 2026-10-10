import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { type RunStatus, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { WorkspaceWriteBackPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/writeback_pb";
import { GitWriteBackMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { TranscriptBuilder } from "../../../harness/transcript/builder.js";
import {
  WriteBackCoordinator,
  parseGithubRepo,
} from "../writeback-coordinator.js";
import type { WorkspaceBackend, ProvisionResult } from "../types.js";
import {
  AGENT_GIT_AUTHOR_NAME,
  AGENT_GIT_AUTHOR_EMAIL,
} from "../git-identity.js";
import { forgetGitVersion } from "../git-credential.js";

const SESSION_ID = "ses-01test";
const SESSION_BRANCH = `stigmer/${SESSION_ID}`;

// The writer production wires in: the turn's transcript builder, whose
// `addWriteBack` owns the upsert-by-entry rule these arms read the result of
// (the coordinator itself only registers records through `WriteBackSink`).
/** A builder and the status it builds into: the test writes through `sb` and reads `status`, as production reads `TurnSink.status`. */
function makeStatusBuilder(): { sb: TranscriptBuilder; status: RunStatus } {
  const status = create(RunStatusSchema, {});
  return { sb: new TranscriptBuilder("exec-test", status), status };
}

function makeProvisionResult(overrides: Partial<ProvisionResult> = {}): ProvisionResult {
  return {
    rootDir: "/workspace/my-app",
    sourceType: "git_repo",
    workspaceDescription: "test",
    entryName: "my-app",
    gitMetadata: {
      // Token-stripped, as extractGitMetadata always records it.
      repoUrl: "https://github.com/acme/my-app.git",
      branch: "main",
      baseCommit: "abc123",
      writeBackReady: true,
    },
    ...overrides,
  };
}

function makeWorkspaceEntry(name: string, writeBackMode: GitWriteBackMode = GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR) {
  return {
    name,
    source: {
      source: {
        case: "gitRepo" as const,
        value: { writeBackMode, url: `https://github.com/acme/${name}.git` },
      },
    },
    $typeName: "ai.stigmer.agentic.session.v1.WorkspaceEntry" as const,
  } as any;
}

function mockWorkspaceBackend(responses: Record<string, string> = {}): WorkspaceBackend {
  const defaultResponses: Record<string, string> = {
    // The clone a token is handed to: an ordinary configuration, and the
    // conversation's repository as its origin.
    "git config --list --show-scope --name-only": "local\tremote.origin.url\nlocal\tremote.origin.fetch\n",
    "git config --local --get remote.origin.url": "https://github.com/acme/my-app.git\n",
    "git diff --stat": " 1 file changed, 1 insertion(+)",
    "git diff --cached --stat": "",
    "git ls-files --others --exclude-standard": "",
    // Fresh clone on the base branch: the session branch exists nowhere yet.
    "git branch --show-current": "main",
    "git rev-parse --verify --quiet": "",
    "git ls-remote --heads origin": "",
    "git checkout": "",
    "git add -A": "",
    "commit -m": "",
    "git rev-parse HEAD": "abc123def456",
    "git push": "",
    "git diff --stat main...HEAD": " 1 file changed",
    "git --version": "git version 2.39.5",
    ...responses,
  };

  return {
    rootDir: "/workspace",
    execute: vi.fn(async (cmd: string) => {
      for (const [pattern, response] of Object.entries(defaultResponses)) {
        if (cmd.includes(pattern)) return response;
      }
      return "";
    }),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    writeFileBuffer: vi.fn(),
    exists: vi.fn(),
  };
}

function makeCoordinator(opts: {
  sb: TranscriptBuilder;
  backend?: WorkspaceBackend;
  executionId?: string;
  sessionId?: string;
  githubToken?: string;
  provisionResults?: ProvisionResult[];
  workspaceEntries?: any[];
}): WriteBackCoordinator {
  return new WriteBackCoordinator({
    writeBacks: opts.sb,
    executionId: opts.executionId ?? "exec-12345678rest",
    sessionId: opts.sessionId ?? SESSION_ID,
    repositories: (opts.workspaceEntries ?? [makeWorkspaceEntry("my-app")]).map((entry) => ({
      name: entry.name,
      url: entry.source.source.value.url,
      token: opts.githubToken ?? "ghp_plumbed_token",
    })),
    provisionResults: opts.provisionResults ?? [makeProvisionResult()],
    workspaceEntries: opts.workspaceEntries ?? [makeWorkspaceEntry("my-app")],
    workspaceBackend: opts.backend ?? mockWorkspaceBackend(),
  });
}

/**
 * URL-aware GitHub API mock: listing open PRs for the head branch returns
 * `openPrs`; creating a PR returns `created`. Records calls for assertions.
 */
function mockGithubApi(opts: {
  openPrs?: Array<{ html_url: string; number: number }>;
  created?: { html_url: string; number: number };
  createStatus?: number;
} = {}) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  globalThis.fetch = vi.fn(async (url: any, init?: any) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, headers: init?.headers ?? {} });
    if (method === "GET") {
      return new Response(JSON.stringify(opts.openPrs ?? []), { status: 200 });
    }
    const status = opts.createStatus ?? 201;
    const body = status < 300
      ? JSON.stringify(opts.created ?? { html_url: "https://github.com/acme/my-app/pull/42", number: 42 })
      : JSON.stringify({ message: "Forbidden" });
    return new Response(body, { status });
  }) as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;

describe("WriteBackCoordinator", () => {
  let sb: TranscriptBuilder;
  let status: RunStatus;

  beforeEach(() => {
    ({ sb, status } = makeStatusBuilder());
    mockGithubApi();
    forgetGitVersion();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Eligibility ─────────────────────────────────────────────────────

  it("filters out non-git workspace entries", () => {
    const coord = makeCoordinator({
      sb,
      provisionResults: [makeProvisionResult({ sourceType: "local_path" })],
    });
    expect(coord.hasEligibleEntries).toBe(false);
  });

  it("filters out entries without git credentials", () => {
    const coord = makeCoordinator({
      sb,
      provisionResults: [makeProvisionResult({
        gitMetadata: {
          repoUrl: "https://github.com/acme/my-app.git",
          branch: "main",
          baseCommit: "abc",
          writeBackReady: false,
        },
      })],
    });
    expect(coord.hasEligibleEntries).toBe(false);
  });

  it("accepts entries with UNSPECIFIED write-back mode (platform decides)", () => {
    const coord = makeCoordinator({
      sb,
      workspaceEntries: [makeWorkspaceEntry("my-app", GitWriteBackMode.GIT_WRITE_BACK_MODE_UNSPECIFIED)],
    });
    expect(coord.hasEligibleEntries).toBe(true);
  });

  // ── Full cycle ──────────────────────────────────────────────────────

  // Every cycle below runs through `finalize()`, the coordinator's one entry
  // point since #1096 (the per-file `onFileModified` went with the
  // native stream loop that called it). The mechanics it pins are the same.
  it("performs full cycle on the SESSION branch: branch -> commit -> push -> PR", async () => {
    const backend = mockWorkspaceBackend();
    const coord = makeCoordinator({ sb, backend });

    await coord.finalize();

    const wbs = status.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].branchName).toBe(SESSION_BRANCH);
    expect(wbs[0].baseBranch).toBe("main");
    expect(wbs[0].commitSha).toBe("abc123def456");
    expect(wbs[0].pullRequestUrl).toBe("https://github.com/acme/my-app/pull/42");
    expect(wbs[0].pullRequestNumber).toBe(42);
    expect(wbs[0].phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED);
    expect(wbs[0].error).toBe("");

    const commands = (backend.execute as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any) => c[0] as string);
    expect(commands.some((c: string) => c.includes(`git checkout -b ${SESSION_BRANCH}`))).toBe(true);
    expect(commands.some((c: string) => c.includes("git add -A"))).toBe(true);
    expect(commands.some((c: string) => c.includes("commit -m"))).toBe(true);
    expect(commands.some((c: string) => c.includes(`git push -u origin ${SESSION_BRANCH}`))).toBe(true);
  });

  it("commits with the agent identity pinned via -c flags and the execution id in the message", async () => {
    const backend = mockWorkspaceBackend();
    const coord = makeCoordinator({ sb, backend, executionId: "exec-12345678rest" });

    await coord.finalize();

    const commands = (backend.execute as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any) => c[0] as string);
    const commitCommand = commands.find((c: string) => c.includes("git") && c.includes("commit -m"));
    expect(commitCommand,
      "commit must not depend on ambient git identity — the cloud sandbox has none",
    ).toBeDefined();
    expect(commitCommand).toContain(`-c user.name='${AGENT_GIT_AUTHOR_NAME}'`);
    expect(commitCommand).toContain(`-c user.email='${AGENT_GIT_AUTHOR_EMAIL}'`);
    expect(commitCommand).toContain('commit -m "agent changes (exec-12345678rest)"');
  });

  it("skips when there are no changes", async () => {
    const backend = mockWorkspaceBackend({
      "git diff --stat": "",
      "git ls-files --others --exclude-standard": "",
    });
    const coord = makeCoordinator({ sb, backend });

    await coord.finalize();

    expect(status.workspaceWriteBacks).toHaveLength(0);
  });

  // ── The repository's token ─────────────────────────────────────────

  it("hands the entry's own token to ls-remote, fetch and push alone, through their environment", async () => {
    // The session branch lives only on the remote: ls-remote finds it, fetch
    // brings it, push appends — the three network commands of a cycle.
    const backend = mockWorkspaceBackend({ "git ls-remote --heads origin": "abc refs/heads/x" });
    const coord = makeCoordinator({ sb, backend, githubToken: "ghp_entry_token" });

    await coord.finalize();

    const runs = (backend.execute as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any) => ({ cmd: c[0] as string, env: (c[1] as { env?: Record<string, string> } | undefined)?.env }));
    const withEnv = runs.filter((run) => run.env !== undefined).map((run) => run.cmd.replace(/^cd \S+ && /, ""));
    expect(withEnv).toEqual([
      `git ls-remote --heads origin ${SESSION_BRANCH}`,
      `git fetch origin ${SESSION_BRANCH}`,
      `git push -u origin ${SESSION_BRANCH}`,
    ]);
    const basic = Buffer.from("x-access-token:ghp_entry_token").toString("base64");
    for (const run of runs.filter((r) => r.env !== undefined)) {
      expect(run.env?.GIT_CONFIG_VALUE_0).toBe("/dev/null");
      expect(run.env?.GIT_CONFIG_VALUE_2).toBe(`AUTHORIZATION: basic ${basic}`);
    }
    for (const run of runs) expect(run.cmd).not.toContain("ghp_entry_token");
  });

  it("takes each entry's token by its name and URL, never another entry's", async () => {
    const backend = mockWorkspaceBackend();
    const coord = new WriteBackCoordinator({
      writeBacks: sb,
      executionId: "exec-12345678rest",
      sessionId: SESSION_ID,
      repositories: [{ name: "my-app", url: "https://github.com/acme/other.git", token: "ghp_other" }],
      provisionResults: [makeProvisionResult()],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: backend,
    });

    await coord.finalize();

    const envs = (backend.execute as ReturnType<typeof vi.fn>).mock.calls.map((c: any) => c[1]?.env);
    expect(envs.every((env: unknown) => env === undefined), "a token for another URL is not this entry's").toBe(true);
    expect(status.workspaceWriteBacks[0]?.error).toContain("No GitHub token available");
  });

  // ── Session-branch idempotency ──────────────────────────────────────

  it("a second finalize commits to the existing branch without re-creating it", async () => {
    const backend = mockWorkspaceBackend();
    const coord = makeCoordinator({ sb, backend });

    await coord.finalize();
    await coord.finalize();

    const commands = (backend.execute as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any) => c[0] as string);
    const checkoutCalls = commands.filter((c: string) => c.includes("git checkout -b"));
    expect(checkoutCalls).toHaveLength(1);

    const pushCalls = commands.filter((c: string) => c.includes("git push"));
    expect(pushCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("a later execution reuses the session branch HEAD already sits on (no checkout)", async () => {
    // Turn 2 of the same session: the previous cycle left HEAD on the branch.
    const backend = mockWorkspaceBackend({
      "git branch --show-current": SESSION_BRANCH,
    });
    const coord = makeCoordinator({ sb, backend, executionId: "exec-turn2" });

    await coord.finalize();

    const commands = (backend.execute as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any) => c[0] as string);
    expect(commands.some((c: string) => c.includes("git checkout"))).toBe(false);
    expect(commands.some((c: string) => c.includes(`git push -u origin ${SESSION_BRANCH}`))).toBe(true);
  });

  it("checks out the existing local session branch instead of creating it", async () => {
    const backend = mockWorkspaceBackend({
      "git branch --show-current": "main",
      "git rev-parse --verify --quiet": "deadbeef",
    });
    const coord = makeCoordinator({ sb, backend });

    await coord.finalize();

    const commands = (backend.execute as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any) => c[0] as string);
    expect(commands.some((c: string) =>
      c.includes(`git checkout ${SESSION_BRANCH}`) && !c.includes("-b"),
    )).toBe(true);
    expect(commands.some((c: string) => c.includes("git checkout -b"))).toBe(false);
  });

  it("after a re-provision, fetches and tracks the remote session branch", async () => {
    const backend = mockWorkspaceBackend({
      "git branch --show-current": "main",
      "git rev-parse --verify --quiet": "",
      "git ls-remote --heads origin": `deadbeef\trefs/heads/${SESSION_BRANCH}`,
    });
    const coord = makeCoordinator({ sb, backend });

    await coord.finalize();

    const commands = (backend.execute as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any) => c[0] as string);
    expect(commands.some((c: string) => c.includes(`git fetch origin ${SESSION_BRANCH}`))).toBe(true);
    expect(commands.some((c: string) =>
      c.includes(`git checkout -b ${SESSION_BRANCH} origin/${SESSION_BRANCH}`),
    )).toBe(true);
  });

  it("adopts an already-open PR for the session branch instead of creating a duplicate", async () => {
    const calls = mockGithubApi({
      openPrs: [{ html_url: "https://github.com/acme/my-app/pull/7", number: 7 }],
    });
    const coord = makeCoordinator({ sb });

    await coord.finalize();

    const wbs = status.workspaceWriteBacks;
    expect(wbs[0].pullRequestNumber).toBe(7);
    expect(wbs[0].pullRequestUrl).toBe("https://github.com/acme/my-app/pull/7");
    expect(wbs[0].phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    const listCall = calls.find((c) => c.method === "GET");
    expect(listCall?.url).toContain("state=open");
    expect(listCall?.url).toContain(encodeURIComponent(`acme:${SESSION_BRANCH}`));
  });

  it("uses the plumbed token for the GitHub API (never the repo URL or process.env)", async () => {
    const calls = mockGithubApi();
    const coord = makeCoordinator({ sb, githubToken: "ghp_plumbed_token" });

    await coord.finalize();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers["Authorization"]).toBe("Bearer ghp_plumbed_token");
    }
  });

  // ── Failure semantics ───────────────────────────────────────────────

  it("sets FAILED phase on a commit/push error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const backend = mockWorkspaceBackend();
    (backend.execute as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd.includes("git diff --stat") && !cmd.includes("...HEAD")) return " changed";
      if (cmd.includes("git diff --cached")) return "";
      if (cmd.includes("git branch --show-current")) return "main";
      if (cmd === "git --version") return "git version 2.39.5";
      if (cmd === "git config --list --show-scope --name-only") return "local\tremote.origin.url\n";
      if (cmd === "git config --local --get remote.origin.url") return "https://github.com/acme/my-app.git";
      if (cmd.includes("commit -m")) throw new Error("commit failed: lock");
      return "";
    });
    const coord = makeCoordinator({ sb, backend });

    await coord.finalize();

    const wbs = status.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED);
    expect(wbs[0].error).toContain("commit failed");
    warnSpy.mockRestore();
  });

  it("reports PUSHED with the PR error when PR creation fails after a successful push", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGithubApi({ createStatus: 403 });
    const coord = makeCoordinator({ sb });

    await coord.finalize();

    const wbs = status.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].phase,
      "a pushed branch must never be reported FAILED for a PR-step error",
    ).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED);
    expect(wbs[0].branchName).toBe(SESSION_BRANCH);
    expect(wbs[0].commitSha).toBe("abc123def456");
    expect(wbs[0].error).toContain("GitHub API error");
    warnSpy.mockRestore();
  });

  it("reports PUSHED with an actionable error when no GitHub token is available", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const coord = makeCoordinator({ sb, githubToken: "" });

    await coord.finalize();

    const wbs = status.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED);
    expect(wbs[0].error).toContain("No GitHub token");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ── finalize on a fresh coordinator ─────────────────────────────────

  it("finalize commits, pushes and opens the PR for the entry's uncommitted changes", async () => {
    const coord = makeCoordinator({ sb });

    await coord.finalize();

    expect(status.workspaceWriteBacks).toHaveLength(1);
    expect(status.workspaceWriteBacks[0].phase).toBe(
      WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED,
    );
  });
});

describe("parseGithubRepo", () => {
  it("parses HTTPS URL with .git suffix", () => {
    const result = parseGithubRepo("https://github.com/acme/my-app.git");
    expect(result).toEqual({ owner: "acme", repo: "my-app" });
  });

  it("parses HTTPS URL without .git suffix", () => {
    const result = parseGithubRepo("https://github.com/acme/my-app");
    expect(result).toEqual({ owner: "acme", repo: "my-app" });
  });

  it("parses HTTPS URL with token", () => {
    const result = parseGithubRepo("https://ghp_token@github.com/acme/my-app.git");
    expect(result).toEqual({ owner: "acme", repo: "my-app" });
  });

  it("parses SSH URL", () => {
    const result = parseGithubRepo("git@github.com:acme/my-app.git");
    expect(result).toEqual({ owner: "acme", repo: "my-app" });
  });

  it("throws for non-GitHub URLs", () => {
    expect(() => parseGithubRepo("https://gitlab.com/acme/my-app.git"))
      .toThrow("Cannot parse GitHub owner/repo");
  });
});
