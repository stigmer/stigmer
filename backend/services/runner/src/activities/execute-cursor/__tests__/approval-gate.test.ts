/**
 * Unit tests for the Cursor-harness HITL approval gate logic.
 *
 * Covers the pure policy/grant/prompt builders that drive the preToolUse hook:
 * - built-in tool gating (mutating gated, read-only + unknown allowed)
 * - salient-arg extraction (grant matching key)
 * - grant building from adjudicated approvals
 * - approval-state file content (gated list, MCP policies, grant tokens)
 * - the human-meaningful reinvocation prompt
 *
 * These are deterministic and need no Cursor API key.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import {
  builtInRequiresApproval,
  getBuiltInApprovalMessage,
  getBuiltInGatedList,
  extractArgKey,
} from "../approval-policy.js";
import type { MergedToolPolicy } from "../approval-policy.js";
import {
  buildApprovalGrants,
  buildApprovalState,
  grantToken,
} from "../approval-state.js";
import { buildReinvocationPrompt } from "../prompt-builder.js";

function pending(overrides: Partial<PendingApproval>): PendingApproval {
  return create(PendingApprovalSchema, {
    toolCallId: "call-1",
    toolName: "Write",
    message: "",
    argsPreview: "",
    mcpServerSlug: "",
    ...overrides,
  });
}

describe("builtInRequiresApproval", () => {
  it("gates mutating/destructive built-in tools", () => {
    for (const t of ["Write", "StrReplace", "EditNotebook", "Shell", "Delete"]) {
      expect(builtInRequiresApproval(t)).toBe(true);
    }
  });

  it("allows read-only built-in tools", () => {
    for (const t of ["Read", "Grep", "Glob", "SemanticSearch", "WebFetch", "ReadLints"]) {
      expect(builtInRequiresApproval(t)).toBe(false);
    }
  });

  it("fails open for unknown tools (parity with native, avoids denying auto-approved MCP)", () => {
    expect(builtInRequiresApproval("SomeFutureTool")).toBe(false);
    expect(builtInRequiresApproval("search_services")).toBe(false);
  });

  it("exposes the gated set", () => {
    expect(getBuiltInGatedList()).toEqual(
      expect.arrayContaining(["Write", "StrReplace", "EditNotebook", "Shell", "Delete"]),
    );
  });
});

describe("getBuiltInApprovalMessage", () => {
  it("returns a template for gated tools and undefined otherwise", () => {
    expect(getBuiltInApprovalMessage("Write")).toContain("{{args.path}}");
    expect(getBuiltInApprovalMessage("Shell")).toContain("{{args.command}}");
    expect(getBuiltInApprovalMessage("Read")).toBeUndefined();
  });
});

describe("extractArgKey", () => {
  it("extracts the salient field by priority (path > command > target_notebook)", () => {
    expect(extractArgKey({ path: "a.txt" })).toBe("a.txt");
    expect(extractArgKey({ command: "ls -la" })).toBe("ls -la");
    expect(extractArgKey({ target_notebook: "nb.ipynb" })).toBe("nb.ipynb");
    expect(extractArgKey({ path: "a.txt", command: "ls" })).toBe("a.txt");
  });

  it("returns empty string when no salient field is present", () => {
    expect(extractArgKey({})).toBe("");
    expect(extractArgKey(undefined)).toBe("");
    expect(extractArgKey({ other: 1 })).toBe("");
  });
});

describe("grantToken", () => {
  it("is byte-identical to base64(toolName \\n argKey)", () => {
    expect(grantToken("Write", "gated.txt")).toBe(
      Buffer.from("Write\ngated.txt", "utf-8").toString("base64"),
    );
    expect(grantToken("search_services", "")).toBe(
      Buffer.from("search_services\n", "utf-8").toString("base64"),
    );
  });
});

describe("buildApprovalGrants", () => {
  it("creates an arg-keyed grant for an approved built-in tool", () => {
    const grants = buildApprovalGrants(
      [pending({ toolCallId: "c1", toolName: "Write", argsPreview: JSON.stringify({ path: "gated.txt" }) })],
      new Map([["c1", ApprovalAction.APPROVE]]),
    );
    expect(grants).toEqual([{ toolName: "Write", mcpServerSlug: "", argKey: "gated.txt" }]);
  });

  it("creates a name-only grant for an approved MCP tool", () => {
    const grants = buildApprovalGrants(
      [pending({ toolCallId: "c1", toolName: "apply_x", mcpServerSlug: "planton", argsPreview: JSON.stringify({ path: "ignored" }) })],
      new Map([["c1", ApprovalAction.APPROVE]]),
    );
    expect(grants).toEqual([{ toolName: "apply_x", mcpServerSlug: "planton", argKey: "" }]);
  });

  it("ignores skipped and rejected approvals", () => {
    const grants = buildApprovalGrants(
      [
        pending({ toolCallId: "c1", toolName: "Write", argsPreview: JSON.stringify({ path: "a" }) }),
        pending({ toolCallId: "c2", toolName: "Shell", argsPreview: JSON.stringify({ command: "rm" }) }),
      ],
      new Map([
        ["c1", ApprovalAction.SKIP],
        ["c2", ApprovalAction.REJECT],
      ]),
    );
    expect(grants).toEqual([]);
  });
});

describe("buildApprovalState", () => {
  const mcpPolicies = new Map<string, MergedToolPolicy>([
    ["planton/apply_x", { toolName: "apply_x", mcpServerSlug: "planton", requiresApproval: true, approvalMessage: "Apply X" }],
  ]);

  it("carries the gated list, MCP policies, and grant tokens", () => {
    const grants = [{ toolName: "Write", mcpServerSlug: "", argKey: "gated.txt" }];
    const state = buildApprovalState(mcpPolicies, false, grants);

    expect(state.autoApproveAll).toBe(false);
    expect(state.builtInGatedList).toEqual(expect.arrayContaining(["Write", "Shell"]));
    expect(state.mcpToolPolicies.apply_x).toEqual({ requiresApproval: true, message: "Apply X" });
    expect(state.approvedGrantTokens).toEqual([grantToken("Write", "gated.txt")]);
  });

  it("defaults grants to empty when none provided", () => {
    const state = buildApprovalState(mcpPolicies, true);
    expect(state.autoApproveAll).toBe(true);
    expect(state.approvedGrants).toEqual([]);
    expect(state.approvedGrantTokens).toEqual([]);
  });
});

describe("buildReinvocationPrompt", () => {
  it("describes approved and skipped actions in human terms, not opaque ids", () => {
    const prompt = buildReinvocationPrompt(
      [
        pending({ toolCallId: "c1", toolName: "Write", message: "Write file: gated.txt" }),
        pending({ toolCallId: "c2", toolName: "Shell", message: "Run command: rm -rf build" }),
      ],
      new Map([
        ["c1", ApprovalAction.APPROVE],
        ["c2", ApprovalAction.SKIP],
      ]),
    );

    expect(prompt).toContain("APPROVED");
    expect(prompt).toContain("Write file: gated.txt");
    expect(prompt).toContain("SKIPPED");
    expect(prompt).toContain("Run command: rm -rf build");
    // No opaque tool-call ids leak into the prompt.
    expect(prompt).not.toContain("c1");
    expect(prompt).not.toContain("c2");
  });

  it("falls back to tool name + args preview when no message is set", () => {
    const prompt = buildReinvocationPrompt(
      [pending({ toolCallId: "c1", toolName: "apply_x", mcpServerSlug: "planton", message: "", argsPreview: '{"k":"v"}' })],
      new Map([["c1", ApprovalAction.APPROVE]]),
    );
    expect(prompt).toContain("planton/apply_x");
  });
});
