/**
 * Unit tests for the Cursor-harness HITL approval gate logic.
 *
 * The crux this suite guards: the Cursor preToolUse hook and the SDK event
 * stream use DIFFERENT tool taxonomies for the same operation (hook
 * `Write`/`Shell`/`Delete` with `file_path`/`command`; stream
 * `edit`/`shell`/`delete` with `path`/`command`). Correlation therefore keys on
 * a canonical {@link approvalCategory} + the salient resource VALUE, not the raw
 * tool name. These tests assert that invariant against BOTH taxonomies so a
 * future SDK tool rename fails loudly instead of silently disabling the gate.
 *
 * Deterministic; no Cursor API key required.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import {
  approvalCategory,
  builtInRequiresApproval,
  getBuiltInApprovalMessage,
  getBuiltInGatedList,
  getBuiltInGatedCategories,
  extractArgKey,
} from "../approval-policy.js";
import type { MergedToolPolicy } from "../approval-policy.js";
import {
  buildApprovalGrants,
  buildApprovalState,
  grantToken,
  toolIdentity,
} from "../approval-state.js";
import { buildReinvocationPrompt } from "../prompt-builder.js";

function pending(overrides: Partial<PendingApproval>): PendingApproval {
  return create(PendingApprovalSchema, {
    toolCallId: "call-1",
    toolName: "edit",
    message: "",
    argsPreview: "",
    mcpServerSlug: "",
    ...overrides,
  });
}

// The real ground-truth taxonomies (captured from @cursor/sdk via live probe).
const HOOK_NAMES = { write: "Write", shell: "Shell", del: "Delete", read: "Read" };
const STREAM_NAMES = { write: "edit", shell: "shell", del: "delete", read: "read" };

describe("approvalCategory (cross-taxonomy drift-guard)", () => {
  it("maps the HOOK taxonomy (PascalCase) to canonical categories", () => {
    expect(approvalCategory("Write")).toBe("write");
    expect(approvalCategory("StrReplace")).toBe("write");
    expect(approvalCategory("EditNotebook")).toBe("write");
    expect(approvalCategory("Delete")).toBe("delete");
    expect(approvalCategory("Shell")).toBe("shell");
  });

  it("maps the STREAM taxonomy (lowercase) to the SAME categories", () => {
    expect(approvalCategory("write")).toBe("write");
    expect(approvalCategory("edit")).toBe("write");
    expect(approvalCategory("delete")).toBe("delete");
    expect(approvalCategory("shell")).toBe("shell");
    expect(approvalCategory("execute")).toBe("shell");
  });

  it("a file mutation collapses to `write` on BOTH sides (hook Write == stream edit)", () => {
    expect(approvalCategory(HOOK_NAMES.write)).toBe(approvalCategory(STREAM_NAMES.write));
  });

  it("returns undefined for read-only / non-gated tools", () => {
    for (const t of ["read", "Read", "glob", "Glob", "grep", "Grep", "ls", "think", "task"]) {
      expect(approvalCategory(t)).toBeUndefined();
    }
  });
});

describe("builtInRequiresApproval", () => {
  it("gates mutating/destructive tools in BOTH taxonomies", () => {
    for (const t of ["Write", "StrReplace", "EditNotebook", "Shell", "Delete", "edit", "shell", "delete", "execute", "write"]) {
      expect(builtInRequiresApproval(t)).toBe(true);
    }
  });

  it("allows read-only built-in tools", () => {
    for (const t of ["Read", "read", "Grep", "grep", "Glob", "glob", "ls", "think", "task"]) {
      expect(builtInRequiresApproval(t)).toBe(false);
    }
  });

  it("fails open for unknown tools (parity with native, avoids denying auto-approved MCP)", () => {
    expect(builtInRequiresApproval("SomeFutureTool")).toBe(false);
    expect(builtInRequiresApproval("search_services")).toBe(false);
  });

  it("exposes the gated set in the HOOK taxonomy (what the hook matches)", () => {
    expect(getBuiltInGatedList()).toEqual(
      expect.arrayContaining(["Write", "StrReplace", "EditNotebook", "Shell", "Delete"]),
    );
  });

  it("every gated built-in resolves to a category (no ungated hole)", () => {
    for (const name of getBuiltInGatedList()) {
      expect(approvalCategory(name)).toBeDefined();
    }
    // The injected hook map covers exactly the gated set.
    expect(getBuiltInGatedCategories().map(([n]) => n).sort()).toEqual(getBuiltInGatedList().sort());
  });
});

describe("getBuiltInApprovalMessage", () => {
  it("returns a category template for gated tools in EITHER taxonomy", () => {
    expect(getBuiltInApprovalMessage("Write")).toContain("{{args.path}}");
    expect(getBuiltInApprovalMessage("edit")).toContain("{{args.path}}");
    expect(getBuiltInApprovalMessage("Shell")).toContain("{{args.command}}");
    expect(getBuiltInApprovalMessage("shell")).toContain("{{args.command}}");
    expect(getBuiltInApprovalMessage("Read")).toBeUndefined();
    expect(getBuiltInApprovalMessage("read")).toBeUndefined();
  });
});

describe("extractArgKey (spans both taxonomies' field names)", () => {
  it("extracts the salient value regardless of field name (file_path or path)", () => {
    expect(extractArgKey({ file_path: "a.txt" })).toBe("a.txt"); // hook shape
    expect(extractArgKey({ path: "a.txt" })).toBe("a.txt"); // stream shape
    expect(extractArgKey({ command: "ls -la" })).toBe("ls -la");
    expect(extractArgKey({ target_notebook: "nb.ipynb" })).toBe("nb.ipynb");
  });

  it("returns empty string when no salient field is present", () => {
    expect(extractArgKey({})).toBe("");
    expect(extractArgKey(undefined)).toBe("");
    expect(extractArgKey({ other: 1 })).toBe("");
  });
});

describe("toolIdentity + grantToken (canonical, taxonomy-agnostic)", () => {
  it("a hook Write and a stream edit on the SAME path produce the SAME token", () => {
    const hook = toolIdentity("Write", "", { file_path: "/x/a.txt" });
    const stream = toolIdentity("edit", "", { path: "/x/a.txt" });
    expect(hook).toEqual({ key: "write", salient: "/x/a.txt" });
    expect(stream).toEqual({ key: "write", salient: "/x/a.txt" });
    expect(grantToken(hook.key, hook.salient)).toBe(grantToken(stream.key, stream.salient));
  });

  it("encodes as base64(key \\n salient)", () => {
    expect(grantToken("write", "/x/a.txt")).toBe(
      Buffer.from("write\n/x/a.txt", "utf-8").toString("base64"),
    );
  });

  it("MCP tools key on name only (consistent across layers)", () => {
    expect(toolIdentity("apply_x", "planton", { path: "ignored" })).toEqual({ key: "apply_x", salient: "" });
  });
});

describe("buildApprovalGrants", () => {
  it("creates an exact-resource grant for an approved built-in (stream-named) tool", () => {
    const grants = buildApprovalGrants(
      [pending({ toolCallId: "c1", toolName: "edit", argsPreview: JSON.stringify({ path: "/x/gated.txt" }) })],
      new Map([["c1", ApprovalAction.APPROVE]]),
    );
    expect(grants).toEqual([{ toolName: "edit", mcpServerSlug: "", key: "write", salient: "/x/gated.txt" }]);
  });

  it("creates a name-only grant for an approved MCP tool", () => {
    const grants = buildApprovalGrants(
      [pending({ toolCallId: "c1", toolName: "apply_x", mcpServerSlug: "planton", argsPreview: JSON.stringify({ path: "ignored" }) })],
      new Map([["c1", ApprovalAction.APPROVE]]),
    );
    expect(grants).toEqual([{ toolName: "apply_x", mcpServerSlug: "planton", key: "apply_x", salient: "" }]);
  });

  it("ignores skipped and rejected approvals", () => {
    const grants = buildApprovalGrants(
      [
        pending({ toolCallId: "c1", toolName: "edit", argsPreview: JSON.stringify({ path: "a" }) }),
        pending({ toolCallId: "c2", toolName: "shell", argsPreview: JSON.stringify({ command: "rm" }) }),
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
    ["planton/apply_x", { toolName: "apply_x", mcpServerSlug: "planton", requiresApproval: true, approvalMessage: "Apply X", source: "classifier_default" }],
  ]);

  it("carries MCP policies and exact-resource grant tokens (gated set is baked into the hook, not the state)", () => {
    const grants = [{ toolName: "edit", mcpServerSlug: "", key: "write", salient: "/x/gated.txt" }];
    const state = buildApprovalState(mcpPolicies, false, grants);

    expect(state.autoApproveAll).toBe(false);
    expect(state.mcpToolPolicies.apply_x).toEqual({ requiresApproval: true, message: "Apply X" });
    expect(state.approvedGrantTokens).toEqual([grantToken("write", "/x/gated.txt")]);
    // builtInGatedList is no longer part of the state file (baked into the hook).
    expect((state as Record<string, unknown>).builtInGatedList).toBeUndefined();
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
        pending({ toolCallId: "c1", toolName: "edit", message: "Write file: gated.txt" }),
        pending({ toolCallId: "c2", toolName: "shell", message: "Run command: rm -rf build" }),
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
