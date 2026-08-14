/**
 * Unit pins for the plan-mode rule builder.
 *
 * Since issue #754 the rules carry ONLY plan mode's write-deny: the read
 * boundary is structural (virtual-rooted backends confine every path to the
 * workspace), so there is no workspace-root glob, no escaping, and no rule
 * ordering left to protect. The single rule's SHAPE is still the security
 * boundary for writes — "/**" must stay the match-all virtual pattern and
 * the operation class must stay `write` (deepagents evaluates
 * first-match-wins with a permissive default, so reads flow by omission).
 * End-to-end behavior is pinned against the real deepagents runtime in
 * execute-deep-agent/__tests__/plan-mode-path-normalization.test.ts.
 */

import { describe, it, expect } from "vitest";
import { buildPlanModePermissions } from "../plan-mode-permissions.js";

describe("buildPlanModePermissions", () => {
  it("builds exactly the write-deny policy in the virtual dialect", () => {
    expect(buildPlanModePermissions()).toEqual([
      { operations: ["write"], paths: ["/**"], mode: "deny" },
    ]);
  });

  it("carries no read rules — the read boundary is structural, not policy", () => {
    const operations = buildPlanModePermissions().flatMap((rule) => rule.operations);
    expect(operations).not.toContain("read");
  });
});
