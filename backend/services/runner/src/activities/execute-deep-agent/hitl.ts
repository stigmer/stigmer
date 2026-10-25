/**
 * HITL (human-in-the-loop) resume infrastructure for the native deep-agent
 * harness — the LangGraph side of an approval round trip.
 *
 * The runtime reads the user's answers from the session's log
 * (`harness/approval-answers.ts`, on `TurnInput`) and settles the rows that
 * never run (SKIP, REJECT) after the turn; what is
 * this harness's is how those decisions reach the ENGINE: the graph
 * checkpoint's un-resumed interrupts, keyed by the interrupt's own id, become
 * a `Command(resume)` map ({@link resolveResumeInput}), and after a stream the
 * interrupts still pending become WAITING_APPROVAL rows
 * ({@link detectPendingInterrupts}). The gate's unattended skips are settled
 * by the shared fold (`shared/unattended-skips.ts`), re-exported here for
 * this harness's settle.
 *
 * Until #1096 this module also read the decisions from the execution itself
 * and carried the SKIP/REJECT settlement; both are the runtime's now, one
 * copy for every harness.
 */

import { Command } from "@langchain/langgraph";
export { reconcileUnattendedSkips } from "../../shared/unattended-skips.js";
import type { PolicySource } from "../../shared/approval-policy.js";
import { ApprovalAction } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

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
  /** The nodes the thread's latest save still has to run; empty once the graph finished. */
  readonly next: readonly string[];
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
 * `decisions` is the runtime's reading of the answers
 * (`TurnInput.approvalDecisions`, keyed by tool-call id) — the one
 * projection both harnesses agree on; this module never re-derives the
 * verdict from the rows. A deny's reason (`denyMessages`) rides the resume
 * value as its `comment`, which the gate renders into the refusal the model
 * reads (`middleware/approval-gate.ts`). The graph checkpoint snapshot is read once by the
 * caller and passed in: on the durable (http) saver an extra `getState` is a
 * network round-trip best avoided.
 */
export function resolveResumeInput(
  decisions: ReadonlyMap<string, ApprovalAction>,
  graphState: GraphStateSnapshot,
  denyMessages: ReadonlyMap<string, string> = new Map(),
): ResumeResult {
  const pendingInterrupts = extractPendingInterrupts(graphState);
  if (pendingInterrupts.length === 0) {
    return { isResumeFromApproval: false };
  }

  if (decisions.size === 0) {
    return { isResumeFromApproval: false };
  }

  const resumeDict: Record<string, { action: string; comment?: string }> = {};

  for (const intr of pendingInterrupts) {
    const decision = decisions.get(intr.toolCallId);
    if (decision === undefined) continue;

    const action = resumeActionOf(decision);
    if (!action) continue;

    const comment = denyMessages.get(intr.toolCallId) ?? "";
    resumeDict[intr.interruptId] = comment === "" ? { action } : { action, comment };
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

/** A pending LangGraph approval interrupt, normalized from the graph checkpoint. */
export interface PendingInterrupt {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly mcpServerSlug: string;
  readonly message: string;
  /** Gate provenance carried through the interrupt; undefined → UNSPECIFIED. */
  readonly policySource: PolicySource | undefined;
  /** The plugin whose hook asked (`""` for the agent's own hooks block); undefined when no hook asked. */
  readonly policyHook: string | undefined;
  /** The arguments a hook rewrote the call into, unredacted; undefined when the model's own arguments stand. */
  readonly args: Record<string, unknown> | undefined;
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
          policyHook: typeof val?.policy_hook === "string" ? val.policy_hook : undefined,
          args: isArgsObject(val?.args) ? val.args : undefined,
        };
      }),
  );
}

function isArgsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
