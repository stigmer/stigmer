/**
 * The one reader of a turn for the run-health checks: the run's top-level
 * tool calls, in order, reduced to what the checks compare, and whether a
 * structured answer was asked for and given. The checks (checks.ts) are
 * pure functions over this view. The calls and the answer are read from
 * the run's session events, folded by `@stigmer/session-log` (the primary
 * thread's tool uses with their results, and the turn's
 * `stigmer.agent.structured_output`); whether an answer was asked for is
 * the run's own spec.
 *
 * Two keys stand in for content, so the checks compare without holding or
 * quoting anything anyone typed:
 *   - `argsKey` is the SHA-256 of the call's whole input as canonical
 *     JSON (pipeline/steps/spec-hash.ts). The contract requires a tool
 *     use's input and the runner writes a use only once its input is
 *     known, so every call has a key; the checks still read an empty key
 *     as "not known", never a repeat.
 *   - `resultKey` is the offloaded output's own `content_hash` when the
 *     runner offloaded the result (then the result event holds only the
 *     output's head, and two different outputs can share a head),
 *     otherwise the SHA-256 of the result's text. A result that is an
 *     error keys as no result: its text is the error, which the checks
 *     never compared, so three equal calls that each fail are a repeat
 *     whatever each error said, as they were when the result and the
 *     error were kept apart.
 * A tool use's state reads as the row status it stands for (../turn.ts).
 *
 * Sub-agent threads are not traversed: whose fault a sub-agent's loop is
 * belongs to an evaluator that can read both.
 */
import { createHash } from "node:crypto";

import type { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { canonicalJson } from "../../../pipeline/steps/spec-hash.js";
import type { RunTranscript } from "../../session/events/run-events.js";
import { toolCallStatusOf, toolUsesOf, turnOfTranscript } from "../turn.js";

/** One top-level tool call, as the checks see it. */
export interface RunAction {
  readonly name: string;
  readonly argsKey: string;
  readonly resultKey: string;
  readonly status: ToolCallStatus;
  /** 1-based position among the run's top-level tool calls. */
  readonly step: number;
}

/** What the checks read of a run. */
export interface RunActions {
  readonly actions: ReadonlyArray<RunAction>;
  /** Whether the run asked for an answer in a fixed shape. */
  readonly schemaSet: boolean;
  /** Whether the run delivered that answer. */
  readonly outputPresent: boolean;
}

/** What the checks read of `transcript`'s run (the module header). */
export function actionsOf(transcript: RunTranscript): RunActions {
  const { run } = transcript;
  const turn = turnOfTranscript(transcript);
  const actions: RunAction[] = [];
  for (const use of toolUsesOf(turn)) {
    const errored = use.result?.isError === true;
    actions.push({
      name: use.name,
      argsKey: sha256(canonicalJson(use.input)),
      resultKey:
        use.fullOutput !== undefined && use.fullOutput.contentHash !== ""
          ? `ref:${use.fullOutput.contentHash}`
          : `sha256:${sha256(errored ? "" : (use.result?.text ?? ""))}`,
      status: toolCallStatusOf(use.state),
      step: actions.length + 1,
    });
  }
  const schema = run.spec?.structuredOutputSchema;
  return {
    actions,
    schemaSet: schema !== undefined && Object.keys(schema).length > 0,
    outputPresent: turn?.structuredOutput !== undefined,
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
