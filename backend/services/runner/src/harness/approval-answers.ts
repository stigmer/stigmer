/**
 * The runtime's one reader of a person's answers to the calls that asked:
 * the door through which an approval reaches a resumed turn.
 *
 * An answer is a session event the server writes (`confirmToolUse`,
 * `grantPermission`, or the `submitApproval` adapter onto them): a
 * `user.tool_confirmation` (`allow` or `deny`, a deny with the reason the
 * person gave) per call answered, and a `stigmer.permission.grant` on the
 * call a person allowed "for the rest of the turn". The reader lists the
 * run's two answer types once, at the reinvocation's start
 * (`turn-context.ts` `reconcileReinvocation`), and maps each answer to the
 * seeded row it names: the row still WAITING_APPROVAL whose tool use id
 * (`events/ids.ts` `toolUseEventId`, the id the emitter wrote the ask
 * under) the answer carries. So the verdict comes from the log, never
 * from the row.
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
 * Everything downstream still keys on the decision map
 * (`TurnInput.approvalDecisions`) and reads each row's own stamps for the
 * rest (leases, provenance, the settle of a denied row,
 * `approval-decisions.ts`): the server stamps `approval_action` on the row in
 * the same transaction that appends the answer, and the seed is the run
 * fetched after it, so the two agree. They move to the log when the rows
 * leave the status.
 *
 * The rows read are the root transcript's, the same set the runtime has
 * always resumed by: a sub-agent's ask surfaces as a root WAITING row on the
 * engine that pauses for it.
 *
 * Failure. The read is a control-plane read like the turn's own fetches: it
 * throws, and the activity's retry runs the turn's start again. A turn whose
 * seed holds no WAITING row reads nothing.
 *
 * Proven by `__tests__/approval-answers.test.ts`, by both test kits (which
 * answer on a modelled log, as the server would) and the hermetic goldens.
 */

import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import type { StigmerClient } from "../client/stigmer-client.js";
import { toolUseEventId } from "./events/ids.js";

/** The log types that answer a call: what the door lists. */
export const APPROVAL_ANSWER_EVENT_TYPES = ["user.tool_confirmation", "stigmer.permission.grant"] as const;

/** One call's answer, as the turn resumes with it. */
export interface ApprovalAnswer {
  readonly action: ApprovalAction;
  /** The reason a person gave with a deny; "" otherwise. */
  readonly denyMessage: string;
}

/** What the door hands the turn: the verdicts by row id, and the reasons given with a deny. */
export interface ApprovalAnswers {
  /** Every answered WAITING row, by tool-call id, in transcript order. */
  readonly decisions: ReadonlyMap<string, ApprovalAction>;
  /** The deny message of each denied row that carries one, by tool-call id. */
  readonly denyMessages: ReadonlyMap<string, string>;
}

/** No answers: a fresh turn, or nothing answered yet. */
export const NO_APPROVAL_ANSWERS: ApprovalAnswers = { decisions: new Map(), denyMessages: new Map() };

/**
 * The answers among `events` for the root rows of `status` still
 * WAITING_APPROVAL, keyed by tool-call id in transcript order. A pure map:
 * the reader below and both test kits share it.
 */
export function approvalAnswersOf(runId: string, status: RunStatus, events: readonly SessionEvent[]): ApprovalAnswers {
  const confirmed = new Map<string, { readonly result: string; readonly denyMessage: string }>();
  const granted = new Set<string>();
  for (const event of events) {
    if (event.event.case === "userToolConfirmation") {
      const { toolUseId, result, denyMessage } = event.event.value;
      if (!confirmed.has(toolUseId)) confirmed.set(toolUseId, { result, denyMessage });
    } else if (event.event.case === "stigmerPermissionGrant") {
      granted.add(event.event.value.toolUseId);
    }
  }
  const decisions = new Map<string, ApprovalAction>();
  const denyMessages = new Map<string, string>();
  for (const message of status.messages) {
    for (const row of message.toolCalls) {
      if (row.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) continue;
      const useId = toolUseEventId(runId, row.id);
      const answer = confirmed.get(useId);
      if (answer === undefined) continue;
      if (answer.result === "deny") {
        decisions.set(row.id, ApprovalAction.REJECT);
        if (answer.denyMessage !== "") denyMessages.set(row.id, answer.denyMessage);
      } else if (answer.result === "allow") {
        decisions.set(row.id, granted.has(useId) ? ApprovalAction.APPROVE_ALL : ApprovalAction.APPROVE);
      }
    }
  }
  return { decisions, denyMessages };
}

/** Whether the seed holds a root row still waiting for an answer: only then is there anything to read. */
export function hasWaitingRow(status: RunStatus): boolean {
  return status.messages.some((message) =>
    message.toolCalls.some((row) => row.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL),
  );
}

/**
 * Read the run's answers from its session's log and map them onto the
 * seeded rows (the module header). Throws when the log cannot be read.
 */
export async function readApprovalAnswers(
  client: Pick<StigmerClient, "listRunSessionEvents">,
  args: { readonly sessionId: string; readonly runId: string; readonly status: RunStatus },
): Promise<ApprovalAnswers> {
  if (!hasWaitingRow(args.status)) return NO_APPROVAL_ANSWERS;
  const events = await client.listRunSessionEvents(args.sessionId, args.runId, APPROVAL_ANSWER_EVENT_TYPES);
  return approvalAnswersOf(args.runId, args.status, events);
}
