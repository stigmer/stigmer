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
import { create, type JsonObject } from "@bufbuild/protobuf";
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
import { toolCallIdentityToken, UNRESOLVED_TOOL_CALL_ERROR } from "../message-translator.js";
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

  // ── Issue #205: unattributed hook blocks and the kind split ────────────────

  /** A FAILED tool call carrying Cursor's generic hook-block error text. */
  function hookBlockedCall(id: string, name: string, args: JsonObject) {
    return create(ToolCallSchema, {
      id,
      name,
      status: ToolCallStatus.TOOL_CALL_FAILED,
      error: "Command blocked by a hook.",
      args,
    });
  }

  /** Append one entry to this turn's denial ledger. */
  async function appendLedgerEntry(entry: Record<string, unknown>): Promise<void> {
    await writeFile(denialLedgerPath(hitlDir), JSON.stringify(entry) + "\n", { flag: "a" });
  }

  it("reports a foreign hook block on a non-pausing turn (the #205 silent-complete shape)", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
    });

    // A foreign .cursor/hooks.json hook denied the write: Cursor stamped its
    // generic error, our ledger stayed empty, the tree is untouched. Before
    // this fix the boundary reported a clean non-waiting turn and the run
    // completed silently with the work undone.
    const blocked = hookBlockedCall("tc-foreign", "edit", { path: "notes.md" });
    status.messages.push(
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [blocked] }),
    );

    const result = await runTurnBoundary(
      boundaryOpts(status, baseline, { foreignGatingHooks: ["./team-policy.sh"] }),
    );

    expect(result.waiting).toBe(false);
    expect(result.unattributedHookBlocks).toEqual([
      { toolCallId: "tc-foreign", toolName: "edit", error: "Command blocked by a hook." },
    ]);
    // The row itself is untouched — no gate was manufactured for a block no
    // approval can lift; the caller fails the execution instead.
    expect(blocked.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
  });

  it("attributes a secret hard-block (kind:'secret'): no pause, no false foreign-hook report", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
    });

    const secretRow = hookBlockedCall("tc-secret", "edit", { path: ".env" });
    status.messages.push(
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [secretRow] }),
    );
    await writeFile(
      denialLedgerPath(hitlDir),
      JSON.stringify({
        toolName: "Write", token: toolCallIdentityToken(secretRow), kind: "secret",
      }) + "\n",
      "utf-8",
    );

    const result = await runTurnBoundary(boundaryOpts(status, baseline));

    // Not a pause (the agent was told to move on), not a foreign block (our
    // own kinded entry attributes it), and never a WAITING_APPROVAL overlay.
    expect(result.waiting).toBe(false);
    expect(result.deniedToolCallCount).toBe(0);
    expect(result.unattributedHookBlocks).toEqual([]);
    expect(secretRow.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
  });

  it("mixed turn: pauses on our anchor while still reporting the foreign block", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
    });

    const ourGated = create(ToolCallSchema, {
      id: "tc-ours", name: "shell",
      status: ToolCallStatus.TOOL_CALL_RUNNING,
      args: { command: "rm -rf build" },
    });
    const foreign = hookBlockedCall("tc-theirs", "shell", { command: "terraform apply" });
    status.messages.push(
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [ourGated, foreign] }),
    );
    await appendLedgerEntry({ toolName: "shell", token: toolCallIdentityToken(ourGated), kind: "approval" });

    const result = await runTurnBoundary(boundaryOpts(status, baseline));

    // The pause wins (a pausing turn is never silent); the foreign block is
    // still surfaced so the caller can log it next to the approval.
    expect(result.waiting).toBe(true);
    expect(ourGated.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(result.unattributedHookBlocks.map((b) => b.toolCallId)).toEqual(["tc-theirs"]);
  });

  it("excludes a kinded (secret) deny from the flowed-edit stamp (full-ledger deniedTokens)", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
    });

    // One edit genuinely flowed (tree changed + streamed row); one secret-like
    // write was hard-blocked (FAILED row + kind:"secret" entry, tree untouched).
    await write("notes.md", "original notes\nplus a real edit\n");
    status.messages.push(streamedEdit("tc-flowed", "notes.md", "original notes\nplus a real edit\n"));
    const secretRow = hookBlockedCall("tc-secret", "edit", { path: ".env" });
    status.messages.push(
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [secretRow] }),
    );
    await appendLedgerEntry({ toolName: "Write", token: toolCallIdentityToken(secretRow), kind: "secret" });

    const result = await runTurnBoundary(boundaryOpts(status, baseline));

    // The flowed edit is captured + stamped; the secret-blocked row is NOT
    // stamped into a change set that does not contain its file — every ledger
    // kind means "this action did not execute", so the stamp uses the FULL set.
    expect(result.waiting).toBe(true);
    expect(result.capturedChangeCount).toBe(1);
    expect(status.messages[0].toolCalls[0].fileChangeSetId).toBe(CHANGE_SET_ID);
    expect(secretRow.fileChangeSetId).toBe("");
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

// The issue #965 invariant: an unresolved tool must never silently complete.
// The production fixture is aex_01m1a6ww3nmp4952ar5v0g4g85 — Cursor's native
// `generateImage` (an interaction-channel tool no Stigmer seam touches) hung
// with no result event and no ledger entry, the turn completed, and the model's
// last words promised a write approval the platform never held. The boundary
// must settle such rows to an honest INTERRUPTED and put the platform's own
// disclosure on the transcript so the model's claim is never the last word.
describe("runTurnBoundary — unresolved tool calls on a completing turn (issue #965)", () => {
  /** The incident's exact row shape: a streamed call that never resolved. */
  function hangingGenerateImage(id: string): AgentMessage {
    return create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      toolCalls: [
        create(ToolCallSchema, {
          id,
          name: "generateImage",
          status: ToolCallStatus.TOOL_CALL_RUNNING,
          args: { description: "a red circle", filePath: "red-circle.png" },
        }),
      ],
    });
  }

  it("settles the incident shape to INTERRUPTED and discloses it (regression: aex_01m1a6ww)", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });
    status.messages.push(hangingGenerateImage("tc-genimage-1"));

    const result = await runTurnBoundary(boundaryOpts(status, baseline));

    // The turn completes (no pause) — but not silently.
    expect(result.waiting).toBe(false);
    expect(result.settledUnresolvedCount).toBe(1);

    const row = status.messages[0].toolCalls[0];
    // INTERRUPTED, never FAILED: the one settled status a recovery replay may
    // supersede (the #207 contract) — a FAILED stamp would freeze the row.
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_INTERRUPTED);
    expect(row.error).toBe(UNRESOLVED_TOOL_CALL_ERROR);
    expect(row.isStreaming).toBe(false);
    expect(row.completedAt).not.toBe("");

    // The platform's disclosure is the transcript's last word — it names the
    // tool and explicitly denies the phantom approval.
    const last = status.messages[status.messages.length - 1];
    expect(last.type).toBe(MessageType.MESSAGE_SYSTEM);
    expect(last.content).toContain("generateImage");
    expect(last.content).toContain("No approval is pending");
  });

  it("leaves non-terminal rows to the pause machinery on a PAUSING turn", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });
    // A captured file change makes the turn pause…
    await write("notes.md", "original notes\npaused-turn edit\n");
    status.messages.push(
      streamedEdit("tc-edit-1", "notes.md", "original notes\npaused-turn edit\n"),
    );
    // …while a hanging row rides the same turn.
    status.messages.push(hangingGenerateImage("tc-genimage-2"));

    const result = await runTurnBoundary(boundaryOpts(status, baseline));

    expect(result.waiting).toBe(true);
    expect(result.settledUnresolvedCount).toBe(0);
    // Untouched by THIS sweep (a pausing turn's rows belong to the reconcile /
    // collapse machinery, which has its own treatment for orphaned attempts).
    expect(status.messages[1].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
  });

  it("never settles a ledger-attributed row — that is the kinded machinery's call", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });
    const secretWrite = create(ToolCallSchema, {
      id: "tc-secret-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_PENDING,
      args: { path: ".env", content: "API_KEY=x" },
    });
    status.messages.push(
      create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [secretWrite] }),
    );
    // A secret-kind hard-block entry: attributable (kind non-approval), so the
    // row is accounted for and must NOT be swept as "unresolved".
    await writeFile(
      denialLedgerPath(hitlDir),
      JSON.stringify({
        toolName: "Write",
        token: toolCallIdentityToken(secretWrite),
        kind: "secret",
      }) + "\n",
      "utf-8",
    );

    const result = await runTurnBoundary(boundaryOpts(status, baseline));

    expect(result.settledUnresolvedCount).toBe(0);
    expect(secretWrite.status).toBe(ToolCallStatus.TOOL_CALL_PENDING);
  });

  it("scopes to THIS turn: seeded prior-turn rows and terminal rows are untouched", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
    });
    // Message 0 is seeded prior-turn context (already adjudicated elsewhere).
    status.messages.push(hangingGenerateImage("tc-prior-turn"));
    // Message 1 opens this turn: one real terminal row.
    status.messages.push(
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        toolCalls: [
          create(ToolCallSchema, {
            id: "tc-done",
            name: "Read",
            status: ToolCallStatus.TOOL_CALL_COMPLETED,
            result: "file contents",
          }),
        ],
      }),
    );

    const result = await runTurnBoundary(
      boundaryOpts(status, baseline, { turnStartMessageIndex: 1 }),
    );

    expect(result.settledUnresolvedCount).toBe(0);
    expect(status.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    expect(status.messages[1].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    // No disclosure was appended.
    expect(status.messages.at(-1)?.type).toBe(MessageType.MESSAGE_AI);
  });
});
