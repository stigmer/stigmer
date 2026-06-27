/**
 * Regression test: resuming a Cursor execution after an approval must emit an
 * APPEND-ONLY transcript that the backend's append-only-at-identity guard
 * accepts.
 *
 * This is the precise, deterministic reproduction of the production stall traced
 * to `aex_01kvz3pw20j6t0hw80wpevnztb` (open-computer-use "send a Slack self-DM"):
 *
 *   1. The agent gated two MCP tools (list_apps, get_app_state); the user
 *      approved BOTH. The persisted run-1 transcript holds them as
 *      WAITING_APPROVAL / approval_action=APPROVE.
 *   2. On resume the Cursor SDK re-issues those approved tools with BRAND-NEW
 *      call ids and the agent advances to a third tool (click) which gets gated.
 *   3. Before the fix, the resume rebuilt the transcript from empty, so the new
 *      status carried only the fresh ids and DROPPED the two committed ids. The
 *      backend guard (nonTerminalTranscriptRegression / transcriptRegressionReason)
 *      rejects "would drop a previously-committed tool call", so the new `click`
 *      pending was never persisted, pending_approvals stayed 0, and the workflow
 *      watchdog failed the run ("approval propagation is broken").
 *
 * The fix (seed the transcript on resume + reconcile re-runs by canonical
 * identity in MessageAccumulator) makes the resume status a strict superset:
 * the committed ids survive, the re-runs reconcile in place, and the genuinely
 * new gated tool is appended. The guard then accepts it.
 *
 * The test asserts both directions against a local mirror of the Go guard
 * (nonTerminalTranscriptRegression): a from-empty rebuild is REJECTED (the bug),
 * a seeded rebuild is ACCEPTED (the fix).
 *
 * This exercises the MessageAccumulator + denial-reconciliation directly — the
 * unit that owns the resume emitter — rather than the full Temporal activity,
 * keeping the reproduction hermetic and pinned to the exact code under change.
 */

import { describe, it, expect } from "vitest";
import { create, clone } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type {
  AgentMessage,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalAction,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";
import {
  MessageAccumulator,
  reconcileDeniedToolCalls,
  clearProvisionalPostDenialNarration,
  buildToolCallProto,
} from "../message-translator.js";
import {
  grantToken,
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
  hookMcp,
} from "../__test-utils__/cursor-hook-harness.js";
import {
  SubAgentExecutionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { SubAgentStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

const MCP_SLUG = "open-computer-use";

// The two approved tools' ORIGINAL committed ids (as they appear in the
// persisted run-1 transcript). The resume re-issues them with the *_RESUME ids.
const LIST_APPS_ID = "tool_de9b3cd7";
const GET_STATE_ID = "tool_1c47c984";

const RUN1_AI_TEXT = "I'll inspect the open apps first.";
const RUN2_AI_TEXT = "Now I'll click the compose button.";
const RUN2_TRAILING_NARRATION = "Done — the message was sent.";

/** A Cursor MCP tool_call event (name="mcp", details nested in args). */
function mcpToolCallEvent(
  callId: string,
  toolName: string,
  status: "running" | "completed" | "error",
  runId: string,
  opts?: { result?: unknown; innerArgs?: Record<string, unknown> },
): Extract<SDKMessage, { type: "tool_call" }> {
  return {
    type: "tool_call",
    agent_id: "agent-1",
    run_id: runId,
    call_id: callId,
    name: "mcp",
    status,
    result: opts?.result,
    args: {
      providerIdentifier: MCP_SLUG,
      toolName,
      args: opts?.innerArgs ?? {},
    },
  };
}

function assistantEvent(
  runId: string,
  text: string,
): Extract<SDKMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    agent_id: "agent-1",
    run_id: runId,
    message: { role: "assistant" as const, content: [{ type: "text" as const, text }] },
  };
}

/**
 * The persisted run-1 transcript: an AI message bearing the two MCP tools the
 * user already approved (status WAITING_APPROVAL, approval_action APPROVE — the
 * exact shape the backend keeps for a decided-but-not-yet-resumed tool call).
 */
function persistedRunOneMessages(): AgentMessage[] {
  return [
    create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: RUN1_AI_TEXT,
      timestamp: "2026-06-24T00:00:01.000Z",
      toolCalls: [
        create(ToolCallSchema, {
          id: LIST_APPS_ID,
          name: "list_apps",
          mcpServerSlug: MCP_SLUG,
          status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
          requiresApproval: true,
          approvalAction: ApprovalAction.APPROVE,
        }),
        create(ToolCallSchema, {
          id: GET_STATE_ID,
          name: "get_app_state",
          mcpServerSlug: MCP_SLUG,
          status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
          requiresApproval: true,
          approvalAction: ApprovalAction.APPROVE,
        }),
      ],
    }),
  ];
}

/**
 * The events the SDK re-emits on resume: the two approved tools re-run with
 * FRESH ids and complete, the agent narrates and calls a new tool (click) which
 * is gated (emitted running, then cut off by the first-denial stop), followed by
 * trailing provisional narration.
 */
function resumeEvents(): SDKMessage[] {
  return [
    assistantEvent("r2", RUN2_AI_TEXT),
    mcpToolCallEvent(`${LIST_APPS_ID}_RESUME`, "list_apps", "running", "r2"),
    mcpToolCallEvent(`${LIST_APPS_ID}_RESUME`, "list_apps", "completed", "r2", {
      result: "Slack, Mail, Safari",
    }),
    mcpToolCallEvent(`${GET_STATE_ID}_RESUME`, "get_app_state", "running", "r2"),
    mcpToolCallEvent(`${GET_STATE_ID}_RESUME`, "get_app_state", "completed", "r2", {
      result: "Slack focused",
    }),
    // The genuinely-new gated tool: emitted running, never completes (the hook
    // denies it and the turn is cut off at the first denial).
    mcpToolCallEvent("tool_click_RESUME", "click", "running", "r2"),
    // Trailing provisional narration in a NEW turn (separate run id) — the kind
    // clearProvisionalPostDenialNarration must blank for the CURRENT turn only.
    assistantEvent("r3", RUN2_TRAILING_NARRATION),
  ];
}

/** The denial ledger after resume holds only the freshly-gated `click`. */
function clickDenialLedger(): DeniedLedgerEntry[] {
  return [{ toolName: "click", token: grantToken("click", "") }];
}

/**
 * Local mirror of the backend's nonTerminalTranscriptRegression (Go) /
 * transcriptRegressionReason (Java): for a non-terminal execution, an incoming
 * transcript must neither shrink nor drop a previously-committed tool-call id.
 * Returns the rejection reason, or undefined if the update would be accepted.
 */
function guardRejectionReason(
  existing: AgentMessage[],
  incoming: AgentMessage[],
): string | undefined {
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

function allToolCalls(messages: AgentMessage[]) {
  return messages.flatMap((m) => m.toolCalls);
}

describe("Cursor HITL resume — append-only transcript", () => {
  it("BUG (no seeding): a from-empty rebuild drops committed ids and the guard rejects it", () => {
    const committed = persistedRunOneMessages();

    // Pre-fix behavior: status.messages starts empty on resume, so the
    // accumulator can never reconcile onto the committed calls.
    const fromEmpty: AgentMessage[] = [];
    const acc = new MessageAccumulator(fromEmpty, { seededSubAgents: [] });
    for (const event of resumeEvents()) acc.processEvent(event);
    acc.finalize();

    // The committed ids are absent — exactly what trips the backend guard.
    const ids = new Set(allToolCalls(fromEmpty).map((tc) => tc.id));
    expect(ids.has(LIST_APPS_ID)).toBe(false);
    expect(ids.has(GET_STATE_ID)).toBe(false);

    expect(guardRejectionReason(committed, fromEmpty)).toBe(
      "would drop a previously-committed tool call",
    );
  });

  it("FIX (seeding + identity reconciliation): the resume is a strict superset the guard accepts", async () => {
    const committed = persistedRunOneMessages();

    // Post-fix behavior: index.ts seeds status.messages from the persisted
    // execution (cloned) before constructing the accumulator.
    const seeded = committed.map((m) => clone(AgentMessageSchema, m));
    const acc = new MessageAccumulator(seeded, { seededSubAgents: [] });
    for (const event of resumeEvents()) acc.processEvent(event);
    acc.finalize();

    // Post-stream denial overlay (the activity's Phase 12): only `click` is in
    // the ledger, so only it flips to WAITING_APPROVAL.
    const denied = await reconcileDeniedToolCalls(seeded, clickDenialLedger());
    const redacted = clearProvisionalPostDenialNarration(seeded, denied);

    const tools = allToolCalls(seeded);

    // 1. The committed ids are preserved (reconciled in place, not re-keyed).
    const byId = new Map(tools.map((tc) => [tc.id, tc]));
    expect(byId.has(LIST_APPS_ID)).toBe(true);
    expect(byId.has(GET_STATE_ID)).toBe(true);

    // 2. No duplicate rows: the fresh *_RESUME ids never produced new tool calls.
    expect(tools.filter((tc) => tc.name === "list_apps")).toHaveLength(1);
    expect(tools.filter((tc) => tc.name === "get_app_state")).toHaveLength(1);
    expect(tools.some((tc) => tc.id === `${LIST_APPS_ID}_RESUME`)).toBe(false);
    expect(tools.some((tc) => tc.id === `${GET_STATE_ID}_RESUME`)).toBe(false);

    // 3. The approved re-runs reconciled onto the seeded calls and completed.
    expect(byId.get(LIST_APPS_ID)!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(byId.get(LIST_APPS_ID)!.result).toContain("Slack");
    expect(byId.get(GET_STATE_ID)!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);

    // 4. The genuinely-new gated tool is appended and surfaced as pending.
    const click = tools.find((tc) => tc.name === "click");
    expect(click).toBeDefined();
    expect(click!.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);

    // 5. Provisional post-denial narration is redacted for the CURRENT turn only:
    //    the trailing "Done" message is blanked, while the seeded run-1 text and
    //    the gated turn's own narration are preserved.
    expect(redacted).toHaveLength(1);
    const allText = seeded.map((m) => m.content).join("\n");
    expect(allText).toContain(RUN1_AI_TEXT);
    expect(allText).toContain(RUN2_AI_TEXT);
    expect(allText).not.toContain(RUN2_TRAILING_NARRATION);

    // 6. The decisive invariant: the seeded resume passes the backend guard.
    expect(guardRejectionReason(committed, seeded)).toBeUndefined();
  });

  it("FIX: a sub-agent's gated tool also survives resume (seeded sub-agent rows are retained)", () => {
    // Sub-agent parity: seedCursorTranscriptFromExecution hands seeded sub-agent
    // executions to the accumulator so they are not dropped on the rebuilt
    // status (the accumulator owns status.subAgentExecutions).
    const seededSub = create(SubAgentExecutionSchema, {
      id: "sub_1",
      name: "researcher",
      status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
    });

    const acc = new MessageAccumulator([], { seededSubAgents: [seededSub] });
    acc.finalize();

    expect(acc.subAgentExecutions.some((s) => s.id === "sub_1")).toBe(true);
  });

  it("FIX: the approved tools are ALLOWED by the hook on resume — not re-denied (the loop's source)", () => {
    // The transcript-superset fix keeps the run off the watchdog, but the OTHER
    // half of "no loop" is that the approved tools' grants actually let the hook
    // ALLOW the re-issued calls. Drive the real bash hook with the grants the
    // resume mints from the persisted run-1 decisions and prove the two approved
    // MCP tools pass while the genuinely-new `click` is still gated.
    if (!hasBash) return; // hook tests require bash; mirrored skip of the d() guard.

    const { pendingApprovals, decisions } = reconstructAdjudicatedApprovals(persistedRunOneMessages());
    const grants = buildApprovalGrants(pendingApprovals, decisions);
    const state = buildApprovalState(new Map(), false, new Set(), grants);

    const harness = setupCursorHookHarness({
      grants: state.approvedGrants,
      mcpPolicies: {
        list_apps: { requiresApproval: true },
        get_app_state: { requiresApproval: true },
        click: { requiresApproval: true },
      },
    });

    // Both approved tools are allowed on the resumed turn (fresh ids, same name).
    expect(harness.decide(hookMcp("list_apps")).permission).toBe("allow");
    expect(harness.decide(hookMcp("get_app_state")).permission).toBe("allow");
    // The brand-new gated tool is NOT covered by any grant -> still denied.
    expect(harness.decide(hookMcp("click")).permission).toBe("deny");
  });
});

/**
 * The exact "two co-pending approvals -> resume -> both allowed -> COMPLETE"
 * scenario, on the built-in edit+shell path (the file-diff case from the bug
 * report). This is the success terminus the production loop never reached: when
 * every gated tool was approved and the agent has nothing new to gate, the resume
 * must re-run both approved tools, complete, and leave ZERO tools waiting — a
 * legitimate zero-pending because the run is TERMINAL, not because the guard
 * dropped a pending (the watchdog's failure mode). Asserting "no WAITING_APPROVAL
 * survives a clean completion" is what distinguishes the two zero-pending states.
 */
describe("Cursor HITL resume — two approvals then clean completion (no loop)", () => {
  const NOTES_PATH = "/work/notes.md";
  const WRITE_ID = "tool_write_notes";
  const SHELL_CMD = "cat >> notes.md << 'EOF'\nappended\nEOF";
  const SHELL_ID = "tool_append_notes";

  /** Persisted run-1: an edit and a shell, both gated, both APPROVED. */
  function committedBuiltInApprovals(): AgentMessage[] {
    const edit = create(ToolCallSchema, {
      id: WRITE_ID,
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      requiresApproval: true,
      approvalAction: ApprovalAction.APPROVE,
      argsPreview: JSON.stringify({ path: NOTES_PATH, content: "# Notes" }),
    });
    const shell = create(ToolCallSchema, {
      id: SHELL_ID,
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      requiresApproval: true,
      approvalAction: ApprovalAction.APPROVE,
      argsPreview: JSON.stringify({ command: SHELL_CMD }),
    });
    return [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: "I'll create and append to the notes file.",
        timestamp: "2026-06-24T00:00:01.000Z",
        toolCalls: [edit, shell],
      }),
    ];
  }

  /** Resume re-issues both approved tools (fresh ids) and they COMPLETE; no new gate. */
  function builtInResumeEvents(): SDKMessage[] {
    const editArgs = { path: NOTES_PATH, content: "# Notes" };
    const shellArgs = { command: SHELL_CMD };
    return [
      assistantEvent("r2", "Applying the approved file changes."),
      {
        type: "tool_call", agent_id: "agent-1", run_id: "r2",
        call_id: `${WRITE_ID}_RESUME`, name: "edit", status: "running", args: editArgs,
      } as SDKMessage,
      {
        type: "tool_call", agent_id: "agent-1", run_id: "r2",
        call_id: `${WRITE_ID}_RESUME`, name: "edit", status: "completed",
        result: "wrote notes.md", args: editArgs,
      } as SDKMessage,
      {
        type: "tool_call", agent_id: "agent-1", run_id: "r2",
        call_id: `${SHELL_ID}_RESUME`, name: "shell", status: "running", args: shellArgs,
      } as SDKMessage,
      {
        type: "tool_call", agent_id: "agent-1", run_id: "r2",
        call_id: `${SHELL_ID}_RESUME`, name: "shell", status: "completed",
        result: "appended", args: shellArgs,
      } as SDKMessage,
      assistantEvent("r2", "Done — the notes file is ready."),
    ];
  }

  it("re-runs both approved tools in place and completes with ZERO tools waiting", async () => {
    const committed = committedBuiltInApprovals();
    const seeded = committed.map((m) => clone(AgentMessageSchema, m));

    const acc = new MessageAccumulator(seeded, { seededSubAgents: [] });
    for (const event of builtInResumeEvents()) acc.processEvent(event);
    acc.finalize();

    // The hook allowed both (no denials this turn), so the overlay adds nothing.
    const denied = await reconcileDeniedToolCalls(seeded, []);
    expect(denied).toHaveLength(0);

    const tools = allToolCalls(seeded);
    const byId = new Map(tools.map((tc) => [tc.id, tc]));

    // In-place reconcile: the committed ids survive and carry the completion;
    // the fresh *_RESUME ids never spawned duplicate rows.
    expect(tools.filter((tc) => tc.name === "edit")).toHaveLength(1);
    expect(tools.filter((tc) => tc.name === "shell")).toHaveLength(1);
    expect(byId.get(WRITE_ID)!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(byId.get(SHELL_ID)!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);

    // The decisive no-loop property: nothing is left WAITING_APPROVAL, so the
    // run can reach a terminal status. Zero pending here is CORRECT (the run is
    // done), unlike the watchdog's zero-pending-while-WAITING failure mode.
    expect(tools.some((tc) => tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL)).toBe(false);

    // And the transcript is still a strict superset the backend guard accepts.
    expect(guardRejectionReason(committed, seeded)).toBeUndefined();
  });

  it("the built-in grants actually let the hook allow both re-issues (full closure)", () => {
    if (!hasBash) return;

    const { pendingApprovals, decisions } = reconstructAdjudicatedApprovals(committedBuiltInApprovals());
    const grants = buildApprovalGrants(pendingApprovals, decisions);
    const state = buildApprovalState(new Map(), false, new Set(), grants);

    const harness = setupCursorHookHarness({ grants: state.approvedGrants });
    // Exactly the two approved resources are allowed on resume...
    expect(harness.decide(hookWrite(NOTES_PATH)).permission).toBe("allow");
    expect(harness.decide(hookShell(SHELL_CMD)).permission).toBe("allow");
    // ...and an unrelated write/shell of the same category is still gated.
    expect(harness.decide(hookWrite("/work/secret.env")).permission).toBe("deny");
    expect(harness.decide(hookShell("rm -rf /")).permission).toBe("deny");
  });
});
