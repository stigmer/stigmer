/**
 * Pins the run-health checks over a run's transcript, read through the one
 * adapter (actions.ts):
 *   - `no-repeated-calls` fails at three consecutive calls with the same
 *     tool, inputs and result, and never at two; a poll whose result
 *     changes, a spilled result whose preview head repeats but whose
 *     content hash differs, and a row whose inputs are not yet known never
 *     count as repeats;
 *   - `last-action-succeeded` fails when the run's last call FAILED or was
 *     INTERRUPTED, and passes when a failure was recovered from;
 *   - `structured-output-delivered` applies only when a schema was set;
 *   - a run with no tool calls is not applicable on the call checks;
 *   - no reason quotes a call's inputs or result;
 *   - the evaluator version is pinned, so changing a check or a threshold
 *     is a deliberate, visible act.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { CriterionResult } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";

import { actionsOf } from "../actions.js";
import {
  LAST_ACTION_SUCCEEDED,
  NO_REPEATED_CALLS,
  RUN_HEALTH_EVALUATOR_VERSION,
  STRUCTURED_OUTPUT_DELIVERED,
  gradeRunHealth,
} from "../checks.js";
import type { CheckVerdict } from "../checks.js";

const SECRET_TEXT = "words-a-person-typed";

interface CallSpec {
  readonly name?: string;
  readonly args?: JsonObject;
  readonly result?: string;
  readonly contentHash?: string;
  readonly status?: ToolCallStatus;
}

function call(spec: CallSpec = {}) {
  return {
    name: spec.name ?? "echo",
    ...(spec.args === undefined ? {} : { args: spec.args }),
    result: spec.result ?? `result for ${SECRET_TEXT}`,
    status: spec.status ?? ToolCallStatus.TOOL_CALL_COMPLETED,
    ...(spec.contentHash === undefined
      ? {}
      : {
          outputRef: {
            storageKey: "artifacts/run_1/out",
            contentHash: spec.contentHash,
          },
        }),
  };
}

function runWith(
  calls: ReadonlyArray<ReturnType<typeof call>>,
  options: { schema?: JsonObject; output?: JsonObject } = {},
): Run {
  return create(RunSchema, {
    metadata: { id: "run_1", org: "org_1" },
    spec: {
      ...(options.schema === undefined
        ? {}
        : { structuredOutputSchema: options.schema }),
    },
    status: {
      phase: RunPhase.RUN_COMPLETED,
      // Calls spread across messages, as a transcript carries them.
      messages: calls.map((c) => ({ toolCalls: [c] })),
      ...(options.output === undefined
        ? {}
        : { structuredOutput: options.output }),
    },
  });
}

function verdict(run: Run, name: string): CheckVerdict {
  const found = gradeRunHealth(actionsOf(run)).verdicts.find(
    (v) => v.name === name,
  );
  if (found === undefined) {
    throw new Error(`no verdict ${name}`);
  }
  return found;
}

const args = { text: SECRET_TEXT };

describe("no-repeated-calls", () => {
  it("passes at two equal calls in a row", () => {
    const run = runWith([call({ args }), call({ args })]);
    expect(verdict(run, NO_REPEATED_CALLS).result).toBe(CriterionResult.passed);
  });

  it("fails at three equal calls in a row, naming the tool and the steps", () => {
    const run = runWith([
      call({ name: "lookup", args: { q: "x" } }),
      call({ args }),
      call({ args }),
      call({ args }),
    ]);
    const v = verdict(run, NO_REPEATED_CALLS);
    expect(v.result).toBe(CriterionResult.failed);
    expect(v.reason).toBe(
      "echo was called 3 times in a row with the same inputs and the same result (steps 2 to 4)",
    );
  });

  it("does not count a poll whose result changes", () => {
    const run = runWith([
      call({ args, result: "pending" }),
      call({ args, result: "pending " }),
      call({ args, result: "done" }),
    ]);
    expect(verdict(run, NO_REPEATED_CALLS).result).toBe(CriterionResult.passed);
  });

  it("does not count spilled results that share a preview head but differ in content", () => {
    const run = runWith([
      call({ args, result: "same head", contentHash: "aaa" }),
      call({ args, result: "same head", contentHash: "bbb" }),
      call({ args, result: "same head", contentHash: "ccc" }),
    ]);
    expect(verdict(run, NO_REPEATED_CALLS).result).toBe(CriterionResult.passed);
  });

  it("counts spilled results whose content hash repeats", () => {
    const run = runWith([
      call({ args, result: "head", contentHash: "aaa" }),
      call({ args, result: "head", contentHash: "aaa" }),
      call({ args, result: "head", contentHash: "aaa" }),
    ]);
    expect(verdict(run, NO_REPEATED_CALLS).result).toBe(CriterionResult.failed);
  });

  it("never counts a row whose inputs are not known yet", () => {
    const run = runWith([call(), call(), call()]);
    expect(verdict(run, NO_REPEATED_CALLS).result).toBe(CriterionResult.passed);
  });

  it("reads equal inputs regardless of key order", () => {
    const run = runWith([
      call({ args: { a: 1, b: 2 } }),
      call({ args: { b: 2, a: 1 } }),
      call({ args: { a: 1, b: 2 } }),
    ]);
    expect(verdict(run, NO_REPEATED_CALLS).result).toBe(CriterionResult.failed);
  });
});

describe("last-action-succeeded", () => {
  it("fails when the last call FAILED", () => {
    const run = runWith([
      call({ args }),
      call({
        name: "create_ticket",
        args,
        status: ToolCallStatus.TOOL_CALL_FAILED,
      }),
    ]);
    const v = verdict(run, LAST_ACTION_SUCCEEDED);
    expect(v.result).toBe(CriterionResult.failed);
    expect(v.reason).toBe("ended on a failed action: create_ticket (step 2)");
  });

  it("fails when the last call was INTERRUPTED", () => {
    const run = runWith([
      call({ args, status: ToolCallStatus.TOOL_CALL_INTERRUPTED }),
    ]);
    expect(verdict(run, LAST_ACTION_SUCCEEDED).result).toBe(
      CriterionResult.failed,
    );
  });

  it("passes when a failure was recovered from", () => {
    const run = runWith([
      call({ args, status: ToolCallStatus.TOOL_CALL_FAILED }),
      call({ args: { text: "retry" } }),
    ]);
    expect(verdict(run, LAST_ACTION_SUCCEEDED).result).toBe(
      CriterionResult.passed,
    );
  });
});

describe("a run with no tool calls", () => {
  it("is not applicable on the call checks and passes overall", () => {
    const run = runWith([]);
    expect(verdict(run, NO_REPEATED_CALLS).result).toBe(
      CriterionResult.not_applicable,
    );
    expect(verdict(run, LAST_ACTION_SUCCEEDED).result).toBe(
      CriterionResult.not_applicable,
    );
    expect(gradeRunHealth(actionsOf(run)).passed).toBe(true);
  });
});

describe("structured-output-delivered", () => {
  const schema = {
    type: "object",
    properties: { summary: { type: "string" } },
  };

  it("is not applicable without a schema", () => {
    expect(verdict(runWith([]), STRUCTURED_OUTPUT_DELIVERED).result).toBe(
      CriterionResult.not_applicable,
    );
  });

  it("fails when a schema was set and no output was given", () => {
    const run = runWith([], { schema });
    expect(verdict(run, STRUCTURED_OUTPUT_DELIVERED).result).toBe(
      CriterionResult.failed,
    );
    expect(gradeRunHealth(actionsOf(run)).passed).toBe(false);
  });

  it("passes when a schema was set and the output was given", () => {
    const run = runWith([], { schema, output: { summary: "ok" } });
    expect(verdict(run, STRUCTURED_OUTPUT_DELIVERED).result).toBe(
      CriterionResult.passed,
    );
  });
});

describe("the grade", () => {
  it("quotes no input and no result in any reason", () => {
    const run = runWith(
      [
        call({ args }),
        call({ args }),
        call({ args, status: ToolCallStatus.TOOL_CALL_FAILED }),
      ],
      { schema: { type: "object" } },
    );
    const health = gradeRunHealth(actionsOf(run));
    expect(health.passed).toBe(false);
    for (const v of health.verdicts) {
      expect(v.reason).not.toContain(SECRET_TEXT);
    }
  });

  it("pins the evaluator version", () => {
    expect(RUN_HEALTH_EVALUATOR_VERSION).toBe(
      "62928058617a4f426c20e3c192728599a6f37eaf659176119a195754cdc5f1a7",
    );
  });
});
