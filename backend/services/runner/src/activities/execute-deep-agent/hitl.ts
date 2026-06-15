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
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

// APPROVE_ALL resumes the interrupted tool exactly like APPROVE. Its
// "auto-approve the rest of the run" effect is realized in setup.ts (the
// approval gate is disabled for the whole execution once any APPROVE_ALL
// decision exists), not here — this map only resolves the currently
// interrupted tool calls.
const ACTION_MAP: ReadonlyMap<ApprovalAction, string> = new Map([
  [ApprovalAction.APPROVE, "approve"],
  [ApprovalAction.APPROVE_ALL, "approve"],
  [ApprovalAction.SKIP, "skip"],
  [ApprovalAction.REJECT, "reject"],
]);

export interface ResumeResult {
  readonly graphInput: Command | Record<string, unknown>;
  readonly isResumeFromApproval: boolean;
  readonly hasRejection: boolean;
  readonly rejectionReason: string;
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
      hasRejection: false,
      rejectionReason: "",
    };
  }

  const decisions = extractApprovalDecisions(execution);
  if (decisions.size === 0) {
    return {
      graphInput: { messages: [{ role: "user", content: userMessage }] },
      isResumeFromApproval: false,
      hasRejection: false,
      rejectionReason: "",
    };
  }

  const resumeDict: Record<string, { action: string; comment?: string }> = {};
  let hasRejection = false;
  let rejectionReason = "";

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

    if (decision.action === ApprovalAction.REJECT) {
      hasRejection = true;
      rejectionReason = decision.comment || "Rejected by user";
    }
  }

  if (Object.keys(resumeDict).length === 0) {
    return {
      graphInput: { messages: [{ role: "user", content: userMessage }] },
      isResumeFromApproval: false,
      hasRejection: false,
      rejectionReason: "",
    };
  }

  console.log(
    `[hitl] Building resume for ${Object.keys(resumeDict).length} interrupt(s), ` +
    `rejection=${hasRejection}`,
  );

  return {
    graphInput: new Command({ resume: resumeDict }),
    isResumeFromApproval: true,
    hasRejection,
    rejectionReason,
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
          result.push({ interruptId: task.id, toolCallId });
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
 * Reconcile tool call statuses after resume decisions are applied.
 *
 * Updates the StatusBuilder's tool call entries to reflect the approval
 * outcomes: APPROVE → RUNNING, SKIP → SKIPPED, REJECT → FAILED.
 */
export function reconcileToolCallStatuses(
  toolCalls: ReadonlyMap<string, ToolCall>,
  decisions: ReadonlyMap<string, ApprovalDecisionEntry>,
): void {
  for (const [toolCallId, decision] of decisions) {
    const tc = toolCalls.get(toolCallId);
    if (!tc) continue;

    switch (decision.action) {
      case ApprovalAction.APPROVE:
      case ApprovalAction.APPROVE_ALL:
        tc.status = ToolCallStatus.TOOL_CALL_RUNNING;
        break;
      case ApprovalAction.SKIP:
        tc.status = ToolCallStatus.TOOL_CALL_SKIPPED;
        break;
      case ApprovalAction.REJECT:
        tc.status = ToolCallStatus.TOOL_CALL_FAILED;
        tc.error = `Rejected by user: ${decision.comment || "no reason given"}`;
        break;
    }
  }
}
