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
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
  ApprovalAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import {
  resetDenialLedger,
  readDenialLedger,
  denialLedgerPath,
  reconstructAdjudicatedApprovals,
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
      "/ws/.cursor/hooks/stigmer-approval-state.json",
      "/ws/.cursor/hooks/stigmer-denials.jsonl",
    );

    expect(script).toContain('LEDGER_FILE="/ws/.cursor/hooks/stigmer-denials.jsonl"');
    expect(script).toContain("record_denial()");
    // One definition + a call in the gated-built-in branch + a call in the MCP
    // branch = 3 occurrences.
    const occurrences = script.split("record_denial").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});
