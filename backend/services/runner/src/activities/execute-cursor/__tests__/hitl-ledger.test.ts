/**
 * Unit tests for the Cursor-harness HITL denial-ledger flow.
 *
 * These cover the architecture the platform converges on: the preToolUse hook
 * records denials to a ledger, the runner marks the gated tool calls
 * WAITING_APPROVAL, and the backend projects pending_approvals from that
 * tool-call status. The tests are deterministic and need no Cursor API key.
 *
 * Specifically they pin:
 * - the denial ledger reset/read contract (per-turn freshness, tolerant parse)
 * - token-correlated overlay of WAITING_APPROVAL onto streamed tool calls,
 *   INCLUDING the regression where a denied tool was reported as "completed"
 *   (the green-checkmark bug) — it must become WAITING_APPROVAL, not success
 * - synthesis of a tool call when a denial produced no stream event
 * - reconstruction of adjudicated approvals from tool calls on reinvocation
 *   (pending_approvals is empty by then because the backend cleared it)
 * - the generated hook script wiring (records denials in both deny branches)
 */

import { describe, it, expect, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentMessageSchema,
  ToolCallSchema,
  FileChangeSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
  ApprovalAction,
  FileChangeType,
  FileChangeCaptureLevel,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import {
  resetDenialLedger,
  readDenialLedger,
  denialLedgerPath,
  reconstructAdjudicatedApprovals,
  buildApprovalGrants,
  grantToken,
} from "../approval-state.js";
import { reconcileDeniedToolCalls } from "../message-translator.js";
import { generateHookScript } from "../hook-script.js";
import type { MergedToolPolicy } from "../approval-policy.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "hitl-ledger-"));
  tempDirs.push(dir);
  return dir;
}

// Stream tool calls use the lowercase SDK taxonomy (edit/shell/delete); the
// denial ledger uses the hook taxonomy (Write/Shell/Delete) + a canonical
// category+salient token. The two correlate via approvalCategory — that cross-
// taxonomy match is exactly what these tests pin.
function toolCall(overrides: Partial<ToolCall>): ToolCall {
  return create(ToolCallSchema, {
    id: "call-1",
    name: "edit",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    ...overrides,
  });
}

function aiMessageWith(toolCalls: ToolCall[]): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "",
    toolCalls,
  });
}

describe("denial ledger reset/read", () => {
  it("reset creates an empty ledger that reads as no denials", async () => {
    const ws = makeWorkspace();
    const path = await resetDenialLedger(ws);
    expect(path).toBe(denialLedgerPath(ws));
    expect(await readDenialLedger(ws)).toEqual([]);
  });

  it("returns no denials when the ledger file does not exist", async () => {
    const ws = makeWorkspace();
    expect(await readDenialLedger(ws)).toEqual([]);
  });

  it("parses appended JSONL denials and tolerates blank/partial lines", async () => {
    const ws = makeWorkspace();
    await resetDenialLedger(ws);
    const writeToken = grantToken("write", "gated.txt");
    const shellToken = grantToken("shell", "rm -rf build");
    // Simulate the hook appending records, including a trailing partial line.
    await writeFile(
      denialLedgerPath(ws),
      `{"toolName":"Write","token":"${writeToken}"}\n` +
        `\n` +
        `{"toolName":"Shell","token":"${shellToken}"}\n` +
        `{"toolName":"Partial","tok`,
      "utf-8",
    );

    const entries = await readDenialLedger(ws);
    expect(entries).toEqual([
      { toolName: "Write", token: writeToken },
      { toolName: "Shell", token: shellToken },
    ]);
  });
});

describe("reconcileDeniedToolCalls", () => {
  it("overlays WAITING_APPROVAL onto the REAL denied tool reported as completed (the green-check bug)", () => {
    // Stream reports the file mutation as `edit` (RUNNING/COMPLETED); the hook
    // denied it as `Write`. The category+salient token bridges the two so the
    // overlay lands on this exact streamed tool call — no synthesized placeholder.
    const tc = toolCall({
      id: "c1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      completedAt: "2026-06-07T00:00:00Z",
      result: "wrote file",
      args: { path: "gated.txt" },
      argsPreview: JSON.stringify({ path: "gated.txt" }),
    });
    const messages = [aiMessageWith([tc])];

    const reconciled = reconcileDeniedToolCalls(messages, [
      { toolName: "Write", token: grantToken("write", "gated.txt") },
    ]);

    expect(reconciled).toHaveLength(1);
    // The overlay marked the REAL streamed tool call — no synthesized placeholder
    // and no orphan was appended.
    expect(reconciled[0]).toBe(tc);
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(tc.requiresApproval).toBe(true);
    expect(tc.approvalMessage).toContain("gated.txt");
    expect(tc.approvalRequestedAt).not.toBe("");
    // The tool never actually ran — terminal/result fields must be cleared so the
    // UI does not render it as a completed success.
    expect(tc.completedAt).toBe("");
    expect(tc.result).toBe("");
    expect(tc.error).toBe("");
  });

  it("resolves the MCP policy message for a denied MCP tool", () => {
    const tc = toolCall({
      id: "c1",
      name: "apply_x",
      mcpServerSlug: "planton",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
    });
    const messages = [aiMessageWith([tc])];
    const policies = new Map<string, MergedToolPolicy>([
      ["planton/apply_x", {
        toolName: "apply_x",
        mcpServerSlug: "planton",
        requiresApproval: true,
        approvalMessage: "Apply infrastructure change",
      }],
    ]);

    // MCP tools are keyed name-only (their name is consistent across layers).
    reconcileDeniedToolCalls(messages, [
      { toolName: "apply_x", token: grantToken("apply_x", "") },
    ], policies);

    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(tc.approvalMessage).toBe("Apply infrastructure change");
  });

  it("leaves non-denied tool calls untouched while overlaying the denied one", () => {
    const denied = toolCall({
      id: "c1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: "gated.txt" },
    });
    const allowed = toolCall({
      id: "c2",
      name: "read",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: "readme.md" },
    });
    const messages = [aiMessageWith([denied, allowed])];

    const reconciled = reconcileDeniedToolCalls(messages, [
      { toolName: "Write", token: grantToken("write", "gated.txt") },
    ]);

    // Only the denied call is gated; the read-only call keeps its status and no
    // spurious approval is synthesized (the ledger token matched a real call).
    expect(reconciled).toHaveLength(1);
    expect(denied.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(allowed.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(messages[0].toolCalls).toHaveLength(2);
  });

  it("collapses repeated denials of the same resource to a single approval", () => {
    const first = toolCall({ id: "c1", name: "edit", args: { path: "gated.txt" } });
    const second = toolCall({ id: "c2", name: "edit", args: { path: "gated.txt" } });
    const messages = [aiMessageWith([first, second])];

    const reconciled = reconcileDeniedToolCalls(messages, [
      { toolName: "Write", token: grantToken("write", "gated.txt") },
    ]);

    // One approval anchor (so the backend gate resolves cleanly on one decision).
    expect(reconciled).toHaveLength(1);
    expect(first.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(second.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("synthesizes a WAITING_APPROVAL tool call when a denial produced no stream event", () => {
    const messages = [aiMessageWith([])];

    const reconciled = reconcileDeniedToolCalls(messages, [
      { toolName: "Shell", token: grantToken("shell", "rm -rf build") },
    ]);

    expect(reconciled).toHaveLength(1);
    const synthesized = messages[0].toolCalls[0];
    expect(synthesized.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(synthesized.requiresApproval).toBe(true);
    // The synthesized fallback shows the hook's raw tool name for display...
    expect(synthesized.name).toBe("Shell");
    expect(synthesized.approvalMessage).toContain("rm -rf build");
    // ...and carries the salient so the grant rebuilt from it keys on the same
    // resource the hook will see on the re-attempt.
    expect(synthesized.argsPreview).toContain("rm -rf build");
  });

  it("is a no-op when the ledger is empty", () => {
    const tc = toolCall({ id: "c1", status: ToolCallStatus.TOOL_CALL_COMPLETED });
    const messages = [aiMessageWith([tc])];
    expect(reconcileDeniedToolCalls(messages, [])).toEqual([]);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });
});

// The approval gate must show a real diff, not a bare args preview. A denied
// edit is gated before its hunk ever streams, so the reconcile step synthesizes
// one from the proposed strings already on the gated tool call. These pin that
// the diff lands only where it should and never perturbs the denial identity.
describe("reconcileDeniedToolCalls — approval-gate diff (Phase D)", () => {
  const editArgs = { path: "src/app.ts", old_string: "alpha\nbeta", new_string: "alpha\ngamma" };
  const writeToken = grantToken("write", "src/app.ts");

  function deniedEdit(): ToolCall {
    return toolCall({
      id: "c1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: editArgs,
      argsPreview: JSON.stringify(editArgs),
    });
  }

  it("attaches a synthesized HUNK_ONLY MODIFY to a denied edit whose hunk never arrived", () => {
    const tc = deniedEdit();
    const messages = [aiMessageWith([tc])];

    reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: writeToken }],
      undefined,
      "/root",
    );

    expect(tc.fileChanges).toHaveLength(1);
    const fc = tc.fileChanges[0];
    expect(fc.captureLevel).toBe(FileChangeCaptureLevel.HUNK_ONLY);
    expect(fc.changeType).toBe(FileChangeType.MODIFY);
    expect(fc.path).toBe("src/app.ts");
    expect(fc.absolutePath).toBe("/root/src/app.ts");
    expect(fc.linesRemoved).toBe(2);
    expect(fc.linesAdded).toBe(2);
    expect(fc.unifiedDiff).toContain("-beta");
    expect(fc.unifiedDiff).toContain("+gamma");
    // A HUNK_ONLY change carries no whole-file bodies (the whole-file before is
    // the separately filed Cursor follow-up).
    expect(fc.before).toBeUndefined();
    expect(fc.after).toBeUndefined();
  });

  it("never clobbers a fileChange already present on the denied call", () => {
    const existing = create(FileChangeSchema, {
      path: "src/app.ts",
      changeType: FileChangeType.CREATE,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    });
    const tc = deniedEdit();
    tc.fileChanges = [existing];
    const messages = [aiMessageWith([tc])];

    reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: writeToken }],
      undefined,
      "/root",
    );

    expect(tc.fileChanges).toHaveLength(1);
    expect(tc.fileChanges[0]).toBe(existing);
  });

  it("adds no diff for a denied write (whole-file is captured on the stream path, not here)", () => {
    const tc = toolCall({
      id: "c1",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: "src/new.ts", contents: "export const x = 1;\n" },
      argsPreview: JSON.stringify({ path: "src/new.ts" }),
    });
    const messages = [aiMessageWith([tc])];

    reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: grantToken("write", "src/new.ts") }],
      undefined,
      "/root",
    );

    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(tc.fileChanges).toHaveLength(0);
  });

  it("adds no diff for a non-file denial (shell)", () => {
    const tc = toolCall({
      id: "c1",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { command: "rm -rf build" },
      argsPreview: JSON.stringify({ command: "rm -rf build" }),
    });
    const messages = [aiMessageWith([tc])];

    reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Shell", token: grantToken("shell", "rm -rf build") }],
      undefined,
      "/root",
    );

    expect(tc.fileChanges).toHaveLength(0);
  });

  it("adds no diff for an edit denial missing new_string", () => {
    const tc = toolCall({
      id: "c1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: "src/app.ts", old_string: "alpha" },
      argsPreview: JSON.stringify({ path: "src/app.ts", old_string: "alpha" }),
    });
    const messages = [aiMessageWith([tc])];

    reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: writeToken }],
      undefined,
      "/root",
    );

    expect(tc.fileChanges).toHaveLength(0);
  });

  it("adds no diff to a synthesized placeholder (no proposed content)", () => {
    const messages = [aiMessageWith([])];

    reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: writeToken }],
      undefined,
      "/root",
    );

    expect(messages[0].toolCalls[0].fileChanges).toHaveLength(0);
  });

  it("leaves the denial identity token byte-identical, so the reinvocation grant still matches", () => {
    const tc = deniedEdit();
    const messages = [aiMessageWith([tc])];

    reconcileDeniedToolCalls(
      messages,
      [{ toolName: "Write", token: writeToken }],
      undefined,
      "/root",
    );

    // Capturing the diff must not touch name/args, the inputs to tool identity.
    // Simulate the user's approval, then rebuild the grant the way a reinvocation
    // does and confirm its token equals the original ledger denial token.
    tc.approvalAction = ApprovalAction.APPROVE;
    const { pendingApprovals, decisions } = reconstructAdjudicatedApprovals(messages);
    const grants = buildApprovalGrants(pendingApprovals, decisions);

    expect(grants).toHaveLength(1);
    expect(grantToken(grants[0].key, grants[0].salient)).toBe(writeToken);
  });
});

describe("reconstructAdjudicatedApprovals", () => {
  it("reads decisions and rebuilds pending approvals from adjudicated tool calls", () => {
    const approved = toolCall({
      id: "c1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.APPROVE,
      approvalMessage: "Write file: gated.txt",
      argsPreview: JSON.stringify({ path: "gated.txt" }),
    });
    const undecided = toolCall({
      id: "c2",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.UNSPECIFIED,
    });
    const unrelated = toolCall({
      id: "c3",
      name: "read",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      approvalAction: ApprovalAction.APPROVE,
    });
    const messages = [aiMessageWith([approved, undecided, unrelated])];

    const { pendingApprovals, decisions } = reconstructAdjudicatedApprovals(messages);

    expect([...decisions.entries()]).toEqual([["c1", ApprovalAction.APPROVE]]);
    expect(pendingApprovals).toHaveLength(1);
    expect(pendingApprovals[0].toolCallId).toBe("c1");
    expect(pendingApprovals[0].toolName).toBe("edit");
    expect(pendingApprovals[0].argsPreview).toBe(JSON.stringify({ path: "gated.txt" }));
  });

  it("returns nothing when no tool call carries a decision", () => {
    const tc = toolCall({
      id: "c1",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.UNSPECIFIED,
    });
    const { pendingApprovals, decisions } = reconstructAdjudicatedApprovals([aiMessageWith([tc])]);
    expect(pendingApprovals).toEqual([]);
    expect(decisions.size).toBe(0);
  });
});

describe("generateHookScript ledger wiring", () => {
  it("wires the ledger path and records denials in both deny branches", () => {
    const script = generateHookScript(
      "/hitl/approval-state.json",
      "/hitl/denials.jsonl",
      process.pid,
    );

    expect(script).toContain('LEDGER_FILE="/hitl/denials.jsonl"');
    expect(script).toContain("record_denial()");
    // One definition + a call in the gated-built-in branch + a call in the MCP
    // branch = 3 occurrences.
    const occurrences = script.split("record_denial").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});
