/**
 * The one reader of a run's transcript for the run-health checks: the
 * run's top-level tool calls, in order, reduced to what the checks
 * compare, and whether a structured answer was asked for and given. The
 * checks (checks.ts) are pure functions over this view, so when the
 * transcript moves off the run's status onto a session event log, this
 * function is rewritten to read the log and no check changes.
 *
 * Two keys stand in for content, so the checks compare without holding or
 * quoting anything anyone typed:
 *   - `argsKey` is the SHA-256 of the call's whole `args` as canonical
 *     JSON (pipeline/steps/spec-hash.ts). `args` is never elided (only
 *     `args_preview` is shortened), but a row may lack it until its start
 *     is re-emitted; such a call gets an empty key, which no check counts
 *     as a repeat.
 *   - `resultKey` is the spilled output's own `content_hash` when the
 *     result was spilled (then `result` holds only a preview, and two
 *     different outputs can share a preview), otherwise the SHA-256 of
 *     `result`.
 *
 * Sub-agent runs are not traversed: whose fault a sub-agent's loop is
 * belongs to an evaluator that can read both.
 */
import { createHash } from "node:crypto";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { canonicalJson } from "../../../pipeline/steps/spec-hash.js";

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

export function actionsOf(run: Run): RunActions {
  const actions: RunAction[] = [];
  for (const message of run.status?.messages ?? []) {
    for (const call of message.toolCalls) {
      actions.push({
        name: call.name,
        argsKey:
          call.args === undefined ? "" : sha256(canonicalJson(call.args)),
        resultKey:
          call.outputRef !== undefined && call.outputRef.contentHash !== ""
            ? `ref:${call.outputRef.contentHash}`
            : `sha256:${sha256(call.result)}`,
        status: call.status,
        step: actions.length + 1,
      });
    }
  }
  const schema = run.spec?.structuredOutputSchema;
  return {
    actions,
    schemaSet: schema !== undefined && Object.keys(schema).length > 0,
    outputPresent: run.status?.structuredOutput !== undefined,
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
