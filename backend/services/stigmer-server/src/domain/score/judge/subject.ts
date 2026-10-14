/**
 * The AI judge's one reader of a turn: the parts the judge is shown
 * (`SubjectParts`, @stigmer/eval-runtime), read from the graded run's
 * session events and those of the turns before it in its session. The
 * library's `renderSubject` turns the parts into the document the judge
 * grades, with its bounds, cut markers and escaping; this module only
 * reads. Beside `actionsOf` (../checks/actions.ts), which reduces the same
 * calls to hashes for the free checks, it reads the turn through the fold
 * every client uses (../turn.ts); the rubrics, the renderer, the verdict
 * reader and the benchmark's example conversations do not depend on where
 * the turn is stored.
 *
 * From the graded run: the request (`spec.message`); each top-level tool
 * use in order, its input as canonical JSON (redacted of secret-named
 * values by the runner before it reached the log, message.proto), its
 * state's status name, and its result's text as the error when the result
 * is one, else as the result; a result the runner offloaded to storage
 * marked cut, since the log keeps only its head; and the final answer:
 * the turn's structured output when it delivered one, else its last
 * agent message. From each earlier run of the session: its request and
 * final answer only.
 *
 * `earlierRunsOf` reads those earlier runs with one indexed read: the run
 * list index's `session` key, strictly after the graded run's own position
 * in the index's newest-first order, at most EARLIER_TURNS_MAX rows. The
 * position is derived the way the index derives a row's (listIndexFactsOf),
 * so the cursor and the stored row agree byte for byte. The earlier turns
 * are the same conversation the graded run's viewers already see.
 * `earlierTurnsOf` adds each one's answer events (its agent messages and
 * its structured output, one typed read per run).
 *
 * Proven by __tests__/judge.test.ts and
 * ../__tests__/transcript-from-events.test.ts.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";

import { EARLIER_TURNS_MAX } from "@stigmer/eval-runtime/judge";
import type { SubjectCall, SubjectCallStatus, SubjectParts } from "@stigmer/eval-runtime/judge";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { ToolUseState, Turn } from "@stigmer/session-log";

import { canonicalJson } from "../../../pipeline/steps/spec-hash.js";
import type { Store } from "../../../store/interface.js";
import { listIndexInstant } from "../../../store/list-index.js";
import { agentExecutionListIndex } from "../../run/list-index.js";
import { sessionIdOf } from "../../run/target.js";
import {
  STRUCTURED_OUTPUT_EVENT_TYPE,
  runEventsOf,
} from "../../session/events/run-events.js";
import type { RunTranscript } from "../../session/events/run-events.js";
import { lastMessageOf, toolUsesOf, turnOfTranscript } from "../turn.js";

/** The event types an earlier turn's answer is read from. */
const ANSWER_EVENT_TYPES: ReadonlyArray<string> = [
  "agent.message",
  STRUCTURED_OUTPUT_EVENT_TYPE,
];

/** The judge's view of `graded`, after the `earlier` turns of its session, oldest first. */
export function subjectPartsOf(
  graded: RunTranscript,
  earlier: ReadonlyArray<RunTranscript>,
): SubjectParts {
  const turn = turnOfTranscript(graded);
  return {
    earlierTurns: earlier.map((transcript) => ({
      request: transcript.run.spec?.message ?? "",
      answer: finalAnswerOf(turnOfTranscript(transcript)),
    })),
    request: graded.run.spec?.message ?? "",
    toolCalls: toolCallsOf(turn),
    answer: finalAnswerOf(turn),
  };
}

/**
 * The turns before `run` in its session, oldest first, at most
 * EARLIER_TURNS_MAX, each with the events its answer is read from (the
 * module header).
 */
export async function earlierTurnsOf(
  store: Store,
  run: Run,
): Promise<RunTranscript[]> {
  const runs = await earlierRunsOf(store, run);
  return Promise.all(
    runs.map(async (earlier) => ({
      run: earlier,
      events: await runEventsOf(store, earlier, ANSWER_EVENT_TYPES),
    })),
  );
}

/**
 * The runs before `run` in its session, oldest first, at most
 * EARLIER_TURNS_MAX (the module header). A run with no session has none.
 */
export async function earlierRunsOf(store: Store, run: Run): Promise<Run[]> {
  const sessionId = sessionIdOf(run.spec);
  if (sessionId === "") {
    return [];
  }
  const rows = await store.queryResources(agentExecutionListIndex, {
    org: run.metadata?.org ?? "",
    anyKey: [{ name: "session", value: sessionId }],
    after: {
      createdAt: listIndexInstant(run.status?.audit?.specAudit?.createdAt),
      id: run.metadata?.id ?? "",
    },
    limit: EARLIER_TURNS_MAX,
  });
  return rows.map((row) => fromBinary(RunSchema, row.data)).reverse();
}

function toolCallsOf(turn: Turn | undefined): SubjectCall[] {
  return toolUsesOf(turn).map((use) => {
    const text = use.result?.text ?? "";
    const errored = use.result?.isError === true;
    return {
      name: use.name,
      args: canonicalJson(use.input),
      status: STATUS_NAMES[use.state],
      error: errored ? text : "",
      result: errored ? "" : text,
      resultCut:
        use.fullOutput !== undefined && use.fullOutput.contentHash !== "",
    };
  });
}

/** The turn's answer: its structured output when delivered, else its last agent message. */
function finalAnswerOf(turn: Turn | undefined): string {
  const structured = turn?.structuredOutput;
  if (structured !== undefined) {
    return JSON.stringify(structured satisfies JsonValue);
  }
  return lastMessageOf(turn);
}

/**
 * Each tool use state as the judge reads it: a person's or a rule's
 * refusal as skipped, a call its turn ended before it returned as
 * interrupted. A table over every state, so a state added to the fold
 * does not compile until it is named here.
 */
const STATUS_NAMES: Readonly<Record<ToolUseState, SubjectCallStatus>> = {
  running: "running",
  waiting: "waiting for approval",
  completed: "completed",
  failed: "failed",
  denied: "skipped",
  stopped: "interrupted",
};
