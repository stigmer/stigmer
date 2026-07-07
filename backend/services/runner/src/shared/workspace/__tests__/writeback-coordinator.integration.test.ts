/**
 * Real-git integration tests for the session-scoped write-back lifecycle.
 *
 * A hermetic origin (local bare repo) and a working clone stand in for
 * GitHub + the session workspace; only the PR API is mocked. These prove the
 * behaviors the mocked unit suite cannot: that `ensureBranch`'s checkout
 * cases and the always-`-u` push compose correctly against real git across
 * SEQUENTIAL COORDINATOR INSTANCES (turn 1 and turn 2 of one session), and
 * that only the tree's content at finalize — the post-reconcile, approved
 * content — reaches the session branch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { WorkspaceWriteBackPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { GitWriteBackMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { WriteBackCoordinator } from "../writeback-coordinator.js";
import { LocalWorkspaceBackend } from "../local-backend.js";
import { statusProtoWriter, type ExecutionStatusWriter } from "../../execution-status-writer.js";
import type { ProvisionResult } from "../types.js";
import { SourceType } from "../types.js";
import { AGENT_GIT_AUTHOR_EMAIL } from "../git-identity.js";

const SESSION_ID = "ses-int-01";
const SESSION_BRANCH = `stigmer/${SESSION_ID}`;

// Real git spawns (init/clone/commit/push, ~a dozen per test) are slow under
// full-suite parallel load — observed >40s wall clock at ~4s of actual work.
const GIT_TEST_TIMEOUT_MS = 120_000;

let tmpRoot: string;
let originDir: string;
let workDir: string;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "human",
      GIT_AUTHOR_EMAIL: "human@example.com",
      GIT_COMMITTER_NAME: "human",
      GIT_COMMITTER_EMAIL: "human@example.com",
    },
  });
}

function makeCoordinator(
  executionId: string,
  writer: ExecutionStatusWriter,
): WriteBackCoordinator {
  const provisionResult: ProvisionResult = {
    rootDir: workDir,
    sourceType: SourceType.GIT_REPO,
    consumedKeys: [],
    workspaceDescription: "integration",
    entryName: "repo",
    gitMetadata: {
      repoUrl: "https://github.com/acme/repo.git",
      branch: "main",
      baseCommit: git(workDir, ["rev-parse", "main"]).trim(),
      gitCredentialsConfigured: true,
    },
  };
  return new WriteBackCoordinator({
    statusWriter: writer,
    executionId,
    sessionId: SESSION_ID,
    githubToken: "ghp_test",
    provisionResults: [provisionResult],
    workspaceEntries: [
      {
        name: "repo",
        source: {
          source: {
            case: "gitRepo" as const,
            value: { writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR },
          },
        },
      } as any,
    ],
    workspaceBackend: new LocalWorkspaceBackend(workDir),
  });
}

/** The PR API mock: no open PR on first list, then created; adopted after. */
function mockGithubApi(): Array<{ method: string; url: string }> {
  const calls: Array<{ method: string; url: string }> = [];
  let created = false;
  globalThis.fetch = vi.fn(async (url: any, init?: any) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url: String(url) });
    if (method === "GET") {
      const body = created
        ? [{ html_url: "https://github.com/acme/repo/pull/5", number: 5 }]
        : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }
    created = true;
    return new Response(
      JSON.stringify({ html_url: "https://github.com/acme/repo/pull/5", number: 5 }),
      { status: 201 },
    );
  }) as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "wb-int-"));
  originDir = join(tmpRoot, "origin.git");
  workDir = join(tmpRoot, "work");

  execFileSync("git", ["init", "--bare", "-b", "main", originDir], { stdio: "pipe" });
  execFileSync("git", ["clone", originDir, workDir], { stdio: "pipe" });
  writeFileSync(join(workDir, "README.md"), "# seed\n");
  git(workDir, ["add", "-A"]);
  git(workDir, ["commit", "-m", "seed"]);
  git(workDir, ["push", "-u", "origin", "main"]);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("WriteBackCoordinator against real git", () => {
  it(
    "pushes turn 1 to the session branch, then turn 2 (new instance) appends to it and adopts the PR",
    async () => {
      const apiCalls = mockGithubApi();

      // ── Turn 1: the agent created a file; the review kept it. ──
      writeFileSync(join(workDir, "notes.md"), "approved content\n");
      const status1 = create(AgentExecutionStatusSchema, {});
      const coord1 = makeCoordinator("exec-turn-1", statusProtoWriter(status1));
      await coord1.finalize();

      const wb1 = status1.workspaceWriteBacks[0];
      expect(wb1.phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED);
      expect(wb1.branchName).toBe(SESSION_BRANCH);
      expect(wb1.pullRequestNumber).toBe(5);

      // The commit is on origin's session branch, authored as the agent, and
      // main is untouched.
      const tip1 = git(originDir, ["rev-parse", SESSION_BRANCH]).trim();
      expect(git(originDir, ["show", `${tip1}:notes.md`])).toBe("approved content\n");
      expect(git(originDir, ["log", "-1", "--format=%ae", SESSION_BRANCH]).trim())
        .toBe(AGENT_GIT_AUTHOR_EMAIL);
      expect(() => git(originDir, ["show", "main:notes.md"])).toThrow();

      // ── Turn 2: a NEW coordinator (new execution, same session). The agent
      // edited two files; the review discarded one — the reconcile snapped it
      // back BEFORE finalize, so only the kept edit is in the tree. ──
      writeFileSync(join(workDir, "notes.md"), "approved content\nkept edit\n");
      writeFileSync(join(workDir, "rejected.md"), "discarded content\n");
      rmSync(join(workDir, "rejected.md")); // the reconcile's snap-back

      const status2 = create(AgentExecutionStatusSchema, {});
      const coord2 = makeCoordinator("exec-turn-2", statusProtoWriter(status2));
      await coord2.finalize();

      const wb2 = status2.workspaceWriteBacks[0];
      expect(wb2.phase).toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED);
      expect(wb2.branchName, "same session branch across executions").toBe(SESSION_BRANCH);
      expect(wb2.pullRequestNumber, "adopted, not re-created").toBe(5);
      expect(apiCalls.filter((c) => c.method === "POST"), "exactly one PR ever created")
        .toHaveLength(1);

      // Both turns' commits are on the ONE session branch; the discarded file
      // never reached the remote.
      const tip2 = git(originDir, ["rev-parse", SESSION_BRANCH]).trim();
      expect(git(originDir, ["show", `${tip2}:notes.md`])).toBe("approved content\nkept edit\n");
      expect(() => git(originDir, ["show", `${tip2}:rejected.md`])).toThrow();
      expect(
        git(originDir, ["rev-list", "--count", `main..${SESSION_BRANCH}`]).trim(),
        "one commit per approved turn",
      ).toBe("2");

      // Each commit message carries its execution id for traceability.
      const messages = git(originDir, ["log", "--format=%s", SESSION_BRANCH]);
      expect(messages).toContain("agent changes (exec-turn-1)");
      expect(messages).toContain("agent changes (exec-turn-2)");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it(
    "recovers the session branch from the remote after a workspace re-provision",
    async () => {
      mockGithubApi();

      // Turn 1 establishes the branch on origin.
      writeFileSync(join(workDir, "notes.md"), "turn one\n");
      const coord1 = makeCoordinator(
        "exec-a",
        statusProtoWriter(create(AgentExecutionStatusSchema, {})),
      );
      await coord1.finalize();

      // The sandbox is torn down; a fresh clone knows nothing of the local
      // branch (only origin has it).
      rmSync(workDir, { recursive: true, force: true });
      execFileSync("git", ["clone", originDir, workDir], { stdio: "pipe" });
      expect(git(workDir, ["branch", "--show-current"]).trim()).toBe("main");

      // Turn 2 in the fresh clone must continue the SAME branch, not fork a
      // new one from main (which would orphan turn 1's commit).
      writeFileSync(join(workDir, "more.md"), "turn two\n");
      const status2 = create(AgentExecutionStatusSchema, {});
      const coord2 = makeCoordinator("exec-b", statusProtoWriter(status2));
      await coord2.finalize();

      expect(status2.workspaceWriteBacks[0].branchName).toBe(SESSION_BRANCH);
      const tip = git(originDir, ["rev-parse", SESSION_BRANCH]).trim();
      expect(git(originDir, ["show", `${tip}:notes.md`]), "turn 1's commit is an ancestor")
        .toBe("turn one\n");
      expect(git(originDir, ["show", `${tip}:more.md`])).toBe("turn two\n");
      expect(git(originDir, ["rev-list", "--count", `main..${SESSION_BRANCH}`]).trim())
        .toBe("2");
    },
    GIT_TEST_TIMEOUT_MS,
  );
});
