/**
 * Pins the sandbox image's launch contract (runner-launch.ts): the paths an
 * image must hold and the user and home the drivers run the runner as,
 * written once, and commands that are fresh arrays so a caller that keeps
 * or changes one never changes the next driver's, and the agent's home read
 * from a deployment's runner variables by the runner's own rule. The drivers' own suites
 * assert against these constants; the literals live here alone.
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_HOME,
  RUNNER_ENTRY,
  RUNNER_HOME,
  RUNNER_NODE,
  RUNNER_START,
  RUNNER_UID,
  WAITER_ENTRY,
  agentHomeOf,
  runnerCommand,
  waiterCommand,
} from "../runner-launch.js";

describe("the runner launch contract", () => {
  it("starts both entries through the layer's start script, by absolute path", () => {
    expect(RUNNER_START).toBe("/runner/bin/start");
    expect(runnerCommand()).toEqual([
      "/runner/bin/start",
      "/runner/dist/main.js",
    ]);
    expect(waiterCommand()).toEqual([
      "/runner/bin/start",
      "/runner/dist/attach/main.js",
    ]);
    expect(runnerCommand()[1]).toBe(RUNNER_ENTRY);
    expect(waiterCommand()[1]).toBe(WAITER_ENTRY);
  });

  it("keeps the runner's Node beside the start script that execs it", () => {
    expect(RUNNER_NODE).toBe("/runner/bin/node");
    expect(RUNNER_START.replace(/\/start$/, "/node")).toBe(RUNNER_NODE);
  });

  it("runs the runner as root, with root's home", () => {
    expect(RUNNER_UID).toBe(0);
    expect(RUNNER_HOME).toBe("/root");
  });

  it("names the agent's home where the runner puts it when the deployment names none", () => {
    expect(AGENT_HOME).toBe("/home/stigmer-agent");
  });

  it("reads the agent's home a deployment names as the runner does: trimmed, a blank one unset", () => {
    expect(agentHomeOf({})).toBe(AGENT_HOME);
    expect(agentHomeOf({ STIGMER_AGENT_HOME: " /data/agent " })).toBe("/data/agent");
    expect(agentHomeOf({ STIGMER_AGENT_HOME: "  " })).toBe(AGENT_HOME);
  });

  it("keeps the waiter beside the runner it starts (its ../main.js)", () => {
    expect(WAITER_ENTRY.replace("/attach/main.js", "/main.js")).toBe(
      RUNNER_ENTRY,
    );
  });

  it("returns a fresh array on every call", () => {
    const first = runnerCommand();
    first.push("--changed");
    expect(runnerCommand()).toEqual([RUNNER_START, RUNNER_ENTRY]);
    expect(waiterCommand()).not.toBe(waiterCommand());
  });
});
