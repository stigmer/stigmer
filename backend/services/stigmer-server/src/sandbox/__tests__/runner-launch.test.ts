/**
 * Pins the sandbox image's launch contract (runner-launch.ts): the paths an
 * image must hold, written once, and commands that are fresh arrays so a
 * caller that keeps or changes one never changes the next driver's.
 */
import { describe, expect, it } from "vitest";

import {
  RUNNER_ENTRY,
  RUNNER_NODE,
  WAITER_ENTRY,
  runnerCommand,
  waiterCommand,
} from "../runner-launch.js";

describe("the runner launch contract", () => {
  it("starts both entries with the runner's own Node, by absolute path", () => {
    expect(RUNNER_NODE).toBe("/runner/bin/node");
    expect(runnerCommand()).toEqual([
      "/runner/bin/node",
      "/runner/dist/main.js",
    ]);
    expect(waiterCommand()).toEqual([
      "/runner/bin/node",
      "/runner/dist/attach/main.js",
    ]);
    expect(runnerCommand()[1]).toBe(RUNNER_ENTRY);
    expect(waiterCommand()[1]).toBe(WAITER_ENTRY);
  });

  it("keeps the waiter beside the runner it starts (its ../main.js)", () => {
    expect(WAITER_ENTRY.replace("/attach/main.js", "/main.js")).toBe(
      RUNNER_ENTRY,
    );
  });

  it("returns a fresh array on every call", () => {
    const first = runnerCommand();
    first.push("--changed");
    expect(runnerCommand()).toEqual([RUNNER_NODE, RUNNER_ENTRY]);
    expect(waiterCommand()).not.toBe(waiterCommand());
  });
});
