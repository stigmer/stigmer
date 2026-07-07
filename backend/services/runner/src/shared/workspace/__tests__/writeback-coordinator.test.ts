import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { WorkspaceWriteBackPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { GitWriteBackMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  statusProtoWriter,
  type ExecutionStatusWriter,
} from "../../execution-status-writer.js";
import {
  WriteBackCoordinator,
  parseGithubRepo,
} from "../writeback-coordinator.js";
import type { WorkspaceBackend, ProvisionResult } from "../types.js";
import { SourceType } from "../types.js";
import {
  AGENT_GIT_AUTHOR_NAME,
  AGENT_GIT_AUTHOR_EMAIL,
} from "../git-identity.js";

const SESSION_ID = "ses-01test";
const SESSION_BRANCH = `stigmer/${SESSION_ID}`;

// The shared proto-backed writer — the same implementation the Cursor harness
// wires in, and upsert-compatible with the deep-agent StatusBuilder.
function makeStatusBuilder(): ExecutionStatusWriter {
  return statusProtoWriter(create(AgentExecutionStatusSchema, {}));
}

function makeProvisionResult(overrides: Partial<ProvisionResult> = {}): ProvisionResult {
  return {
    rootDir: "/workspace/my-app",
    sourceType: SourceType.GIT_REPO,
    consumedKeys: [],
    workspaceDescription: "test",
    entryName: "my-app",
    gitMetadata: {
      // Token-stripped, as extractGitMetadata always records it.
      repoUrl: "https://github.com/acme/my-app.git",
      branch: "main",
      baseCommit: "abc123",
      gitCredentialsConfigured: true,
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
        value: { writeBackMode },
      },
    },
    $typeName: "ai.stigmer.agentic.session.v1.WorkspaceEntry" as const,
  } as any;
}

function mockWorkspaceBackend(responses: Record<string, string> = {}): WorkspaceBackend {
  const defaultResponses: Record<string, string> = {
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
  sb: ExecutionStatusWriter;
  backend?: WorkspaceBackend;
  executionId?: string;
  sessionId?: string;
  githubToken?: string;
  provisionResults?: ProvisionResult[];
  workspaceEntries?: any[];
}): WriteBackCoordinator {
  return new WriteBackCoordinator({
    statusWriter: opts.sb,
    executionId: opts.executionId ?? "exec-12345678rest",
    sessionId: opts.sessionId ?? SESSION_ID,
    githubToken: opts.githubToken ?? "ghp_plumbed_token",
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
  let sb: ExecutionStatusWriter;

  beforeEach(() => {
    sb = makeStatusBuilder();
    mockGithubApi();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Eligibility ─────────────────────────────────────────────────────

  it("filters out non-git workspace entries", () => {
    const coord = makeCoordinator({
      sb,
      provisionResults: [makeProvisionResult({ sourceType: SourceType.LOCAL_PATH })],
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
          gitCredentialsConfigured: false,
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

  it("performs full cycle on the SESSION branch: branch -> commit -> push -> PR", async () => {
    const backend = mockWorkspaceBackend();
    const coord = makeCoordinator({ sb, backend });

    await coord.onFileModified("src/main.ts");

    const wbs = sb.currentStatus.workspaceWriteBacks;
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

    await coord.onFileModified("src/main.ts");

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

    await coord.onFileModified("src/main.ts");

    expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(0);
  });

  // ── Session-branch idempotency ──────────────────────────────────────

  it("on second call, commits to the existing branch without re-creating", async () => {
    const backend = mockWorkspaceBackend();
    const coord = makeCoordinator({ sb, backend });

    await coord.onFileModified("first.ts");
    await coord.onFileModified("second.ts");

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

    await coord.onFileModified("src/more.ts");

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

    await coord.onFileModified("src/main.ts");

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

    await coord.onFileModified("src/main.ts");

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

    await coord.onFileModified("src/main.ts");

    const wbs = sb.currentStatus.workspaceWriteBacks;
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

    await coord.onFileModified("src/main.ts");

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
      if (cmd.includes("commit -m")) throw new Error("commit failed: lock");
      return "";
    });
    const coord = makeCoordinator({ sb, backend });

    await coord.onFileModified("src/main.ts");

    const wbs = sb.currentStatus.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED);
    expect(wbs[0].error).toContain("commit failed");
    warnSpy.mockRestore();
  });

  it("reports PUSHED with the PR error when PR creation fails after a successful push", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGithubApi({ createStatus: 403 });
    const coord = makeCoordinator({ sb });

    await coord.onFileModified("src/main.ts");

    const wbs = sb.currentStatus.workspaceWriteBacks;
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

    await coord.onFileModified("src/main.ts");

    const wbs = sb.currentStatus.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED);
    expect(wbs[0].error).toContain("No GitHub token");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ── finalize / path resolution ──────────────────────────────────────

  it("finalize catches remaining uncommitted changes", async () => {
    const coord = makeCoordinator({ sb });

    await coord.finalize();

    expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(1);
    expect(sb.currentStatus.workspaceWriteBacks[0].phase).toBe(
      WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED,
    );
  });

  it("resolves path to single entry without prefix matching", async () => {
    const coord = makeCoordinator({ sb });

    await coord.onFileModified("any/path/file.ts");

    expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(1);
  });

  it("resolves path to correct entry in multi-entry workspace", async () => {
    const coord = makeCoordinator({
      sb,
      provisionResults: [
        makeProvisionResult({ entryName: "frontend", rootDir: "/workspace/frontend" }),
        makeProvisionResult({ entryName: "backend", rootDir: "/workspace/backend" }),
      ],
      workspaceEntries: [
        makeWorkspaceEntry("frontend"),
        makeWorkspaceEntry("backend"),
      ],
    });

    await coord.onFileModified("frontend/src/app.tsx");

    const wbs = sb.currentStatus.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].workspaceEntryName).toBe("frontend");
  });

  it("ignores paths outside eligible entries in multi-entry mode", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const coord = makeCoordinator({
      sb,
      provisionResults: [
        makeProvisionResult({ entryName: "fe", rootDir: "/workspace/fe" }),
        makeProvisionResult({ entryName: "be", rootDir: "/workspace/be" }),
      ],
      workspaceEntries: [makeWorkspaceEntry("fe"), makeWorkspaceEntry("be")],
    });

    await coord.onFileModified("unknown/file.ts");
    expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(0);
    warnSpy.mockRestore();
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
