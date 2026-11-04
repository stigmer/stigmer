/**
 * The runtime's git in the agent's clone never runs the clone's hooks or
 * fsmonitor (runtime-git.ts, stigmer#2962): the substrate passes the two
 * settings as arguments, and write-back and provisioning hand them to every
 * git in a command through git's per-command configuration variables,
 * appended after any the environment already carries. The real-git proofs
 * are the substrate's and write-back's own suites.
 */
import { describe, expect, it } from "vitest";

import { RUNTIME_GIT_CONFIG, runtimeGitEnv } from "../runtime-git.js";

describe("the runtime's git settings", () => {
  it("names exactly the two settings as arguments", () => {
    expect(RUNTIME_GIT_CONFIG).toEqual(["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"]);
  });

  it("hands them over as per-command configuration, after what the environment already carries", () => {
    expect(runtimeGitEnv({})).toEqual({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: "/dev/null",
    });
    expect(runtimeGitEnv({ GIT_CONFIG_COUNT: "1" })).toEqual({
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_1: "core.fsmonitor",
      GIT_CONFIG_VALUE_1: "false",
      GIT_CONFIG_KEY_2: "core.hooksPath",
      GIT_CONFIG_VALUE_2: "/dev/null",
    });
    expect(runtimeGitEnv({ GIT_CONFIG_COUNT: "nonsense" }).GIT_CONFIG_COUNT).toBe("2");
  });
});
