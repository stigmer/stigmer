/**
 * The AI judge's one reader of a run's transcript: the request, each
 * top-level tool call, and the final answer, rendered as one JSON document
 * the judge grades. Beside `actionsOf` (../checks/actions.ts), which reduces
 * the same calls to hashes for the free checks, this is the second function
 * that is rewritten when the transcript moves off the run's status onto a
 * session event log; the rubrics and the verdict reader do not change.
 *
 * What the judge is shown, and the bounds that keep a long run affordable:
 *
 *   - the request (`spec.message`), up to 20,000 characters;
 *   - each top-level tool call in order: its 1-based step, name, arguments
 *     (already redacted of secret-named values by the runner, message.proto),
 *     status, error, and result, each text field up to 2,000 characters. A
 *     result the runner spilled to storage keeps only a preview on the run,
 *     so it is always marked cut;
 *   - the final answer: the last assistant message, or the structured
 *     output when the run delivered one, up to 20,000 characters.
 *
 * A text longer than its bound ends in ` [cut]`, which the made-nothing-up
 * rubric reads: a claim that could rest on a cut result is not failed.
 * When the whole document would pass 60,000 characters, tool calls are
 * dropped from the middle, the first and last kept, and the gap is one
 * marked entry counting the calls left out. Sub-agent runs are not
 * traversed, as the free checks do not traverse them.
 *
 * The document is compact JSON with every `<` written as `<`, so the
 * transcript can never close the `<conversation>` element it is fenced in
 * (rubrics.ts, judgeMessage) and every string the run carried stays a
 * string to the judge.
 *
 * Proven by __tests__/judge.test.ts.
 */
import type { JsonValue } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { canonicalJson } from "../../../pipeline/steps/spec-hash.js";

/** The bound on each tool call's text fields. */
export const TOOL_FIELD_MAX_LENGTH = 2_000;

/** The bound on the request and on the final answer. */
export const REQUEST_MAX_LENGTH = 20_000;
export const ANSWER_MAX_LENGTH = 20_000;

/** The bound on the whole document. */
export const SUBJECT_MAX_LENGTH = 60_000;

/** The marker a cut text ends in. */
export const CUT_MARKER = " [cut]";

interface SubjectCall {
  readonly step: number;
  readonly name: string;
  readonly args: string;
  readonly status: string;
  readonly error?: string;
  readonly result: string;
}

interface ElidedCalls {
  readonly elided_tool_calls: number;
}

/** The judge's view of `run` (the module header). */
export function subjectOf(run: Run): string {
  const request = cut(run.spec?.message ?? "", REQUEST_MAX_LENGTH);
  const answer = cut(finalAnswerOf(run), ANSWER_MAX_LENGTH);
  const calls = toolCallsOf(run);

  const document = (toolCalls: ReadonlyArray<SubjectCall | ElidedCalls>) =>
    escapeAngle(
      JSON.stringify({ request, tool_calls: toolCalls, final_answer: answer }),
    );

  const whole = document(calls);
  if (whole.length <= SUBJECT_MAX_LENGTH) {
    return whole;
  }
  return document(keepEnds(calls, document));
}

/**
 * The calls kept when the whole would pass the bound: taken from both ends
 * in turn while they fit, with one marker for the rest. Sizes add because
 * the document is compact JSON: each kept call costs its own text and one
 * comma.
 */
function keepEnds(
  calls: ReadonlyArray<SubjectCall>,
  document: (toolCalls: ReadonlyArray<SubjectCall | ElidedCalls>) => string,
): ReadonlyArray<SubjectCall | ElidedCalls> {
  const sizes = calls.map((call) => escapeAngle(JSON.stringify(call)).length + 1);
  const marker = (count: number): ElidedCalls => ({ elided_tool_calls: count });
  let budget =
    SUBJECT_MAX_LENGTH - document([marker(calls.length)]).length;
  const head: SubjectCall[] = [];
  const tail: SubjectCall[] = [];
  let low = 0;
  let high = calls.length - 1;
  let fromHead = true;
  while (low <= high) {
    const index = fromHead ? low : high;
    const size = sizes[index] ?? 0;
    if (size > budget) {
      break;
    }
    budget -= size;
    const call = calls[index];
    if (call !== undefined) {
      if (fromHead) {
        head.push(call);
        low++;
      } else {
        tail.unshift(call);
        high--;
      }
    }
    fromHead = !fromHead;
  }
  return [...head, marker(high - low + 1), ...tail];
}

function toolCallsOf(run: Run): SubjectCall[] {
  const calls: SubjectCall[] = [];
  for (const message of run.status?.messages ?? []) {
    for (const call of message.toolCalls) {
      const spilled =
        call.outputRef !== undefined && call.outputRef.contentHash !== "";
      const result = cut(call.result, TOOL_FIELD_MAX_LENGTH);
      calls.push({
        step: calls.length + 1,
        name: call.name,
        args:
          call.args === undefined
            ? ""
            : cut(canonicalJson(call.args), TOOL_FIELD_MAX_LENGTH),
        status: statusName(call.status),
        ...(call.error === ""
          ? {}
          : { error: cut(call.error, TOOL_FIELD_MAX_LENGTH) }),
        result: spilled && !result.endsWith(CUT_MARKER)
          ? `${result}${CUT_MARKER}`
          : result,
      });
    }
  }
  return calls;
}

/** The run's answer: its structured output when delivered, else its last assistant message. */
function finalAnswerOf(run: Run): string {
  const structured = run.status?.structuredOutput;
  if (structured !== undefined) {
    return JSON.stringify(structured satisfies JsonValue);
  }
  const messages = run.status?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.type === MessageType.MESSAGE_AI && message.content !== "") {
      return message.content;
    }
  }
  return "";
}

/**
 * Each tool-call status as the judge reads it. A table over every value, so
 * a status added to the contract does not compile until it is named here.
 */
const STATUS_NAMES: Readonly<Record<ToolCallStatus, string>> = {
  [ToolCallStatus.TOOL_CALL_STATUS_UNSPECIFIED]: "unknown",
  [ToolCallStatus.TOOL_CALL_PENDING]: "pending",
  [ToolCallStatus.TOOL_CALL_RUNNING]: "running",
  [ToolCallStatus.TOOL_CALL_COMPLETED]: "completed",
  [ToolCallStatus.TOOL_CALL_FAILED]: "failed",
  [ToolCallStatus.TOOL_CALL_WAITING_APPROVAL]: "waiting for approval",
  [ToolCallStatus.TOOL_CALL_SKIPPED]: "skipped",
  [ToolCallStatus.TOOL_CALL_INTERRUPTED]: "interrupted",
};

function statusName(status: ToolCallStatus): string {
  return STATUS_NAMES[status] ?? "unknown";
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}${CUT_MARKER}`;
}

function escapeAngle(json: string): string {
  return json.replaceAll("<", "\\u003c");
}
