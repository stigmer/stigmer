/**
 * @regression file-hitl-gate — pins content-exact approval identity: approving
 * one edit never lets a DIFFERENT edit to the same path ride the grant.
 *
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
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import {
  approvalCategory,
  getBuiltInGatedList,
  getBuiltInGatedCategories,
  extractArgKey,
} from "../approval-policy.js";
import type { McpApprovalDefault } from "../approval-policy.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import { compileHookToolScope, decodeHookToolScope, UNRESTRICTED_HOOK_SCOPE } from "../hook-scope.js";
import {
  buildApprovalGrants,
  buildApprovalState,
  buildPersonRefusals,
  grantToken,
  primaryToken,
  toolIdentity,
} from "../approval-state.js";
import { buildReinvocationPrompt } from "../prompt-builder.js";

function pending(overrides: MessageInitShape<typeof PendingApprovalSchema>): PendingApproval {
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

describe("the hook's gated set", () => {
  it("fails open for unknown tools: no category, so the hook allows them (parity with native, avoids denying auto-approved MCP)", () => {
    expect(approvalCategory("SomeFutureTool")).toBeUndefined();
    expect(approvalCategory("search_services")).toBeUndefined();
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

  it("MCP tools key on server and tool (both consistent across layers)", () => {
    expect(toolIdentity("apply_x", "planton", { path: "ignored" })).toEqual({ key: "planton/apply_x", salient: "" });
  });

  it("a built-in with no approval category keys on the hook's name for it", () => {
    expect(toolIdentity("read", "", { path: "/w/a.md" })).toEqual({ key: "Read", salient: "/w/a.md" });
    expect(toolIdentity("glob", "", { file_path: "/w" })).toEqual({ key: "Grep", salient: "/w" });
    expect(toolIdentity("Read", "", { file_path: "/w/a.md" })).toEqual({ key: "Read", salient: "/w/a.md" });
  });
});

describe("buildPersonRefusals", () => {
  it("holds each skipped or rejected call by its primary and its coarse identity, and nothing approved", () => {
    const refusals = buildPersonRefusals(
      [
        pending({ toolCallId: "c1", toolName: "shell", argsPreview: JSON.stringify({ command: "rm -rf x" }) }),
        pending({ toolCallId: "c2", toolName: "edit", argsPreview: JSON.stringify({ path: "/x/a" }) }),
        pending({ toolCallId: "c3", toolName: "close_issue", mcpServerSlug: "github", argsPreview: "{}" }),
        pending({ toolCallId: "c4", toolName: "shell", argsPreview: JSON.stringify({ command: "ls" }) }),
      ],
      new Map([
        ["c1", ApprovalAction.REJECT],
        ["c2", ApprovalAction.SKIP],
        ["c3", ApprovalAction.REJECT],
        ["c4", ApprovalAction.APPROVE],
      ]),
      new Map([["c2", "d1g3st"]]),
    );
    expect(refusals.get(grantToken("shell", "rm -rf x"))).toEqual({ action: "reject", toolName: "shell" });
    expect(refusals.get(primaryToken("write", "/x/a", "d1g3st"))).toEqual({ action: "skip", toolName: "edit" });
    expect(refusals.get(grantToken("write", "/x/a")), "a content-less retry of the same file").toEqual({ action: "skip", toolName: "edit" });
    expect(refusals.get(grantToken("github/close_issue", ""))).toEqual({ action: "reject", toolName: "close_issue" });
    expect(refusals.has(grantToken("shell", "ls"))).toBe(false);
  });
});

describe("buildApprovalGrants", () => {
  it("creates an exact-resource grant for an approved built-in (stream-named) tool", () => {
    const grants = buildApprovalGrants(
      [pending({ toolCallId: "c1", toolName: "edit", argsPreview: JSON.stringify({ path: "/x/gated.txt" }) })],
      new Map([["c1", ApprovalAction.APPROVE]]),
    );
    expect(grants).toEqual([{ toolName: "edit", mcpServerSlug: "", key: "write", salient: "/x/gated.txt", contentDigest: "", sourceToolCallId: "c1" }]);
  });

  it("binds an approved edit's grant to its content digest (sibling-isolation)", () => {
    const digest = "abc123";
    const grants = buildApprovalGrants(
      [pending({ toolCallId: "c1", toolName: "edit", argsPreview: JSON.stringify({ path: "/x/gated.txt" }) })],
      new Map([["c1", ApprovalAction.APPROVE]]),
      new Map([["c1", digest]]),
    );
    expect(grants).toEqual([{ toolName: "edit", mcpServerSlug: "", key: "write", salient: "/x/gated.txt", contentDigest: digest, sourceToolCallId: "c1" }]);
  });

  it("creates a server-and-tool grant for an approved MCP tool", () => {
    const grants = buildApprovalGrants(
      [pending({ toolCallId: "c1", toolName: "apply_x", mcpServerSlug: "planton", argsPreview: JSON.stringify({ path: "ignored" }) })],
      new Map([["c1", ApprovalAction.APPROVE]]),
    );
    expect(grants).toEqual([{ toolName: "apply_x", mcpServerSlug: "planton", key: "planton/apply_x", salient: "", contentDigest: "", sourceToolCallId: "c1" }]);
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
  const mcpPolicies: McpApprovalDefault = {
    destructive: new Set(["planton/apply_x", "leased/drop_y"]),
    leasedServers: new Set(["leased"]),
  };

  it("carries the destructive MCP tools by server and tool, leased servers left out, and exact-resource grant tokens", () => {
    const grants = [{ toolName: "edit", mcpServerSlug: "", key: "write", salient: "/x/gated.txt", contentDigest: "", sourceToolCallId: "consent-1" }];
    const state = buildApprovalState(mcpPolicies, false, new Set(), grants);

    expect(state.autoApproveAll).toBe(false);
    expect(state.leasedCategories).toEqual([]);
    expect(state.mcpDestructiveTools).toEqual({ "planton/apply_x": { message: "Execute apply_x" } });
    // No digest -> the primary token degrades to the coarse grant token.
    expect(state.approvedGrantTokens).toEqual([grantToken("write", "/x/gated.txt")]);
    // builtInGatedList is no longer part of the state file (baked into the hook).
    expect((state as unknown as Record<string, unknown>).builtInGatedList).toBeUndefined();
  });

  it("carries the compiled tool scope, unrestricted by default", () => {
    // Default: no lists — the hook's scope arm is inert.
    const bare = buildApprovalState(mcpPolicies, false, new Set());
    expect(bare.toolListsRestricted).toBe(false);
    expect(decodeHookToolScope(bare.toolScope)).toEqual(UNRESTRICTED_HOOK_SCOPE);

    const scope = compileHookToolScope({
      scope: ToolScope.of('Agent "a"', { tools: ["Read", "mcp__planton__get_cloud_resource"], disallowedTools: [] }),
      servers: [{ slug: "planton", discoveredToolNames: ["get_cloud_resource", "apply_x"] }],
      platformServerSlugs: new Set(),
      readRoot: "/platform",
      subAgentTypes: [],
    });
    const restricted = buildApprovalState(mcpPolicies, false, new Set(), undefined, false, false, true, false, scope);
    expect(restricted.toolListsRestricted).toBe(true);
    expect(decodeHookToolScope(restricted.toolScope).mcp.servers.planton.tools).toEqual({ get_cloud_resource: true, apply_x: false });
  });

  it("emits the CONTENT token when a grant carries a content digest", () => {
    const grants = [{ toolName: "edit", mcpServerSlug: "", key: "write", salient: "/x/gated.txt", contentDigest: "deadbeef", sourceToolCallId: "consent-1" }];
    const state = buildApprovalState(mcpPolicies, false, new Set(), grants);
    // A content-identified grant authorizes base64(key\nsalient\ndigest), so a
    // DIFFERENT edit to the same path (different digest) does not match.
    expect(state.approvedGrantTokens).toEqual([
      Buffer.from("write\n/x/gated.txt\ndeadbeef", "utf-8").toString("base64"),
    ]);
    expect(state.approvedGrantTokens[0]).not.toBe(grantToken("write", "/x/gated.txt"));
  });

  it("writes leasedCategories for run-lifetime scoped leases", () => {
    const state = buildApprovalState(mcpPolicies, false, new Set(["shell", "write"]));
    expect(state.autoApproveAll).toBe(false);
    expect(state.leasedCategories.sort()).toEqual(["shell", "write"]);
  });

  it("defaults grants to empty when none provided", () => {
    const state = buildApprovalState(mcpPolicies, true, new Set());
    expect(state.autoApproveAll).toBe(true);
    expect(state.leasedCategories).toEqual([]);
    expect(state.approvedGrants).toEqual([]);
    expect(state.approvedGrantTokens).toEqual([]);
  });
});

describe("buildReinvocationPrompt", () => {
  it("describes approved, skipped and rejected actions in human terms, not opaque ids", () => {
    const prompt = buildReinvocationPrompt(
      [
        pending({ toolCallId: "c1", toolName: "edit", message: "Write file: gated.txt" }),
        pending({ toolCallId: "c2", toolName: "shell", message: "Run command: rm -rf build" }),
        pending({ toolCallId: "c3", toolName: "shell", message: "Run command: git push --force" }),
      ],
      new Map([
        ["c1", ApprovalAction.APPROVE],
        ["c2", ApprovalAction.SKIP],
        ["c3", ApprovalAction.REJECT],
      ]),
    );

    expect(prompt).toContain("APPROVED");
    expect(prompt).toContain("Write file: gated.txt");
    expect(prompt).toContain("SKIPPED");
    expect(prompt).toContain("Run command: rm -rf build");
    expect(prompt).toContain("REJECTED");
    expect(prompt).toContain("Run command: git push --force");
    expect(prompt).not.toContain("c1");
    expect(prompt).not.toContain("c2");
    expect(prompt).not.toContain("c3");
  });

  it("falls back to tool name + args preview when no message is set", () => {
    const prompt = buildReinvocationPrompt(
      [pending({ toolCallId: "c1", toolName: "apply_x", mcpServerSlug: "planton", message: "", argsPreview: '{"k":"v"}' })],
      new Map([["c1", ApprovalAction.APPROVE]]),
    );
    expect(prompt).toContain("planton/apply_x");
  });
});
