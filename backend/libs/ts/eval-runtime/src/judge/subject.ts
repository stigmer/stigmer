/**
 * What the AI judge is shown, as parts, and the one renderer that turns
 * them into the JSON document the judge grades. The server reads the parts
 * from a run and its session (its domain/score/judge/subject.ts, the one
 * adapter from storage); the benchmark writes them by hand as example
 * conversations. Both render through `renderSubject`, so an example is
 * graded exactly as a live run is, and a change to how a transcript is
 * stored rewrites the adapter, never an example.
 *
 * The parts, and the bounds that keep a long run affordable:
 *
 *   - the earlier turns of the conversation, oldest first, at most
 *     EARLIER_TURNS_MAX: each turn's request and final answer, up to 2,000
 *     characters each, with no tool calls. They let a request like "yes, go
 *     ahead" be read for what it agrees to;
 *   - the request, up to 20,000 characters;
 *   - each top-level tool call in order: its 1-based step, name, arguments
 *     (already redacted of secret-named values by the runner), status,
 *     error, and result, each text field up to 2,000 characters. A result
 *     the run kept only a preview of is always marked cut;
 *   - the final answer, up to 20,000 characters.
 *
 * A text longer than its bound ends in ` [cut]`, which the made-nothing-up
 * rubric reads: a claim that could rest on a cut result is not failed.
 * When the whole document would pass 60,000 characters, the earlier turns
 * go first, oldest first, behind one counted marker; then tool calls are
 * dropped from the middle, the first and last kept, behind one counted
 * marker. Sub-agent runs are not traversed.
 *
 * The document is compact JSON with every `<` written as `<`, so the
 * transcript can never close the `<conversation>` element it is fenced in
 * (rubrics.ts, judgeMessage) and every string the run carried stays a
 * string to the judge.
 *
 * Proven by __tests__/subject.test.ts.
 */

/**
 * The bounds count characters as written in the document, after JSON
 * escaping and each `<` becoming a six-character escape, so markup-heavy
 * text cannot carry the document past its bound.
 */

/** The bound on each tool call's text fields, and on each earlier turn's. */
export const TOOL_FIELD_MAX_LENGTH = 2_000;
export const EARLIER_TURN_FIELD_MAX_LENGTH = 2_000;

/** The bound on the request and on the final answer. */
export const REQUEST_MAX_LENGTH = 20_000;
export const ANSWER_MAX_LENGTH = 20_000;

/** The bound on the whole document. */
export const SUBJECT_MAX_LENGTH = 60_000;

/** The most earlier turns the judge is shown. */
export const EARLIER_TURNS_MAX = 3;

/** The marker a cut text ends in. */
export const CUT_MARKER = " [cut]";

/** A tool call's status, as the judge reads it. */
export type SubjectCallStatus =
  | "unknown"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "waiting for approval"
  | "skipped"
  | "interrupted";

/** One earlier turn: what the person asked and what the agent answered. */
export interface SubjectTurn {
  readonly request: string;
  readonly answer: string;
}

/** One top-level tool call of the graded turn. */
export interface SubjectCall {
  readonly name: string;
  /** The arguments as canonical JSON text; "" when the call had none. */
  readonly args: string;
  readonly status: SubjectCallStatus;
  /** The call's error; absent or "" when it had none. */
  readonly error?: string;
  readonly result: string;
  /** The run kept only a preview of the result, so it is marked cut. */
  readonly resultCut?: boolean;
}

/** What the judge is shown of one turn (the module header). */
export interface SubjectParts {
  /** The turns before the graded one, oldest first. */
  readonly earlierTurns: ReadonlyArray<SubjectTurn>;
  readonly request: string;
  readonly toolCalls: ReadonlyArray<SubjectCall>;
  /** The final answer: the last assistant message, or the structured output as JSON text. */
  readonly answer: string;
}

interface RenderedTurn {
  readonly request: string;
  readonly final_answer: string;
}

interface RenderedCall {
  readonly step: number;
  readonly name: string;
  readonly args: string;
  readonly status: string;
  readonly error?: string;
  readonly result: string;
}

interface ElidedTurns {
  readonly elided_earlier_turns: number;
}

interface ElidedCalls {
  readonly elided_tool_calls: number;
}

type Turns = ReadonlyArray<RenderedTurn | ElidedTurns>;
type Calls = ReadonlyArray<RenderedCall | ElidedCalls>;

/** The judge's document for `parts` (the module header). */
export function renderSubject(parts: SubjectParts): string {
  const request = cut(parts.request, REQUEST_MAX_LENGTH);
  const answer = cut(parts.answer, ANSWER_MAX_LENGTH);
  const turns = parts.earlierTurns
    .slice(-EARLIER_TURNS_MAX)
    .map((turn): RenderedTurn => ({
      request: cut(turn.request, EARLIER_TURN_FIELD_MAX_LENGTH),
      final_answer: cut(turn.answer, EARLIER_TURN_FIELD_MAX_LENGTH),
    }));
  const calls = parts.toolCalls.map(renderedCall);

  const document = (earlier: Turns, toolCalls: Calls) =>
    escapeAngle(
      JSON.stringify({
        earlier_turns: earlier,
        request,
        tool_calls: toolCalls,
        final_answer: answer,
      }),
    );

  for (let dropped = 0; dropped <= turns.length; dropped++) {
    const whole = document(withoutOldest(turns, dropped), calls);
    if (whole.length <= SUBJECT_MAX_LENGTH) {
      return whole;
    }
  }
  const noTurns = withoutOldest(turns, turns.length);
  return document(
    noTurns,
    keepEnds(calls, (toolCalls) => document(noTurns, toolCalls)),
  );
}

function renderedCall(call: SubjectCall, index: number): RenderedCall {
  const result = cut(call.result, TOOL_FIELD_MAX_LENGTH);
  const error = call.error ?? "";
  return {
    step: index + 1,
    name: call.name,
    args: cut(call.args, TOOL_FIELD_MAX_LENGTH),
    status: call.status,
    ...(error === "" ? {} : { error: cut(error, TOOL_FIELD_MAX_LENGTH) }),
    result:
      call.resultCut === true && !result.endsWith(CUT_MARKER)
        ? `${result}${CUT_MARKER}`
        : result,
  };
}

/** `turns` without its `dropped` oldest, behind one marker counting them. */
function withoutOldest(
  turns: ReadonlyArray<RenderedTurn>,
  dropped: number,
): Turns {
  if (dropped === 0) {
    return turns;
  }
  return [{ elided_earlier_turns: dropped }, ...turns.slice(dropped)];
}

/**
 * The calls kept when the whole would pass the bound: taken from both ends
 * in turn while they fit, with one marker for the rest. Sizes add because
 * the document is compact JSON: each kept call costs its own text and one
 * comma.
 */
function keepEnds(
  calls: ReadonlyArray<RenderedCall>,
  document: (toolCalls: Calls) => string,
): Calls {
  const sizes = calls.map((call) => escapeAngle(JSON.stringify(call)).length + 1);
  const marker = (count: number): ElidedCalls => ({ elided_tool_calls: count });
  let budget = SUBJECT_MAX_LENGTH - document([marker(calls.length)]).length;
  const head: RenderedCall[] = [];
  const tail: RenderedCall[] = [];
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

function cut(text: string, max: number): string {
  if (writtenLength(text) <= max) {
    return text;
  }
  let kept = 0;
  let used = 0;
  for (const character of text) {
    const cost = writtenLength(character);
    if (used + cost > max) {
      break;
    }
    used += cost;
    kept += character.length;
  }
  return `${text.slice(0, kept)}${CUT_MARKER}`;
}

/** How many characters `text` takes in the document: escaped as a JSON string, without its quotes. */
function writtenLength(text: string): number {
  return escapeAngle(JSON.stringify(text)).length - 2;
}

function escapeAngle(json: string): string {
  return json.replaceAll("<", "\\u003c");
}
