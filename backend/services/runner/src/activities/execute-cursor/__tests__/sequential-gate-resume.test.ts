/**
 * Cursor analog of execute-deep-agent/__tests__/sequential-gate-resume.test.ts:
 * two SEQUENTIAL approval gates across a resume, on the Cursor deny-and-reconcile
 * harness instead of the native in-process gate.
 *
 * The shared failure class both files guard: a resume that rebuilds its transcript
 * from empty drops gate A's already-committed tool-call id, the backend's
 * append-only-at-identity guard rejects the update, pending_approvals projects to
 * 0, and the WAITING_FOR_APPROVAL + pending=0 state makes the workflow watchdog
 * auto-resume — silently skipping (and looping on) gate B.
 *
 * The Cursor specifics this file pins, which the native one cannot:
 *  - the resume re-issues gate A with a BRAND-NEW call id (Cursor has no pause
 *    primitive; the model re-runs the approved tool), so the fix must reconcile
 *    the re-run onto gate A's committed id by canonical identity, not append a
 *    duplicate row;
 *  - "each tool gates exactly once": gate A, approved on turn 1, must come back
 *    COMPLETED on the resume (never WAITING_APPROVAL again), while gate B gates
 *    for the first time — and the REAL bash hook must ALLOW A's re-issue while
 *    DENYING B, the out-of-process half the native gate has no equivalent for.
 *
 * Exercises the MessageAccumulator + denial reconciliation (the unit that owns
 * the Cursor resume emitter) plus the generated hook, keeping the reproduction
 * hermetic and pinned to the exact code under change.
 */

import { describe, it, expect } from "vitest";
import { create, clone } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalAction,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";

import {
  MessageAccumulator,
  reconcileDeniedToolCalls,
  toolCallIdentityToken,
} from "../message-translator.js";
import {
  buildApprovalGrants,
  buildApprovalState,
  reconstructAdjudicatedApprovals,
} from "../approval-state.js";
import type { DeniedLedgerEntry } from "../approval-state.js";
import {
  setupCursorHookHarness,
  hasBash,
  hookWrite,
  hookShell,
} from "../__test-utils__/cursor-hook-harness.js";

const GATE_A_ID = "tool_edit_a";
const GATE_A_PATH = "/work/a.txt";
const GATE_B_ID = "tool_shell_b";
const GATE_B_CMD = "make build";

function builtInEvent(
  callId: string,
  name: string,
  status: "running" | "completed",
  args: Record<string, unknown>,
  result?: unknown,
): Extract<SDKMessage, { type: "tool_call" }> {
  return { type: "tool_call", agent_id: "agent-1", run_id: "r2", call_id: callId, name, status, args, result };
}

function assistantEvent(text: string): Extract<SDKMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    agent_id: "agent-1",
    run_id: "r2",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

/** Run-1 transcript: gate A (edit) committed and APPROVED by the user. */
function approvedGateA(): AgentMessage[] {
  return [
    create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "I'll write file A, then build.",
      timestamp: "2026-06-20T00:00:01.000Z",
      toolCalls: [
        create(ToolCallSchema, {
          id: GATE_A_ID,
          name: "edit",
          status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
          requiresApproval: true,
          approvalAction: ApprovalAction.APPROVE,
          argsPreview: JSON.stringify({ path: GATE_A_PATH, content: "A\n" }),
        }),
      ],
    }),
  ];
}

/**
 * Resume events: gate A is re-issued with a FRESH id and completes (the approved
 * tool finally runs), the agent advances and proposes gate B (shell), which is
 * gated — emitted running, then cut off by the first-denial stop.
 */
function resumeIntoGateB(): SDKMessage[] {
  return [
    assistantEvent("File A written. Now building."),
    builtInEvent(`${GATE_A_ID}_RESUME`, "edit", "running", { path: GATE_A_PATH, content: "A\n" }),
    builtInEvent(`${GATE_A_ID}_RESUME`, "edit", "completed", { path: GATE_A_PATH, content: "A\n" }, "wrote a.txt"),
    builtInEvent(`${GATE_B_ID}_RESUME`, "shell", "running", { command: GATE_B_CMD }),
  ];
}

function allToolCalls(messages: AgentMessage[]) {
  return messages.flatMap((m) => m.toolCalls);
}

/** Local mirror of the backend append-only-at-identity guard (see hitl-resume-history). */
function guardRejectionReason(existing: AgentMessage[], incoming: AgentMessage[]): string | undefined {
  if (incoming.length < existing.length) return "would shrink the message transcript";
  const incomingIds = new Set<string>();
  for (const m of incoming) for (const tc of m.toolCalls) if (tc.id) incomingIds.add(tc.id);
  for (const m of existing) {
    for (const tc of m.toolCalls) {
      if (tc.id && !incomingIds.has(tc.id)) return "would drop a previously-committed tool call";
    }
  }
  return undefined;
}

describe("Cursor sequential gates A->B across resume", () => {
  it("preserves gate A (completed) and surfaces gate B exactly once — a superset the guard accepts", async () => {
    const committed = approvedGateA();
    const seeded = committed.map((m) => clone(AgentMessageSchema, m));

    const acc = new MessageAccumulator(seeded, { seededSubAgents: [] });
    for (const event of resumeIntoGateB()) acc.processEvent(event);
    acc.finalize();

    // Gate B was denied this turn; its identity comes off the reconciled call.
    const bCall = allToolCalls(seeded).find((tc) => tc.name === "shell")!;
    const ledger: DeniedLedgerEntry[] = [
      { toolName: "shell", token: toolCallIdentityToken(bCall) },
    ];
    await reconcileDeniedToolCalls(seeded, ledger);

    const tools = allToolCalls(seeded);
    const byId = new Map(tools.map((tc) => [tc.id, tc]));

    // Superset: gate A's committed id survives the resume (no drop, no re-key).
    expect(byId.has(GATE_A_ID)).toBe(true);
    expect(tools.some((tc) => tc.id === `${GATE_A_ID}_RESUME`)).toBe(false);

    // Each gates exactly once: A is now COMPLETED (approved + run, never gated
    // again); B is WAITING_APPROVAL, and only once.
    expect(byId.get(GATE_A_ID)!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    const waiting = tools.filter((tc) => tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].name).toBe("shell");

    // No duplicate rows for either gate.
    expect(tools.filter((tc) => tc.name === "edit")).toHaveLength(1);
    expect(tools.filter((tc) => tc.name === "shell")).toHaveLength(1);

    // The decisive invariant: the resumed transcript is a strict superset, so the
    // backend guard accepts it and gate B's pending is actually persisted.
    expect(guardRejectionReason(committed, seeded)).toBeUndefined();
  });

  it("the hook ALLOWS gate A's re-issue and DENIES gate B (out-of-process closure)", () => {
    if (!hasBash) return;

    // Only gate A is approved going into the resume; its grant is what the hook
    // reads. Gate B has no grant yet (it gates for the first time this turn).
    const { pendingApprovals, decisions } = reconstructAdjudicatedApprovals(approvedGateA());
    const grants = buildApprovalGrants(pendingApprovals, decisions);
    const state = buildApprovalState(new Map(), false, new Set(), grants);

    const harness = setupCursorHookHarness({ grants: state.approvedGrants });
    expect(harness.decide(hookWrite(GATE_A_PATH)).permission).toBe("allow");
    expect(harness.decide(hookShell(GATE_B_CMD)).permission).toBe("deny");
  });
});
