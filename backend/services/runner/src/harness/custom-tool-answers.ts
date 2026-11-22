/**
 * The runtime's one reader of the host app's answers to its own tools: the
 * door through which a custom tool's result reaches a resumed turn, beside
 * `approval-answers.ts`, which reads a person's verdicts.
 *
 * Why a second door. An approval is a verdict (run the call, or refuse it),
 * and every engine resumes a verdict through `ApprovalAction`. A host's
 * answer is the call's result itself: text the model reads, and whether the
 * tool failed. It is never a verdict, so it never becomes an
 * `ApprovalAction`, and nothing that reads one (the settle of a refused
 * call, provenance, a lease) sees it.
 *
 * The answer is a session event the server writes (`answerCustomToolUse`,
 * or the Managed Agents send): a `user.custom_tool_result` naming the
 * `agent.custom_tool_use` the runner wrote for the call (`events/ids.ts`
 * `toolUseEventId` of the run and the row). It is read on every
 * reinvocation, in the same read as the seed and the approvals
 * (`turn-context.ts` `reconcileReinvocation`), and handed to the turn by
 * tool-call id ({@link CustomToolAnswers.results}). The first answer to a
 * call stands: the server records one and refuses any other.
 *
 * The content is text blocks, joined with nothing between them, as an
 * answer's text is everywhere else in the log. The server accepts only
 * text today; a block of another kind is skipped here rather than shown
 * to the model as something it is not.
 *
 * Proven by `__tests__/custom-tool-answers.test.ts`, the custom-tool
 * contract both engines run (`__test-utils__/custom-tool-contract/`), and
 * the hermetic goldens.
 */

import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { rowIdOf } from "./transcript/resume-seed.js";

/** The log types the door lists: the host's answers. */
export const CUSTOM_TOOL_ANSWER_EVENT_TYPES = ["user.custom_tool_result"] as const;

/** The host's answer to one call: what the model reads as the call's result. */
export interface CustomToolAnswer {
  /** The answer's text blocks, joined. */
  readonly text: string;
  /** The tool failed: the model reads {@link text} as the error. */
  readonly isError: boolean;
}

/** What the door hands the turn. */
export interface CustomToolAnswers {
  /** Every answered custom call of the run, by tool-call id (the row's id); the first answer stands. */
  readonly results: ReadonlyMap<string, CustomToolAnswer>;
}

/** The run's answers among `events`, by tool-call id. A pure map. */
export function customToolAnswersOf(runId: string, events: readonly SessionEvent[]): CustomToolAnswers {
  const results = new Map<string, CustomToolAnswer>();
  for (const event of events) {
    if (event.event.case !== "userCustomToolResult") continue;
    const { customToolUseId, content, isError } = event.event.value;
    if (!customToolUseId.startsWith(`${runId}.`)) continue;
    const callId = rowIdOf(runId, customToolUseId);
    if (results.has(callId)) continue;
    const text = content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    results.set(callId, { text, isError });
  }
  return { results };
}

/** No answers: a fresh turn's. */
export const NO_CUSTOM_TOOL_ANSWERS: CustomToolAnswers = { results: new Map() };
