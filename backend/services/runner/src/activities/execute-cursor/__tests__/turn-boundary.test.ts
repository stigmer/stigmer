/**
 * Tests for the extracted turn boundary (turn-boundary.ts) — the post-run
 * pipeline shared by the primary path and the recovery retries.
 *
 * The load-bearing scenario is the recovery-retry sequence that motivated the
 * extraction (production case aex_01kws27q1e2esvkqjpvectttxf): the primary
 * boundary runs against an untouched tree (the resumed agent errored before
 * doing anything), the retry agent then edits files, and the boundary is
 * re-entered — the candidate must be authored exactly once and the turn must
 * pause for review. Runs against a REAL temp git repo with in-memory
 * transcript + status protos, mirroring capture-flow.test.ts.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  FileReviewEventType,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { captureBaselineToLedger } from "../capture-flow.js";
import { denialLedgerPath } from "../approval-state.js";
import { toolCallIdentityToken } from "../message-translator.js";
import { runTurnBoundary, type TurnBoundaryOptions } from "../turn-boundary.js";

const execFileAsync = promisify(execFile);
const EXEC_ID = "exec-boundary-1";
const CHANGE_SET_ID = `${EXEC_ID}:0`;

let repo: string;
let hitlDir: string;

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repo });
}
async function write(rel: string, content: string): Promise<void> {
  await writeFile(join(repo, rel), content, "utf-8");
}

function newStatus(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {});
}

/** A streamed (COMPLETED) file-edit tool call, as the SDK would have recorded. */
function streamedEdit(id: string, path: string, content: string): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    toolCalls: [
      create(ToolCallSchema, {
        id,
        name: "edit",
        status: ToolCallStatus.TOOL_CALL_COMPLETED,
        args: { path, content },
      }),
    ],
  });
}

/** Boundary options for this repo's turn; overrides layer the per-test shape. */
function boundaryOpts(
  status: AgentExecutionStatus,
  baselineTree: string,
  overrides?: Partial<TurnBoundaryOptions>,
): TurnBoundaryOptions {
  return {
    status,
    executionId: EXEC_ID,
    changeSetId: CHANGE_SET_ID,
    hitlDir,
    captureMode: true,
    baselineTree,
    primaryWorkspaceDir: repo,
    gitWorkspace: true,
    turnStartMessageIndex: 0,
    approvalGrants: undefined,
    globalBypass: false,
    seededSubAgents: [],
    artifactStorage: undefined,
    mergedPolicies: new Map(),
    ...overrides,
  };
}

function candidateEvents(status: AgentExecutionStatus) {
  return (status.fileReviewEventStream?.events ?? []).filter(
    (e) => e.eventType === FileReviewEventType.CANDIDATE_CAPTURED,
  );
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "stigmer-boundary-repo-"));
  hitlDir = await mkdtemp(join(tmpdir(), "stigmer-boundary-hitl-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "t@t.local"]);
  await git(["config", "user.name", "t"]);
  await write("notes.md", "original notes\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "initial"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(hitlDir, { recursive: true, force: true });
});

describe("runTurnBoundary", () => {
  it("authors a candidate, stamps the row, and pauses when the turn edited files", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });

    await write("notes.md", "original notes\n\n## TODO\n- ship\n");
    status.messages.push(
      streamedEdit("tc-1", "notes.md", "original notes\n\n## TODO\n- ship\n"),
    );

    const result = await runTurnBoundary(boundaryOpts(status, baseline));

    expect(result.waiting).toBe(true);
    expect(result.capturedChangeCount).toBe(1);
    expect(result.deniedToolCallCount).toBe(0);
    expect(candidateEvents(status)).toHaveLength(1);
    // The streamed row is stamped with the change set id (observational record
    // anchoring the decision surface).
    expect(status.messages[0].toolCalls[0].fileChangeSetId).toBe(CHANGE_SET_ID);
  });

  it("reports a clean turn when nothing changed (no candidate, no pause)", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });

    const result = await runTurnBoundary(boundaryOpts(status, baseline));

    expect(result.waiting).toBe(false);
    expect(result.capturedChangeCount).toBe(0);
    expect(result.deniedToolCallCount).toBe(0);
    expect(candidateEvents(status)).toHaveLength(0);
  });

  it("skips capture when no baseline was authored this turn", async () => {
    const status = newStatus();
    await write("notes.md", "edited without a baseline\n");

    const result = await runTurnBoundary(
      boundaryOpts(status, "", { baselineTree: undefined }),
    );

    expect(result.waiting).toBe(false);
    expect(result.capturedChangeCount).toBe(0);
    expect(candidateEvents(status)).toHaveLength(0);
  });

  it("re-entered after a no-op primary call, authors the candidate exactly once (recovery-retry sequence)", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });

    // Primary boundary: the resumed agent errored before touching anything —
    // the tree is at baseline, no candidate is authored, the turn looks clean.
    const primary = await runTurnBoundary(boundaryOpts(status, baseline));
    expect(primary.waiting).toBe(false);
    expect(candidateEvents(status)).toHaveLength(0);

    // Recovery retry: a fresh agent re-ran the prompt and created the file.
    await write("notes.md", "original notes\n\nretry made this edit\n");
    status.messages.push(
      streamedEdit("tc-retry", "notes.md", "original notes\n\nretry made this edit\n"),
    );

    // Boundary re-entry: the retry's edit reaches the ledger and arms the gate.
    const retry = await runTurnBoundary(boundaryOpts(status, baseline));
    expect(retry.waiting).toBe(true);
    expect(retry.capturedChangeCount).toBe(1);
    expect(candidateEvents(status)).toHaveLength(1);
    expect(status.messages[0].toolCalls[0].fileChangeSetId).toBe(CHANGE_SET_ID);
  });

  it("surfaces a hook denial as a WAITING_APPROVAL gate and pauses", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });

    // The hook gated a shell command mid-turn; the streamed call is still
    // RUNNING (Cursor reported the deny to the model, not a completion).
    const shellCall = create(ToolCallSchema, {
      id: "tc-shell",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_RUNNING,
      args: { command: "rm -rf build" },
    });
    status.messages.push(
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: "cleaning the build dir",
        toolCalls: [shellCall],
      }),
    );
    await writeFile(
      denialLedgerPath(hitlDir),
      JSON.stringify({ toolName: "shell", token: toolCallIdentityToken(shellCall) }) + "\n",
      "utf-8",
    );

    const result = await runTurnBoundary(boundaryOpts(status, baseline));

    expect(result.waiting).toBe(true);
    expect(result.deniedToolCallCount).toBe(1);
    expect(result.capturedChangeCount).toBe(0);
    expect(shellCall.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("waits for the denial-stop cancel to settle before reading the ledger", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });

    const shellCall = create(ToolCallSchema, {
      id: "tc-late",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_RUNNING,
      args: { command: "curl example.com" },
    });
    status.messages.push(
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        toolCalls: [shellCall],
      }),
    );

    // The denial lands only while the cancel is settling — a premature ledger
    // read would miss it and leave the row RUNNING forever.
    const denialCancelSettled = (async () => {
      await writeFile(
        denialLedgerPath(hitlDir),
        JSON.stringify({ toolName: "shell", token: toolCallIdentityToken(shellCall) }) + "\n",
        "utf-8",
      );
    })();

    const result = await runTurnBoundary(
      boundaryOpts(status, baseline, { denialCancelSettled }),
    );

    expect(result.deniedToolCallCount).toBe(1);
    expect(shellCall.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });
});
