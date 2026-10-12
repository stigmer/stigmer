// Pins the local execution target's fixture accessors before setup and its
// teardown of a target that never booted: an accessor called too early names
// the missing setup rather than handing back nothing, and a teardown after a
// failed setup closes only what exists. Constructing the target boots
// nothing, so this runs in the unit arms with no server.
import { describe, expect, it } from "vitest";

import { LocalExecutionTarget } from "../local-execution";

describe("the local execution target before setup", () => {
  it("names the missing setup when its trace collector is asked for", () => {
    expect(() => new LocalExecutionTarget().traceCollector()).toThrow("setup() must be called before traceCollector()");
  });

  it("tears down a target that never booted without touching anything", async () => {
    await expect(new LocalExecutionTarget().teardown()).resolves.toBeUndefined();
  });
});
