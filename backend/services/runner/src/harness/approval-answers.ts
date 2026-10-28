/**
 * The runtime's one reader of a person's answers to the calls that asked:
 * the door through which an approval reaches a resumed turn.
 *
 * An answer is a session event the server writes (`confirmToolUse`,
 * `grantPermission`): a
 * `user.tool_confirmation` (`allow` or `deny`, a deny with the reason the
 * person gave) per call answered, and a `stigmer.permission.grant` (with
 * its lease: a category, a server, or a hook's asks on one tool) on the
 * call a person allowed "for the rest of the turn". Beside them the reader
 * lists the runner's own `stigmer.permission.asked`, one per ask, for what
 * the call was asked under: the rule that asked (its policy source word,
 * and the hook). Every answer, grant and ask is keyed by the tool use id it names
 * (`events/ids.ts` `toolUseEventId`, the id the emitter wrote the ask
 * under).
 *
 * The run's three types are read once, on every reinvocation, in the same
 * read as the seed (`turn-context.ts` `reconcileReinvocation`): a turn with
 * no row still waiting reads them too, since the calls answered in earlier
 * invocations of the run carry their answers and the grants their leases.
 *
 *   allow ..................... APPROVE
 *   deny ...................... REJECT, with its deny message
 *   allow with a grant on it .. APPROVE_ALL (the call the class was granted
 *                               on; the other calls the grant answered carry
 *                               their own allow)
 *
 * SKIP is not a verdict any more: a person's skip and reject are one deny,
 * told apart only by whether a reason was given.
 *
 * Two readings of the answers reach the turn:
 *
 *  - the decision map (`TurnInput.approvalDecisions`) for the root rows
 *    still WAITING_APPROVAL, the set the runtime has always resumed by: a
 *    sub-agent's ask surfaces as a root WAITING row on the engine that
 *    pauses for it;
 *  - the answer on every row ({@link copyAnswersOntoRows}). The seeded
 *    rows are the asks the resumed engine resumes onto (`transcript/resume-seed.ts`),
 *    and the seed copies each call's answer from the log onto its row's
 *    `approval_action`, so every later reader of that field (the settle,
 *    provenance, the boundary's closed-gate rule) reads the log's answer.
 *
 * Failure. The read is a control-plane read like the turn's own fetches: it
 * throws, and the activity's retry runs the turn's start again.
 *
 * Proven by `__tests__/approval-answers.test.ts`, by both test kits (which
 * answer only on a modelled log, as the server does) and the hermetic
 * goldens.
 */

import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import type { LeaseGrant } from "../shared/approval-policy.js";
import { toolUseEventId } from "./events/ids.js";
import type { AgentMessage, TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { ApprovalAction, ToolCallStatus } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

/** The log types the door lists: the answers, the grants, and the asks they answer. */
export const APPROVAL_ANSWER_EVENT_TYPES = ["user.tool_confirmation", "stigmer.permission.grant", "stigmer.permission.asked"] as const;

/** One call's answer, as the log holds it. */
export interface LoggedAnswer {
  readonly result: "allow" | "deny";
  /** The reason a person gave with a deny; "" otherwise. */
  readonly denyMessage: string;
}

/** What a call was asked under, as its `stigmer.permission.asked` states it. */
export interface ApprovalAsk {
  /** The rule that asked, as the log's word (`hook`, `builtin_category`, ...); "" for none. */
  readonly policySource: string;
  /** The plugin whose hook asked; "" for the agent's own hooks or none. */
  readonly policyHook: string;
}

/** What the door hands the turn. */
export interface ApprovalAnswers {
  /** Every answered root WAITING row's verdict, by tool-call id, in transcript order. */
  readonly decisions: ReadonlyMap<string, ApprovalAction>;
  /** The deny message of each denied root WAITING row that carries one, by tool-call id. */
  readonly denyMessages: ReadonlyMap<string, string>;
  /** Every answer of the run, by tool use id; the first answer to a call stands. */
  readonly answers: ReadonlyMap<string, LoggedAnswer>;
  /** Every grant of the run, by the tool use id it was given on: its lease. */
  readonly grants: ReadonlyMap<string, LeaseGrant>;
  /** Every ask of the run, by tool use id. */
  readonly asks: ReadonlyMap<string, ApprovalAsk>;
}

/** The verdict the log gives the call under `toolUseId`; UNSPECIFIED when it holds no answer. */
export function loggedActionOf(answers: Pick<ApprovalAnswers, "answers" | "grants">, toolUseId: string): ApprovalAction {
  const answer = answers.answers.get(toolUseId);
  if (answer === undefined) return ApprovalAction.UNSPECIFIED;
  if (answer.result === "deny") return ApprovalAction.REJECT;
  return answers.grants.has(toolUseId) ? ApprovalAction.APPROVE_ALL : ApprovalAction.APPROVE;
}

/**
 * The run's answers, grants and asks among `events`, and the verdicts for
 * the root rows still WAITING_APPROVAL, keyed by tool-call id in
 * transcript order. A pure map: the reinvocation phase
 * (`turn-context.ts`) and both test kits share it.
 */
export function approvalAnswersOf(
  runId: string,
  rows: { readonly messages: readonly AgentMessage[] },
  events: readonly SessionEvent[],
): ApprovalAnswers {
  const answers = new Map<string, LoggedAnswer>();
  const grants = new Map<string, LeaseGrant>();
  const asks = new Map<string, ApprovalAsk>();
  for (const event of events) {
    switch (event.event.case) {
      case "userToolConfirmation": {
        const { toolUseId, result, denyMessage } = event.event.value;
        if ((result === "allow" || result === "deny") && !answers.has(toolUseId)) answers.set(toolUseId, { result, denyMessage });
        break;
      }
      case "stigmerPermissionGrant": {
        const { toolUseId, lease } = event.event.value;
        if (lease !== undefined && !grants.has(toolUseId)) {
          grants.set(toolUseId, { category: lease.category, server: lease.server, hook: lease.hook, tool: lease.tool });
        }
        break;
      }
      case "stigmerPermissionAsked": {
        const { toolUseId, policySource, policyHook } = event.event.value;
        if (!asks.has(toolUseId)) asks.set(toolUseId, { policySource, policyHook });
        break;
      }
      default:
        break;
    }
  }
  const decisions = new Map<string, ApprovalAction>();
  const denyMessages = new Map<string, string>();
  for (const message of rows.messages) {
    for (const row of message.toolCalls) {
      if (row.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) continue;
      const useId = toolUseEventId(runId, row.id);
      const action = loggedActionOf({ answers, grants }, useId);
      if (action === ApprovalAction.UNSPECIFIED) continue;
      decisions.set(row.id, action);
      const denyMessage = answers.get(useId)?.denyMessage ?? "";
      if (action === ApprovalAction.REJECT && denyMessage !== "") denyMessages.set(row.id, denyMessage);
    }
  }
  return { decisions, denyMessages, answers, grants, asks };
}

/**
 * The seed's copy of the log's answers onto the rows (the module header):
 * every row of the root transcript and of every sub-agent run has its
 * `approval_action` cleared, then set from the answer the log holds for its
 * tool use. Sub-agent rows take their tool use id from the run and their own
 * id, as the emitter wrote them. In place.
 */
export function copyAnswersOntoRows(
  runId: string,
  rows: Pick<TurnRows, "messages" | "subAgentRuns">,
  answers: Pick<ApprovalAnswers, "answers" | "grants">,
): void {
  const copy = (messages: readonly AgentMessage[]): void => {
    for (const message of messages) {
      for (const row of message.toolCalls) row.approvalAction = loggedActionOf(answers, toolUseEventId(runId, row.id));
    }
  };
  copy(rows.messages);
  for (const subAgent of rows.subAgentRuns) copy(subAgent.messages);
}
