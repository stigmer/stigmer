/**
 * Pins the agent-sandbox driver's own settings: the idle window and the
 * sweep interval default to the substrate driver's (330 s and 30 s), take
 * positive whole seconds from STIGMER_SANDBOX_AGENT_SANDBOX_*, and refuse
 * anything else, and an interval longer than the window, naming the
 * variable.
 */
import { describe, expect, it } from "vitest";

import { newAgentSandboxSettingsFromEnv } from "../config.js";

describe("the agent-sandbox driver's settings", () => {
  it("default to an idle session suspended at 330 s on a 30-second sweep", () => {
    expect(newAgentSandboxSettingsFromEnv({})).toEqual({
      suspendAfterSeconds: 330,
      sweepIntervalSeconds: 30,
    });
  });

  it("take whole seconds from the environment, blank meaning the default", () => {
    expect(
      newAgentSandboxSettingsFromEnv({
        STIGMER_SANDBOX_AGENT_SANDBOX_SUSPEND_AFTER_SECONDS: " 600 ",
        STIGMER_SANDBOX_AGENT_SANDBOX_SWEEP_INTERVAL_SECONDS: "",
      }),
    ).toEqual({ suspendAfterSeconds: 600, sweepIntervalSeconds: 30 });
  });

  it.each(["0", "-5", "1.5", "soon"])(
    "refuse %s as a number of seconds",
    (raw) => {
      expect(() =>
        newAgentSandboxSettingsFromEnv({
          STIGMER_SANDBOX_AGENT_SANDBOX_SWEEP_INTERVAL_SECONDS: raw,
        }),
      ).toThrowError(
        `STIGMER_SANDBOX_AGENT_SANDBOX_SWEEP_INTERVAL_SECONDS must be a positive whole number of seconds; got ${raw}`,
      );
    },
  );

  it("refuse a sweep interval longer than the idle window", () => {
    expect(() =>
      newAgentSandboxSettingsFromEnv({
        STIGMER_SANDBOX_AGENT_SANDBOX_SUSPEND_AFTER_SECONDS: "60",
        STIGMER_SANDBOX_AGENT_SANDBOX_SWEEP_INTERVAL_SECONDS: "90",
      }),
    ).toThrowError(
      "STIGMER_SANDBOX_AGENT_SANDBOX_SWEEP_INTERVAL_SECONDS (90) must not exceed STIGMER_SANDBOX_AGENT_SANDBOX_SUSPEND_AFTER_SECONDS (60): a sandbox would sleep a whole interval late",
    );
  });
});
