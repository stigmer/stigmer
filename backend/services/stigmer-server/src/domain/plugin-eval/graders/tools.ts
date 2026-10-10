/**
 * The two graders over the run's tool calls, in Claude Code's names
 * (../../score/eval/trace.ts):
 *
 *   - `tool_used`: the number of calls to `tool` whose JSON-encoded input
 *     matches the optional `input_match` regex is between `min` (default 1)
 *     and `max` (default unlimited); `min: 0, max: 0` asserts the tool was
 *     never called;
 *   - `tool_order`: both tools were called, and the first call matching
 *     `before` precedes the first call matching `after`.
 *
 * A tool name compares exactly, except Claude Code's older `Task`, which
 * names `Agent` as it does there. Input patterns run in the pattern pool,
 * each under its own deadline from when a worker takes it (patterns.ts),
 * so a `tool_order`'s second pattern is never cut short by the first's
 * wait or run.
 *
 * Proven by __tests__/graders.test.ts.
 */
import type { EvalGraderCheck, EvalToolRef } from "@stigmer/plugin-package";
import { CLAUDE_TOOL_ALIASES } from "@stigmer/tool-vocabulary";

import type { EvalToolCall, EvalTrace } from "../../score/eval/trace.js";
import type { PatternRunner } from "./patterns.js";
import { PATTERN_DEADLINE_MS } from "./patterns.js";
import type { GraderVerdict } from "./verdict.js";
import {
  PATTERN_POOL_BUSY_REASON,
  PATTERN_TIME_LIMIT_REASON,
  invalidPatternReason,
} from "./verdict.js";

type ToolUsedCheck = Extract<EvalGraderCheck, { type: "tool_used" }>;
type ToolOrderCheck = Extract<EvalGraderCheck, { type: "tool_order" }>;

function sameTool(wanted: string, called: string): boolean {
  const canonical = (name: string): string =>
    CLAUDE_TOOL_ALIASES.get(name) ?? name;
  return canonical(wanted) === canonical(called);
}

/**
 * The positions (into `calls`) of the calls to `ref.tool` whose input
 * matches `ref.inputMatch`, or the verdict when the pattern could not run.
 */
async function matchingCalls(
  ref: EvalToolRef,
  calls: ReadonlyArray<EvalToolCall>,
  patterns: PatternRunner,
  budgetMs: number,
): Promise<{ readonly positions: ReadonlyArray<number> } | GraderVerdict> {
  const named: number[] = [];
  calls.forEach((call, position) => {
    if (sameTool(ref.tool, call.name)) {
      named.push(position);
    }
  });
  if (ref.inputMatch === undefined || named.length === 0) {
    return { positions: named };
  }
  const answer = await patterns.count({
    pattern: ref.inputMatch,
    flags: "",
    texts: named.map((position) => calls[position]?.input ?? ""),
    limit: 1,
    budgetMs,
  });
  switch (answer.kind) {
    case "timeout":
      return { notGraded: PATTERN_TIME_LIMIT_REASON };
    case "busy":
      return { notGraded: PATTERN_POOL_BUSY_REASON };
    case "invalid":
      return { notGraded: invalidPatternReason(answer.message) };
    case "counts":
      return {
        positions: named.filter((_, index) => (answer.counts[index] ?? 0) > 0),
      };
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = answer;
      return exhausted;
    }
  }
}

function describeRef(ref: EvalToolRef): string {
  return ref.inputMatch === undefined
    ? `'${ref.tool}'`
    : `'${ref.tool}' with matching input`;
}

export async function gradeToolUsed(
  check: ToolUsedCheck,
  trace: EvalTrace,
  patterns: PatternRunner,
): Promise<GraderVerdict> {
  const ref: EvalToolRef =
    check.inputMatch === undefined
      ? { tool: check.tool }
      : { tool: check.tool, inputMatch: check.inputMatch };
  const matched = await matchingCalls(
    ref,
    trace.toolCalls,
    patterns,
    PATTERN_DEADLINE_MS,
  );
  if (!("positions" in matched)) {
    return matched;
  }
  const count = matched.positions.length;
  const range =
    check.max === undefined
      ? `at least ${check.min}`
      : check.min === check.max
        ? `exactly ${check.min}`
        : `${check.min} to ${check.max}`;
  const within =
    count >= check.min && (check.max === undefined || count <= check.max);
  const steps =
    count === 0
      ? ""
      : ` (step ${matched.positions.map((position) => position + 1).join(", ")})`;
  return {
    passed: within,
    reason: `${count} call(s) to ${describeRef(ref)}${steps}; expected ${range}`,
  };
}

export async function gradeToolOrder(
  check: ToolOrderCheck,
  trace: EvalTrace,
  patterns: PatternRunner,
): Promise<GraderVerdict> {
  const before = await matchingCalls(
    check.before,
    trace.toolCalls,
    patterns,
    PATTERN_DEADLINE_MS,
  );
  if (!("positions" in before)) {
    return before;
  }
  const after = await matchingCalls(
    check.after,
    trace.toolCalls,
    patterns,
    PATTERN_DEADLINE_MS,
  );
  if (!("positions" in after)) {
    return after;
  }
  const firstBefore = before.positions[0];
  const firstAfter = after.positions[0];
  if (firstBefore === undefined || firstAfter === undefined) {
    const missing = [
      ...(firstBefore === undefined ? [describeRef(check.before)] : []),
      ...(firstAfter === undefined ? [describeRef(check.after)] : []),
    ];
    return { passed: false, reason: `no call to ${missing.join(" or ")}` };
  }
  return firstBefore < firstAfter
    ? {
        passed: true,
        reason: `${describeRef(check.before)} at step ${firstBefore + 1} precedes ${describeRef(check.after)} at step ${firstAfter + 1}`,
      }
    : {
        passed: false,
        reason: `${describeRef(check.after)} at step ${firstAfter + 1} came before ${describeRef(check.before)} at step ${firstBefore + 1}`,
      };
}
