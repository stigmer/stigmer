/**
 * Unit pins for the plan-mode rule builder (issue #528).
 *
 * The rule ORDER and SHAPE are the security boundary: deepagents evaluates
 * first-match-wins with a permissive default, so the workspace read-allow
 * must precede the read-deny, and the deny patterns must be the match-all
 * "/**". These tests pin the built value; the boundary's end-to-end
 * behavior (including matcher semantics for escaped roots and symlinked
 * platform paths) is pinned against the real deepagents runtime in
 * execute-deep-agent/__tests__/plan-mode-path-normalization.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  buildPlanModePermissions,
  escapeGlobLiteral,
} from "../plan-mode-permissions.js";

describe("buildPlanModePermissions", () => {
  it("builds the policy in enforcement order: workspace read-allow, then read-deny, then write-deny", () => {
    expect(buildPlanModePermissions("/ws/session-1/repo")).toEqual([
      { operations: ["read"], paths: ["/ws/session-1/repo/**"] },
      { operations: ["read"], paths: ["/**"], mode: "deny" },
      { operations: ["write"], paths: ["/**"], mode: "deny" },
    ]);
  });

  it("canonicalizes the root before building the pattern", () => {
    // Enforcement canonicalizes incoming paths (no trailing separator,
    // collapsed slashes) before matching — a pattern built from a raw
    // trailing-slash root would silently match nothing.
    const [allow] = buildPlanModePermissions("/ws//session-1/repo/");
    expect(allow.paths).toEqual(["/ws/session-1/repo/**"]);
  });

  it("glob-escapes the root so special characters match literally", () => {
    const [allow] = buildPlanModePermissions("/Users/x/My (work) [v2]");
    expect(allow.paths).toEqual(["/Users/x/My \\(work\\) \\[v2\\]/**"]);
  });
});

describe("escapeGlobLiteral", () => {
  it("escapes every micromatch metacharacter", () => {
    expect(escapeGlobLiteral("a*b?c(d)e[f]g{h}i!j+k@l")).toBe(
      "a\\*b\\?c\\(d\\)e\\[f\\]g\\{h\\}i\\!j\\+k\\@l",
    );
  });

  it("escapes backslashes themselves", () => {
    expect(escapeGlobLiteral("a\\b")).toBe("a\\\\b");
  });

  it("leaves plain path characters alone", () => {
    expect(escapeGlobLiteral("/ws/session-1/repo.dir")).toBe(
      "/ws/session-1/repo.dir",
    );
  });
});
