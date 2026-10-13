/**
 * Pins the run-health checks over a turn, read from its session events
 * through the one adapter (actions.ts):
 *   - `no-repeated-calls` fails at three consecutive calls with the same
 *     tool, inputs and result, and never at two; a poll whose result
 *     changes, a spilled result whose preview head repeats but whose
 *     content hash differs, and a call whose inputs are not known never
 *     count as repeats, while three calls with an empty input do;
 *   - `last-action-succeeded` fails when the run's last call FAILED (its
 *     result is an error) or was stopped (its turn ended before it
 *     returned), and passes when a failure was recovered from;
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
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { CriterionResult } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type { ToolUseState } from "@stigmer/session-log";

import type { RunTranscript } from "../../../session/events/run-events.js";
import { RunEventsBuilder } from "../../../session/events/__tests__/run-events-fixture.js";
import type { FixtureCall } from "../../../session/events/__tests__/run-events-fixture.js";
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
  readonly status?: ToolUseState;
}

let callCount = 0;

function call(spec: CallSpec = {}): FixtureCall {
  const status = spec.status ?? "completed";
  return {
    id: `c${++callCount}`,
    name: spec.name ?? "echo",
    ...(spec.args === undefined ? {} : { input: spec.args }),
    // An interrupted call never returned: its turn ended first.
    ...(status === "stopped"
      ? {}
      : { result: spec.result ?? `result for ${SECRET_TEXT}` }),
    ...(status === "failed" ? { isError: true } : {}),
    ...(spec.contentHash === undefined
      ? {}
      : { offloadedHash: spec.contentHash }),
  };
}

function runWith(
  calls: ReadonlyArray<FixtureCall>,
  options: { schema?: JsonObject; output?: JsonObject } = {},
): RunTranscript {
  const run = create(RunSchema, {
    metadata: { id: "run_1", org: "org_1" },
    spec: {
      ...(options.schema === undefined
        ? {}
        : { structuredOutputSchema: options.schema }),
    },
    status: { phase: RunPhase.RUN_COMPLETED },
  });
  const events = new RunEventsBuilder("run_1");
  // Calls spread across messages, as a turn makes them.
  for (const c of calls) {
    events.turnMessage("", [c]);
  }
  if (options.output !== undefined) {
    events.structuredOutput(options.output);
  }
  events.runStatus("completed");
  return { run, events: events.build() };
}

function verdict(run: RunTranscript, name: string): CheckVerdict {
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
    // The log requires every tool use's input, so the empty key only
    // reaches the checks from a view built without one.
    const unknown = {
      name: "echo",
      argsKey: "",
      resultKey: "sha256:same",
      status: "completed" as const,
    };
    const health = gradeRunHealth({
      actions: [1, 2, 3].map((step) => ({ ...unknown, step })),
      schemaSet: false,
      outputPresent: false,
    });
    expect(
      health.verdicts.find((v) => v.name === NO_REPEATED_CALLS)?.result,
    ).toBe(CriterionResult.passed);
  });

  it("counts a call whose input is empty like any other", () => {
    const run = runWith([call(), call(), call()]);
    expect(verdict(run, NO_REPEATED_CALLS).result).toBe(CriterionResult.failed);
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
        status: "failed",
      }),
    ]);
    const v = verdict(run, LAST_ACTION_SUCCEEDED);
    expect(v.result).toBe(CriterionResult.failed);
    expect(v.reason).toBe("ended on a failed action: create_ticket (step 2)");
  });

  it("fails when the last call was stopped", () => {
    const run = runWith([
      call({ args, status: "stopped" }),
    ]);
    expect(verdict(run, LAST_ACTION_SUCCEEDED).result).toBe(
      CriterionResult.failed,
    );
  });

  it("passes when a failure was recovered from", () => {
    const run = runWith([
      call({ args, status: "failed" }),
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
        call({ args, status: "failed" }),
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
