/**
 * HITL (human-in-the-loop) resume infrastructure for ExecuteDeepAgent.
 *
 * On reinvocation after an approval signal, this module:
 * 1. Reads the persisted execution status from the database
 * 2. Queries the LangGraph checkpoint for pending interrupts
 * 3. Matches each interrupt's tool_call_id to the user's approval decision
 * 4. Builds a `Command(resume={...})` payload for LangGraph
 * 5. Reconciles tool call statuses in the StatusBuilder
 *
 * DB-driven resume: Approval decisions are read from the persisted
 * execution status (via `client.getExecution()`), NOT passed as Temporal
 * activity arguments. This matches the Go workflow contract.
 */

import { Command } from "@langchain/langgraph";
import type { AgentExecution, AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ApprovalPolicySource,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { POLICY_ENGINE_VERSION, unattendedSkipMessage } from "../../shared/approval-policy.js";

// APPROVE_ALL resumes the interrupted tool exactly like APPROVE. Its
// "auto-approve the rest of the run" effect is realized in setup.ts (the
// approval gate is disabled for the whole execution once any APPROVE_ALL
// decision exists), not here — this map only resolves the currently
// interrupted tool calls. REJECT resumes the gate too (the gate returns a
// denial ToolMessage that the model reads); it denies a single tool, it does
// NOT fail the run — see reconcileNonExecutingDecisions for the terminal status.
const ACTION_MAP: ReadonlyMap<ApprovalAction, string> = new Map([
  [ApprovalAction.APPROVE, "approve"],
  [ApprovalAction.APPROVE_ALL, "approve"],
  [ApprovalAction.SKIP, "skip"],
  [ApprovalAction.REJECT, "reject"],
]);

export interface ResumeResult {
  readonly graphInput: Command | Record<string, unknown>;
  readonly isResumeFromApproval: boolean;
}

export interface GraphStateSnapshot {
  readonly values: Record<string, unknown>;
  readonly tasks: readonly GraphInterrupt[];
}

export interface GraphInterrupt {
  readonly id: string;
  readonly interrupts?: readonly InterruptValue[];
}

export interface InterruptValue {
  /**
   * The interrupt's own id — the canonical key LangGraph matches a
   * `Command(resume={...})` map against. For a parent-level tool interrupt this
   * coincides with the owning task id, but for a *nested sub-agent* interrupt
   * the two differ: the sub-agent's interrupt surfaces under the parent task
   * that ran the `task` tool, and ONLY this id routes the resume value back into
   * the sub-agent's `interrupt()`. Keying by `task.id` silently skips sub-agent
   * approvals (verified empirically in subagent-approval-propagation.test.ts).
   */
  readonly id?: string;
  readonly value: Record<string, unknown>;
  readonly resumeValue?: unknown;
}

/**
 * Resolve the resume input for a reinvocation after approval.
 *
 * Returns a `Command(resume=...)` if there are pending interrupts with
 * matching approval decisions, or a fresh user message input if this is
 * not a resume scenario.
 *
 * The graph checkpoint snapshot is read once by the caller and passed in: the
 * same snapshot also decides whether status must be seeded from the persisted
 * transcript (see `index.ts`), and on the durable (http) saver an extra
 * `getState` is a network round-trip best avoided.
 */
export function resolveResumeInput(
  execution: AgentExecution,
  graphState: GraphStateSnapshot,
  userMessage: string,
): ResumeResult {
  const pendingInterrupts = extractPendingInterrupts(graphState);
  if (pendingInterrupts.length === 0) {
    return {
      graphInput: { messages: [{ role: "user", content: userMessage }] },
      isResumeFromApproval: false,
    };
  }

  const decisions = extractApprovalDecisions(execution);
  if (decisions.size === 0) {
    return {
      graphInput: { messages: [{ role: "user", content: userMessage }] },
      isResumeFromApproval: false,
    };
  }

  const resumeDict: Record<string, { action: string; comment?: string }> = {};

  for (const intr of pendingInterrupts) {
    const toolCallId = intr.toolCallId;
    const decision = decisions.get(toolCallId);
    if (!decision) continue;

    const actionStr = ACTION_MAP.get(decision.action);
    if (!actionStr) continue;

    resumeDict[intr.interruptId] = {
      action: actionStr,
      ...(decision.comment ? { comment: decision.comment } : {}),
    };
  }

  if (Object.keys(resumeDict).length === 0) {
    return {
      graphInput: { messages: [{ role: "user", content: userMessage }] },
      isResumeFromApproval: false,
    };
  }

  console.log(
    `[hitl] Building resume for ${Object.keys(resumeDict).length} interrupt(s)`,
  );

  return {
    graphInput: new Command({ resume: resumeDict }),
    isResumeFromApproval: true,
  };
}

interface PendingInterrupt {
  readonly interruptId: string;
  readonly toolCallId: string;
}

function extractPendingInterrupts(state: GraphStateSnapshot): PendingInterrupt[] {
  const result: PendingInterrupt[] = [];

  for (const task of state.tasks) {
    if (!task.interrupts) continue;
    for (const intr of task.interrupts) {
      if (intr.resumeValue !== undefined) continue;

      const value = intr.value;
      if (typeof value === "object" && value !== null) {
        const toolCallId = (value as Record<string, unknown>).tool_call_id;
        if (typeof toolCallId === "string" && toolCallId) {
          // Key on the interrupt's own id (falling back to task.id for the
          // parent-level case where they coincide). This is what makes a
          // sub-agent approval resume into the nested interrupt rather than
          // being dropped — see InterruptValue.id.
          result.push({ interruptId: intr.id ?? task.id, toolCallId });
        }
      }
    }
  }

  return result;
}

interface ApprovalDecisionEntry {
  readonly action: ApprovalAction;
  readonly comment: string;
}

function extractApprovalDecisions(
  execution: AgentExecution,
): Map<string, ApprovalDecisionEntry> {
  const decisions = new Map<string, ApprovalDecisionEntry>();
  const status = execution.status;
  if (!status) return decisions;

  for (const message of status.messages) {
    for (const tc of message.toolCalls) {
      if (
        tc.approvalAction !== ApprovalAction.UNSPECIFIED &&
        tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
      ) {
        decisions.set(tc.id, {
          action: tc.approvalAction,
          comment: "",
        });
      }
    }
  }

  return decisions;
}

/**
 * Terminalize tool calls whose approval decision is non-executing — SKIP or
 * REJECT — so a denied or skipped call is never left stuck at WAITING_APPROVAL.
 *
 * This is the single, authoritative, checkpointer-independent reconciliation of
 * the two decisions that never run the tool: their outcome is fully determined
 * by the recorded decision (ToolCall.approval_action), not by any graph event.
 * APPROVE / APPROVE_ALL are intentionally NOT handled here — the tool actually
 * executes, and real tool events (v3 tool_started → tool_finished) terminalize
 * it in place.
 *
 * Why a decision-derived reconciler rather than the resumed stream: on the
 * durable path (sqlite local / http cloud) the gate returns a denial/skip
 * ToolMessage WITHOUT an on_tool_start/on_tool_end pair, and on the memory path
 * the graph replays without ever re-driving the gate — so in both cases the
 * seeded WAITING_APPROVAL row is never flipped by the stream and would persist
 * on a COMPLETED execution. Folding the recorded decision into a terminal status
 * makes every checkpointer backend behave identically by construction.
 *
 * REJECT and SKIP share TOOL_CALL_SKIPPED as the terminal status (the tool did
 * not run); they stay distinguishable by ToolCall.approval_action and by the
 * append-only approval-event stream (REJECTED vs SKIPPED). Idempotent: a row
 * already resolved carries the same decision and re-resolves identically.
 */
export function reconcileNonExecutingDecisions(status: AgentExecutionStatus): void {
  const apply = (messages: readonly AgentMessage[]): void => {
    for (const msg of messages) {
      for (const tc of msg.toolCalls) {
        if (tc.approvalAction === ApprovalAction.SKIP) {
          tc.status = ToolCallStatus.TOOL_CALL_SKIPPED;
        } else if (tc.approvalAction === ApprovalAction.REJECT) {
          tc.status = ToolCallStatus.TOOL_CALL_SKIPPED;
          if (!tc.error) tc.error = "Rejected by user";
        }
      }
    }
  };

  apply(status.messages);
  for (const subAgent of status.subAgentExecutions) {
    apply(subAgent.messages);
  }
}

/**
 * Terminalize every tool call the approval gate auto-skipped under UNATTENDED
 * approval mode — the sibling of {@link reconcileNonExecutingDecisions} for
 * skips that have no human decision behind them.
 *
 * The gate (the single writer of the registry) records each auto-skipped
 * tool-call id at the moment it returns the skip ToolMessage; this reconciler
 * (the single writer of the terminal row) folds each id into:
 * - `status = TOOL_CALL_SKIPPED` — the tool did not run, whatever transient
 *   status the stream left behind (COMPLETED from a tool_finished that carried
 *   the skip message, or RUNNING when no tool events fired);
 * - `approval_policy_source = UNATTENDED_SKIP` — the resolution layer,
 *   overriding the gating-layer source stamped at tool-start (the
 *   AUTO_APPROVE_ALL precedent: layer-4 resolutions own the resolved call);
 * - a result backfilled from {@link unattendedSkipMessage} when the stream
 *   delivered none, so the transcript row is never blank.
 *
 * `approval_action` / `approved_by` are deliberately NOT touched — those are
 * server-owned fields recording HUMAN decisions only (DD-014 D-e). No
 * approval-request event exists for these calls, so the pending-approvals
 * projection stays empty by construction. Idempotent: re-running re-resolves
 * identically. Covers sub-agent transcripts because sub-agent gates inherit
 * the parent's registry instance.
 */
export function reconcileUnattendedSkips(
  status: AgentExecutionStatus,
  unattendedSkips: ReadonlySet<string> | undefined,
): void {
  if (!unattendedSkips || unattendedSkips.size === 0) return;

  const apply = (messages: readonly AgentMessage[]): void => {
    for (const msg of messages) {
      for (const tc of msg.toolCalls) {
        if (!unattendedSkips.has(tc.id)) continue;
        tc.status = ToolCallStatus.TOOL_CALL_SKIPPED;
        tc.approvalPolicySource = ApprovalPolicySource.UNATTENDED_SKIP;
        tc.policyEngineVersion = POLICY_ENGINE_VERSION;
        tc.isStreaming = false;
        if (!tc.result) tc.result = unattendedSkipMessage(tc.name);
      }
    }
  };

  apply(status.messages);
  for (const subAgent of status.subAgentExecutions) {
    apply(subAgent.messages);
  }
}
