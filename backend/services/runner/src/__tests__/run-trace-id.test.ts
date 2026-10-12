/**
 * One trace per run (`run-trace-id.ts`): a root span started inside a
 * run's execution context takes a trace id derived from the run id, so
 * every turn of a run lands in one trace; outside a run, and for every span
 * id, the ids stay random.
 */

import { describe, expect, it } from "vitest";

import { RunTraceIdGenerator, traceIdOfRun } from "../run-trace-id.js";
import { runWithExecutionContext } from "../shared/execution-context.js";

const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_16 = /^[0-9a-f]{16}$/;

describe("traceIdOfRun", () => {
  it("is 32 lowercase hex characters, stable for a run, different between runs", () => {
    const id = traceIdOfRun("run_01abc");
    expect(id).toMatch(HEX_32);
    expect(traceIdOfRun("run_01abc")).toBe(id);
    expect(traceIdOfRun("run_01abd")).not.toBe(id);
  });
});

describe("RunTraceIdGenerator", () => {
  const generator = new RunTraceIdGenerator();

  it("gives a root span inside a run's context the run's trace id", async () => {
    const inside = await runWithExecutionContext("run_01abc", async () => generator.generateTraceId());
    expect(inside).toBe(traceIdOfRun("run_01abc"));
  });

  it("keeps two turns of one run in one trace", async () => {
    const first = await runWithExecutionContext("run_01abc", async () => generator.generateTraceId());
    const second = await runWithExecutionContext("run_01abc", async () => generator.generateTraceId(), "turn-key");
    expect(second).toBe(first);
  });

  it("gives a span outside any run a random, valid trace id", () => {
    const a = generator.generateTraceId();
    const b = generator.generateTraceId();
    expect(a).toMatch(HEX_32);
    expect(a).not.toBe("0".repeat(32));
    expect(b).not.toBe(a);
  });

  it("keeps span ids random, inside a run too", async () => {
    const ids = await runWithExecutionContext("run_01abc", async () => [generator.generateSpanId(), generator.generateSpanId()]);
    expect(ids[0]).toMatch(HEX_16);
    expect(ids[1]).toMatch(HEX_16);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
