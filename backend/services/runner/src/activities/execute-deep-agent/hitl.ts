/**
 * HITL (human-in-the-loop) resume infrastructure for the native deep-agent
 * harness — the LangGraph side of an approval round trip.
 *
 * The runtime reads the user's decisions off the persisted rows
 * (`harness/approval-decisions.ts` `approvalDecisionsOf`, on `TurnInput`)
 * and settles the rows that never run (SKIP, REJECT) after the turn; what is
 * this harness's is how those decisions reach the ENGINE: the graph
 * checkpoint's un-resumed interrupts, keyed by the interrupt's own id, become
 * a `Command(resume)` map ({@link resolveResumeInput}), and after a stream the
 * interrupts still pending become WAITING_APPROVAL rows
 * ({@link detectPendingInterrupts}). {@link reconcileUnattendedSkips} is the
 * one settlement that stays here because its evidence — the gate's registry
 * of auto-skipped call ids — exists only inside this harness.
 *
 * Until #1096 this module also read the decisions from the execution itself
 * and carried the SKIP/REJECT settlement; both are the runtime's now, one
 * copy for every harness.
 */

import { Command } from "@langchain/langgraph";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ApprovalPolicySource,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { POLICY_ENGINE_VERSION, unattendedSkipMessage, type PolicySource } from "../../shared/approval-policy.js";

/**
 * The gate's resume vocabulary for each decision. APPROVE_ALL resumes the
 * interrupted tool exactly like APPROVE; its "auto-approve the rest of the
 * run" effect is a scoped lease the gate config carries, not this map's.
 * REJECT resumes the gate too (the gate returns a denial ToolMessage the
 * model reads): it denies one tool and never fails the run — the runtime
 * settles the row SKIPPED afterwards (`harness/approval-decisions.ts`).
 */
function resumeActionOf(action: ApprovalAction): string | undefined {
  switch (action) {
    case ApprovalAction.APPROVE:
    case ApprovalAction.APPROVE_ALL:
      return "approve";
    case ApprovalAction.SKIP:
      return "skip";
    case ApprovalAction.REJECT:
      return "reject";
    case ApprovalAction.UNSPECIFIED:
      return undefined;
    default: {
      const exhaustive: never = action;
      throw new Error(`hitl: unknown approval action ${String(exhaustive)}`);
    }
  }
}

/**
 * Either a genuine approval resume carrying the `Command(resume)` payload, or
 * not one — in which case the caller sends the turn's user message (its
 * single construction site; this module deliberately does NOT build a second
 * copy that could drift from it).
 */
export type ResumeResult =
  | { readonly isResumeFromApproval: true; readonly graphInput: Command }
  | { readonly isResumeFromApproval: false };

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
 * matching approval decisions; otherwise reports "not a resume" and the
 * caller sends the turn's user message.
 *
 * `decisions` is the runtime's reading of the adjudicated rows
 * (`TurnInput.approvalDecisions`, keyed by tool-call id) — the one
 * projection both harnesses agree on; this module never re-derives the
 * verdict from the rows. The graph checkpoint snapshot is read once by the
 * caller and passed in: on the durable (http) saver an extra `getState` is a
 * network round-trip best avoided.
 */
export function resolveResumeInput(
  decisions: ReadonlyMap<string, ApprovalAction>,
  graphState: GraphStateSnapshot,
): ResumeResult {
  const pendingInterrupts = extractPendingInterrupts(graphState);
  if (pendingInterrupts.length === 0) {
    return { isResumeFromApproval: false };
  }

  if (decisions.size === 0) {
    return { isResumeFromApproval: false };
  }

  const resumeDict: Record<string, { action: string }> = {};

  for (const intr of pendingInterrupts) {
    const decision = decisions.get(intr.toolCallId);
    if (decision === undefined) continue;

    const action = resumeActionOf(decision);
    if (!action) continue;

    resumeDict[intr.interruptId] = { action };
  }

  if (Object.keys(resumeDict).length === 0) {
    return { isResumeFromApproval: false };
  }

  console.log(
    `[hitl] Building resume for ${Object.keys(resumeDict).length} interrupt(s)`,
  );

  return {
    graphInput: new Command({ resume: resumeDict }),
    isResumeFromApproval: true,
  };
}

/** An un-resumed interrupt as the resume map addresses it: the id LangGraph matches, and the tool call it gates. */
interface ResumableInterrupt {
  readonly interruptId: string;
  readonly toolCallId: string;
}

function extractPendingInterrupts(state: GraphStateSnapshot): ResumableInterrupt[] {
  const result: ResumableInterrupt[] = [];

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

/**
 * Terminalize every tool call the approval gate auto-skipped under UNATTENDED
 * approval mode — the sibling of the runtime's `terminalizeNonExecutingDecisions`
 * for skips that have no human decision behind them.
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

/** A pending LangGraph approval interrupt, normalized from the graph checkpoint. */
export interface PendingInterrupt {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly mcpServerSlug: string;
  readonly message: string;
  /** Gate provenance carried through the interrupt; undefined → UNSPECIFIED. */
  readonly policySource: PolicySource | undefined;
}

/**
 * Normalize the graph checkpoint's un-resumed interrupts into pending
 * approvals — what a stream that ended on a gate left for the user. The
 * caller seeds one WAITING_APPROVAL row per entry and ends the turn awaiting
 * approval; the interrupt carries only `tool_call_id` and `message` beside
 * the gate's own facts, so the row's args are read from the AI message in
 * graph state, never from a second copy here.
 */
export function detectPendingInterrupts(graphState: GraphStateSnapshot): PendingInterrupt[] {
  return graphState.tasks.flatMap((task) =>
    (task.interrupts ?? [])
      .filter((intr) => intr.resumeValue === undefined)
      .map((intr) => {
        const val = intr.value;
        return {
          toolCallId: (val?.tool_call_id as string) ?? "",
          toolName: (val?.tool_name as string) ?? "",
          mcpServerSlug: (val?.mcp_server_slug as string) ?? "",
          message: (val?.message as string) ?? "",
          policySource: (val?.policy_source as PolicySource) || undefined,
        };
      }),
  );
}
