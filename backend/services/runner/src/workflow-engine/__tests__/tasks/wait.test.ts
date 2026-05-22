import { describe, it, expect, vi } from "vitest";
import { WaitTaskBuilder, durationToMs } from "../../tasks/wait.js";
import { createState } from "../../state.js";
import type { WaitTaskDef, TaskExecutionContext } from "../../types.js";

const notAvailable = () => { throw new Error("not available in test"); };

function makeCtx(sleepFn?: (ms: number) => Promise<void>): TaskExecutionContext {
  return {
    evaluateExpressions: async () => ({}),
    doc: { document: { dsl: "1.0.0", name: "test" }, do: [] },
    sleep: sleepFn ?? (async () => {}),
    listen: notAvailable,
    runCommand: notAvailable,
    runWorkflow: notAvailable,
    awaitHumanInput: notAvailable,
    callHttp: notAvailable,
    callGrpc: notAvailable,
    callFunction: notAvailable,
    callAgent: notAvailable,
  };
}

describe("durationToMs", () => {
  it("converts seconds to milliseconds", () => {
    expect(durationToMs({ seconds: 5 })).toBe(5_000);
  });

  it("converts minutes to milliseconds", () => {
    expect(durationToMs({ minutes: 2 })).toBe(120_000);
  });

  it("converts hours to milliseconds", () => {
    expect(durationToMs({ hours: 1 })).toBe(3_600_000);
  });

  it("converts days to milliseconds", () => {
    expect(durationToMs({ days: 1 })).toBe(86_400_000);
  });

  it("converts milliseconds field directly", () => {
    expect(durationToMs({ milliseconds: 750 })).toBe(750);
  });

  it("sums all fields additively", () => {
    const result = durationToMs({
      days: 1,
      hours: 2,
      minutes: 30,
      seconds: 15,
      milliseconds: 500,
    });
    expect(result).toBe(
      86_400_000 + 7_200_000 + 1_800_000 + 15_000 + 500,
    );
  });

  it("returns 0 for empty duration", () => {
    expect(durationToMs({})).toBe(0);
  });

  it("handles partial fields (minutes + seconds only)", () => {
    expect(durationToMs({ minutes: 1, seconds: 30 })).toBe(90_000);
  });
});

describe("WaitTaskBuilder", () => {
  it("calls ctx.sleep with computed milliseconds", async () => {
    const sleepFn = vi.fn(async () => {});
    const taskDef: WaitTaskDef = {
      kind: "wait",
      wait: { seconds: 10 },
    };

    const builder = new WaitTaskBuilder("delay", taskDef);
    const executor = builder.build();
    const state = createState();

    await executor(null, state, makeCtx(sleepFn));

    expect(sleepFn).toHaveBeenCalledWith(10_000);
  });

  it("calls ctx.sleep with multi-field duration", async () => {
    const sleepFn = vi.fn(async () => {});
    const taskDef: WaitTaskDef = {
      kind: "wait",
      wait: { minutes: 2, seconds: 30 },
    };

    const builder = new WaitTaskBuilder("pause", taskDef);
    const executor = builder.build();
    const state = createState();

    await executor(null, state, makeCtx(sleepFn));

    expect(sleepFn).toHaveBeenCalledWith(150_000);
  });

  it("returns undefined (wait produces no output)", async () => {
    const taskDef: WaitTaskDef = {
      kind: "wait",
      wait: { seconds: 1 },
    };

    const builder = new WaitTaskBuilder("nap", taskDef);
    const executor = builder.build();
    const state = createState();
    const result = await executor(null, state, makeCtx());

    expect(result).toBeUndefined();
  });

  it("skips sleep for zero duration", async () => {
    const sleepFn = vi.fn(async () => {});
    const taskDef: WaitTaskDef = {
      kind: "wait",
      wait: {},
    };

    const builder = new WaitTaskBuilder("noop", taskDef);
    const executor = builder.build();
    const state = createState();
    const result = await executor(null, state, makeCtx(sleepFn));

    expect(sleepFn).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("does not modify workflow state", async () => {
    const taskDef: WaitTaskDef = {
      kind: "wait",
      wait: { seconds: 5 },
    };

    const builder = new WaitTaskBuilder("timer", taskDef);
    const executor = builder.build();
    const state = createState();
    state.addData({ existing: "value" });

    await executor(null, state, makeCtx());

    expect(state.data.existing).toBe("value");
  });

  it("shouldRun always returns true", async () => {
    const taskDef: WaitTaskDef = {
      kind: "wait",
      wait: { seconds: 1 },
    };

    const builder = new WaitTaskBuilder("timer", taskDef);
    expect(await builder.shouldRun()).toBe(true);
  });

  it("propagates sleep errors that are not cancellation", async () => {
    const sleepFn = vi.fn(async () => {
      throw new Error("unexpected timer failure");
    });
    const taskDef: WaitTaskDef = {
      kind: "wait",
      wait: { seconds: 5 },
    };

    const builder = new WaitTaskBuilder("failing", taskDef);
    const executor = builder.build();
    const state = createState();

    await expect(executor(null, state, makeCtx(sleepFn))).rejects.toThrow(
      "unexpected timer failure",
    );
  });
});
