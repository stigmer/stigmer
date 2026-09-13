/**
 * The runtime's capture (`harness/capture.ts`) over a REAL git work tree,
 * without any engine: the pin, the candidate, the stamp, the provenance and
 * the review decision, each as the runtime performs it between the
 * resolution phases and the outcome table.
 *
 * What is asserted here and nowhere else are the two rules the lift made
 * one for every harness (S3 M4, Q-M4-5, Q-M4-6):
 *
 *  - the stamp reads the ROW's status: a COMPLETED write row created this
 *    turn is badged, a FAILED or WAITING one is not, a seeded prior-turn row
 *    keeps its own change set;
 *  - the provenance scopes by id-novelty and consents by the row's own
 *    approval: the approved command that executed ON ITS SEEDED ROW (message
 *    0, the shape both engines produce — F-M4-P3) qualifies the turn, where
 *    a positional scope missed it.
 *
 * The ledger shape itself is `shared/filereview/capture.ts`'s and is pinned
 * by its own tests and the two harnesses' `file-review-capture` goldens; the
 * end-to-end pause and reconcile are the kit's runtime arm. The git fixture
 * is the shared one every file-review scenario stands on.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema, type AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema, type ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ApprovalAction, MessageType, SnapshotKind, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { initGitWorkspace } from "../../__test-utils__/git-workspace-fixture.js";
import { mockWorkspaceBackend } from "../../__test-utils__/mock-workspace.js";
import type { FileReviewIdentity } from "../capabilities.js";
import { captureCandidate, deriveCommandProvenance, pinCaptureBaseline } from "../capture.js";
import type { TurnWorkspace } from "../types.js";

const EXECUTION_ID = "aex-capture-unit";
const FILE_REVIEW: FileReviewIdentity = { harnessId: "unit", excludePaths: [".unit/scratch.json"] };

function workspaceOver(root: string, turnSeq = 0): TurnWorkspace {
  return {
    dirs: [root],
    primaryDir: root,
    gitWorkspace: true,
    captureMode: true,
    changeSetId: `${EXECUTION_ID}:${turnSeq}`,
    provision: { workspaceDirs: [root], provisionResults: [], workspaceBackend: mockWorkspaceBackend() },
  };
}

/** The three row facts these arms vary: the args (a path for the stamp), the server's verdict, a prior stamp. */
interface RowFacts {
  readonly args?: JsonObject;
  readonly approvalAction?: ApprovalAction;
  readonly fileChangeSetId?: string;
}

function row(id: string, name: string, status: ToolCallStatus, extra: RowFacts = {}): ToolCall {
  return create(ToolCallSchema, { id, name, status, ...extra });
}

function messageWith(...toolCalls: ToolCall[]) {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls });
}

describe("harness/capture over a git work tree", () => {
  let root: string;
  let status: AgentExecutionStatus;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "stigmer-capture-unit-"));
    initGitWorkspace(root, { "notes.md": "one\n", "keep.md": "keep\n" });
    status = create(AgentExecutionStatusSchema, {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("outside capture mode there is nothing to pin", async () => {
    const capture = await pinCaptureBaseline({
      status,
      executionId: EXECUTION_ID,
      workspace: { ...workspaceOver(root), captureMode: false },
      fileReview: FILE_REVIEW,
      artifactStorage: undefined,
    });
    expect(capture).toBeUndefined();
    expect(status.fileReviewEventStream).toBeUndefined();
  });

  it("pins the baseline, captures the net change after the turn, stamps only the COMPLETED write rows, and reports the review pending", async () => {
    const workspace = workspaceOver(root);
    const capture = (await pinCaptureBaseline({ status, executionId: EXECUTION_ID, workspace, fileReview: FILE_REVIEW, artifactStorage: undefined }))!;
    expect(capture.baselineTree).toMatch(/^[0-9a-f]{40}$/);
    expect(status.fileReviewEventStream?.events.map((e) => e.payload.case)).toEqual(["baselineCaptured"]);

    // The engine's turn: one edit flowed, one edit failed, one write is still
    // waiting at a gate (a deny-and-retry harness's denied row); an excluded
    // path written by the harness itself must never reach the diff.
    writeFileSync(join(root, "notes.md"), "one\ntwo\n");
    mkdirSync(join(root, ".unit"));
    writeFileSync(join(root, ".unit/scratch.json"), "{}");
    status.messages.push(
      messageWith(
        row("tc-flowed", "write_file", ToolCallStatus.TOOL_CALL_COMPLETED, { args: { file_path: "notes.md", content: "one\ntwo\n" } }),
        row("tc-failed", "write_file", ToolCallStatus.TOOL_CALL_FAILED, { args: { file_path: "other.md" } }),
        row("tc-denied", "write_file", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, { args: { file_path: ".env" } }),
      ),
    );

    const pending = await captureCandidate({
      status,
      executionId: EXECUTION_ID,
      workspace,
      fileReview: FILE_REVIEW,
      artifactStorage: undefined,
      capture,
      globalBypass: false,
    });

    expect(pending).toBe(true);
    const events = status.fileReviewEventStream?.events ?? [];
    expect(events.map((e) => e.payload.case)).toEqual(["baselineCaptured", "candidateCaptured"]);
    const candidate = events[1]!.payload;
    if (candidate.case !== "candidateCaptured") throw new Error("unreachable");
    expect(candidate.value.changes.map((c) => c.pathAfter), "the excluded path never enters the diff").toEqual(["notes.md"]);
    expect(candidate.value.candidateSnapshot?.kind).toBe(SnapshotKind.GIT_TREE_REF);
    expect(candidate.value.commandProvenance, "a file-tool turn never qualifies for auto-keep").toBeUndefined();

    const byId = new Map(status.messages.flatMap((m) => m.toolCalls).map((tc) => [tc.id, tc.fileChangeSetId]));
    expect(byId.get("tc-flowed"), "the COMPLETED write is badged").toBe(workspace.changeSetId);
    expect(byId.get("tc-failed"), "a FAILED write did not land").toBe("");
    expect(byId.get("tc-denied"), "a WAITING write did not land").toBe("");
  });

  it("a turn that changed nothing authors no candidate and pends no review", async () => {
    const workspace = workspaceOver(root);
    const capture = (await pinCaptureBaseline({ status, executionId: EXECUTION_ID, workspace, fileReview: FILE_REVIEW, artifactStorage: undefined }))!;
    const pending = await captureCandidate({ status, executionId: EXECUTION_ID, workspace, fileReview: FILE_REVIEW, artifactStorage: undefined, capture, globalBypass: false });
    expect(pending).toBe(false);
    expect(status.fileReviewEventStream?.events.map((e) => e.payload.case)).toEqual(["baselineCaptured"]);
  });

  it("scopes the stamp to this turn: a seeded prior-turn row keeps its change set, a sub-agent row created this turn takes the parent's", async () => {
    // The seed a reinvocation carries: a prior turn's flowed row and a prior sub-agent row.
    status.messages.push(messageWith(row("tc-prior", "write_file", ToolCallStatus.TOOL_CALL_COMPLETED, { fileChangeSetId: `${EXECUTION_ID}:0` })));
    status.subAgentExecutions.push(
      create(SubAgentExecutionSchema, { id: "sa-prior", name: "editor", messages: [messageWith(row("sa-tc-prior", "write_file", ToolCallStatus.TOOL_CALL_COMPLETED))] }),
    );
    const workspace = workspaceOver(root, 1);
    const capture = (await pinCaptureBaseline({ status, executionId: EXECUTION_ID, workspace, fileReview: FILE_REVIEW, artifactStorage: undefined }))!;

    writeFileSync(join(root, "keep.md"), "kept and changed\n");
    status.subAgentExecutions[0]!.messages.push(messageWith(row("sa-tc-new", "write_file", ToolCallStatus.TOOL_CALL_COMPLETED)));

    await captureCandidate({ status, executionId: EXECUTION_ID, workspace, fileReview: FILE_REVIEW, artifactStorage: undefined, capture, globalBypass: false });

    expect(status.messages[0]!.toolCalls[0]!.fileChangeSetId, "the prior turn's row is untouched").toBe(`${EXECUTION_ID}:0`);
    const sub = status.subAgentExecutions[0]!.messages.flatMap((m) => m.toolCalls);
    expect(sub.find((tc) => tc.id === "sa-tc-prior")!.fileChangeSetId, "the prior sub-agent row is untouched").toBe("");
    expect(sub.find((tc) => tc.id === "sa-tc-new")!.fileChangeSetId, "this turn's sub-agent row takes the parent set").toBe(`${EXECUTION_ID}:1`);
  });
});

describe("deriveCommandProvenance — one rule for both engines (F-M4-P3)", () => {
  const seededShell = (status: ToolCallStatus, approvalAction: ApprovalAction) =>
    row("tc-shell", "shell", status, { approvalAction, args: { command: "make generate" } });

  it("qualifies the approved command that executed ON ITS SEEDED ROW — the shape a positional scope missed", () => {
    // Turn 1 left the gate row WAITING at message 0; the reinvocation
    // reconciled the re-attempt onto it: same id, same position, COMPLETED,
    // the server's APPROVE preserved. It had NOT settled before this turn.
    const status = create(AgentExecutionStatusSchema, {
      messages: [
        messageWith(seededShell(ToolCallStatus.TOOL_CALL_COMPLETED, ApprovalAction.APPROVE)),
        create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "Generated." }),
      ],
    });
    const provenance = deriveCommandProvenance(status, { priorSettledToolCallIds: new Set(), priorSubAgentToolCallIds: new Set() }, false);
    expect(provenance?.consentToolCallIds).toEqual(["tc-shell"]);
    expect(provenance?.authorizedByAutoApproveAll).toBe(false);
  });

  it("the gate turn itself does not qualify: the proposed command is WAITING, not executed", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [messageWith(seededShell(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, ApprovalAction.UNSPECIFIED))],
    });
    expect(deriveCommandProvenance(status, { priorSettledToolCallIds: new Set(), priorSubAgentToolCallIds: new Set() }, false)).toBeUndefined();
  });

  it("a command settled before this turn is prior history and cannot qualify or disqualify it", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [
        messageWith(seededShell(ToolCallStatus.TOOL_CALL_COMPLETED, ApprovalAction.APPROVE)),
        messageWith(row("tc-read", "read_file", ToolCallStatus.TOOL_CALL_COMPLETED)),
      ],
    });
    expect(
      deriveCommandProvenance(status, { priorSettledToolCallIds: new Set(["tc-shell"]), priorSubAgentToolCallIds: new Set() }, false),
      "no executed consented command THIS turn",
    ).toBeUndefined();
  });

  it("any sub-agent activity this turn fails closed (DD-28 D1)", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [messageWith(seededShell(ToolCallStatus.TOOL_CALL_COMPLETED, ApprovalAction.APPROVE))],
      subAgentExecutions: [create(SubAgentExecutionSchema, { id: "sa", messages: [messageWith(row("sa-tc", "write_file", ToolCallStatus.TOOL_CALL_COMPLETED))] })],
    });
    expect(deriveCommandProvenance(status, { priorSettledToolCallIds: new Set(), priorSubAgentToolCallIds: new Set() }, false)).toBeUndefined();
  });

  it("under the global bypass an executed unconsented command is attributed to auto_approve_all", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [messageWith(row("tc-shell", "shell", ToolCallStatus.TOOL_CALL_COMPLETED, { args: { command: "make" } }))],
    });
    const provenance = deriveCommandProvenance(status, { priorSettledToolCallIds: new Set(), priorSubAgentToolCallIds: new Set() }, true);
    expect(provenance?.authorizedByAutoApproveAll).toBe(true);
    expect(provenance?.consentToolCallIds).toEqual([]);
  });
});
