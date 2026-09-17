// Pins the pure arm of the execution target's enforcing lane
// (harness/enforcing-execution-lane.ts): the boot-reading line. The lane
// itself boots an issuer, a Temporal, a server, a mock and a runner and is
// exercised by the runner-as-subject conformance suite; what is decided
// without a process is decided here — that the one line a slow boot leaves
// behind carries both readings and says what a slow one means.
import { describe, expect, it } from "vitest";

import { describeLaneBoot } from "../enforcing-execution-lane";

describe("describeLaneBoot", () => {
  it("names both halves of the boot in seconds and blames the machine, not an arm", () => {
    const line = describeLaneBoot({ peopleMs: 6_250, runnerMs: 4_020 });
    expect(line).toContain("[enforcing-execution-lane] booted");
    expect(line).toContain("in 6.3 s");
    expect(line).toContain("in 4.0 s");
    expect(line).toMatch(/load, not an arm/);
  });

  it("is one line, so a hook-timeout log stays greppable", () => {
    expect(describeLaneBoot({ peopleMs: 0, runnerMs: 0 })).not.toContain("\n");
  });
});
