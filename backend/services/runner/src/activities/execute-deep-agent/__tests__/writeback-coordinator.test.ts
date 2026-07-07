import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { WorkspaceWriteBackPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { GitWriteBackMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { StatusBuilder } from "../status-builder.js";
import {
  WriteBackCoordinator,
  parseGithubRepo,
  extractGithubToken,
} from "../writeback-coordinator.js";
import type { WorkspaceBackend, ProvisionResult } from "../../../shared/workspace/types.js";
import { SourceType } from "../../../shared/workspace/types.js";
import {
  AGENT_GIT_AUTHOR_NAME,
  AGENT_GIT_AUTHOR_EMAIL,
} from "../../../shared/workspace/git-identity.js";

function makeStatusBuilder(): StatusBuilder {
  return new StatusBuilder("exec-wb-test", create(AgentExecutionStatusSchema, {}));
}

function makeProvisionResult(overrides: Partial<ProvisionResult> = {}): ProvisionResult {
  return {
    rootDir: "/workspace/my-app",
    sourceType: SourceType.GIT_REPO,
    consumedKeys: [],
    workspaceDescription: "test",
    entryName: "my-app",
    gitMetadata: {
      repoUrl: "https://ghp_TOKEN@github.com/acme/my-app.git",
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
    "git checkout -b": "",
    "git add -A": "",
    "commit -m": "",
    "git rev-parse HEAD": "abc123def456",
    "git push -u origin": "",
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

const originalFetch = globalThis.fetch;

describe("WriteBackCoordinator", () => {
  let sb: StatusBuilder;

  beforeEach(() => {
    sb = makeStatusBuilder();
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ html_url: "https://github.com/acme/my-app/pull/42", number: 42 }),
        { status: 201 },
      ),
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("filters out non-git workspace entries", () => {
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-123",
      provisionResults: [makeProvisionResult({ sourceType: SourceType.LOCAL_PATH })],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: mockWorkspaceBackend(),
    });

    expect(coord.hasEligibleEntries).toBe(false);
  });

  it("filters out entries without git credentials", () => {
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-123",
      provisionResults: [makeProvisionResult({
        gitMetadata: {
          repoUrl: "https://github.com/acme/my-app.git",
          branch: "main",
          baseCommit: "abc",
          gitCredentialsConfigured: false,
        },
      })],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: mockWorkspaceBackend(),
    });

    expect(coord.hasEligibleEntries).toBe(false);
  });

  it("accepts entries with UNSPECIFIED write-back mode (platform decides)", () => {
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-123",
      provisionResults: [makeProvisionResult()],
      workspaceEntries: [makeWorkspaceEntry("my-app", GitWriteBackMode.GIT_WRITE_BACK_MODE_UNSPECIFIED)],
      workspaceBackend: mockWorkspaceBackend(),
    });

    expect(coord.hasEligibleEntries).toBe(true);
  });

  it("performs full incremental cycle: branch -> commit -> push -> PR", async () => {
    const backend = mockWorkspaceBackend();
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-12345678rest",
      provisionResults: [makeProvisionResult()],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: backend,
    });

    await coord.onFileModified("src/main.ts");

    const wbs = sb.currentStatus.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].branchName).toBe("stigmer/exec-123");
    expect(wbs[0].baseBranch).toBe("main");
    expect(wbs[0].commitSha).toBe("abc123def456");
    expect(wbs[0].pullRequestUrl).toBe("https://github.com/acme/my-app/pull/42");
    expect(wbs[0].pullRequestNumber).toBe(42);
    expect(wbs[0].phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED);

    const executeCalls = (backend.execute as ReturnType<typeof vi.fn>).mock.calls;
    const commands = executeCalls.map((c: any) => c[0] as string);
    expect(commands.some((c: string) => c.includes("git checkout -b stigmer/exec-123"))).toBe(true);
    expect(commands.some((c: string) => c.includes("git add -A"))).toBe(true);
    expect(commands.some((c: string) => c.includes("commit -m"))).toBe(true);
    expect(commands.some((c: string) => c.includes("git push -u origin"))).toBe(true);
  });

  it("commits with the agent identity pinned via -c flags", async () => {
    const backend = mockWorkspaceBackend();
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-12345678rest",
      provisionResults: [makeProvisionResult()],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: backend,
    });

    await coord.onFileModified("src/main.ts");

    const executeCalls = (backend.execute as ReturnType<typeof vi.fn>).mock.calls;
    const commands = executeCalls.map((c: any) => c[0] as string);
    const commitCommand = commands.find((c: string) => c.includes("git") && c.includes("commit -m"));
    expect(commitCommand,
      "commit must not depend on ambient git identity — the cloud sandbox has none",
    ).toBeDefined();
    expect(commitCommand).toContain(`-c user.name='${AGENT_GIT_AUTHOR_NAME}'`);
    expect(commitCommand).toContain(`-c user.email='${AGENT_GIT_AUTHOR_EMAIL}'`);
    expect(commitCommand).toContain('commit -m "agent changes (1)"');
  });

  it("skips when there are no changes", async () => {
    const backend = mockWorkspaceBackend({
      "git diff --stat": "",
      "git ls-files --others --exclude-standard": "",
    });

    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-123",
      provisionResults: [makeProvisionResult()],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: backend,
    });

    await coord.onFileModified("src/main.ts");

    expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(0);
  });

  it("on second call, commits to existing branch without re-creating", async () => {
    const backend = mockWorkspaceBackend();
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-12345678rest",
      provisionResults: [makeProvisionResult()],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: backend,
    });

    await coord.onFileModified("first.ts");
    await coord.onFileModified("second.ts");

    const executeCalls = (backend.execute as ReturnType<typeof vi.fn>).mock.calls;
    const commands = executeCalls.map((c: any) => c[0] as string);
    const checkoutCalls = commands.filter((c: string) => c.includes("git checkout -b"));
    expect(checkoutCalls).toHaveLength(1);

    const pushCalls = commands.filter((c: string) => c.includes("git push"));
    expect(pushCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("sets FAILED phase on git error after mutation started", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const backend = mockWorkspaceBackend({
      "git checkout -b": "",
    });
    (backend.execute as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd.includes("git diff --stat") && !cmd.includes("...HEAD")) return " changed";
      if (cmd.includes("git diff --cached")) return "";
      if (cmd.includes("git checkout -b")) return "";
      if (cmd.includes("git add")) return "";
      if (cmd.includes("commit -m")) throw new Error("commit failed: lock");
      return "";
    });

    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-123",
      provisionResults: [makeProvisionResult()],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: backend,
    });

    await coord.onFileModified("src/main.ts");

    const wbs = sb.currentStatus.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED);
    expect(wbs[0].error).toContain("commit failed");
    warnSpy.mockRestore();
  });

  it("finalize catches remaining uncommitted changes", async () => {
    const backend = mockWorkspaceBackend();
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-12345678rest",
      provisionResults: [makeProvisionResult()],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: backend,
    });

    await coord.finalize();

    expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(1);
    expect(sb.currentStatus.workspaceWriteBacks[0].phase).toBe(
      WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED,
    );
  });

  it("resolves path to single entry without prefix matching", async () => {
    const backend = mockWorkspaceBackend();
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-12345678rest",
      provisionResults: [makeProvisionResult()],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: backend,
    });

    await coord.onFileModified("any/path/file.ts");

    expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(1);
  });

  it("resolves path to correct entry in multi-entry workspace", async () => {
    const backend = mockWorkspaceBackend();
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-12345678rest",
      provisionResults: [
        makeProvisionResult({ entryName: "frontend", rootDir: "/workspace/frontend" }),
        makeProvisionResult({ entryName: "backend", rootDir: "/workspace/backend" }),
      ],
      workspaceEntries: [
        makeWorkspaceEntry("frontend"),
        makeWorkspaceEntry("backend"),
      ],
      workspaceBackend: backend,
    });

    await coord.onFileModified("frontend/src/app.tsx");

    const wbs = sb.currentStatus.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].workspaceEntryName).toBe("frontend");
  });

  it("ignores paths outside eligible entries in multi-entry mode", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const backend = mockWorkspaceBackend();
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-123",
      provisionResults: [
        makeProvisionResult({ entryName: "frontend", rootDir: "/workspace/frontend" }),
      ],
      workspaceEntries: [makeWorkspaceEntry("frontend")],
      workspaceBackend: backend,
    });

    const coord2 = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-123",
      provisionResults: [
        makeProvisionResult({ entryName: "fe", rootDir: "/workspace/fe" }),
        makeProvisionResult({ entryName: "be", rootDir: "/workspace/be" }),
      ],
      workspaceEntries: [makeWorkspaceEntry("fe"), makeWorkspaceEntry("be")],
      workspaceBackend: backend,
    });

    await coord2.onFileModified("unknown/file.ts");
    expect(sb.currentStatus.workspaceWriteBacks).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("PR creation failure sets FAILED phase", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
    ) as typeof fetch;

    const backend = mockWorkspaceBackend();
    const coord = new WriteBackCoordinator({
      statusWriter: sb,
      executionId: "exec-12345678rest",
      provisionResults: [makeProvisionResult()],
      workspaceEntries: [makeWorkspaceEntry("my-app")],
      workspaceBackend: backend,
    });

    await coord.onFileModified("src/main.ts");

    const wbs = sb.currentStatus.workspaceWriteBacks;
    expect(wbs).toHaveLength(1);
    expect(wbs[0].phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED);
    expect(wbs[0].error).toContain("GitHub API error");
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

describe("extractGithubToken", () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it("extracts token from HTTPS URL", () => {
    const token = extractGithubToken("https://ghp_abc123@github.com/acme/app.git");
    expect(token).toBe("ghp_abc123");
  });

  it("falls back to GITHUB_TOKEN env var", () => {
    process.env.GITHUB_TOKEN = "env-token";
    const token = extractGithubToken("https://github.com/acme/app.git");
    expect(token).toBe("env-token");
  });

  it("throws when no token available", () => {
    expect(() => extractGithubToken("https://github.com/acme/app.git"))
      .toThrow("Cannot extract GitHub token");
  });
});
