import { describe, it, expect } from "vitest";
import {
  builtInRequiresApproval,
  mergeApprovalPolicies,
  lookupMcpToolPolicy,
  resolveApprovalMessage,
  getBuiltInAllowList,
} from "../approval-policy.js";
import type { ResolvedMcpServer } from "../../adapter/mcp-resolver.js";
import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { create } from "@bufbuild/protobuf";
import { ToolApprovalPolicySchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ToolApprovalOverrideSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";

function makePolicy(toolName: string, message: string): ToolApprovalPolicy {
  return create(ToolApprovalPolicySchema, { toolName, message });
}

function makeServer(
  slug: string,
  toolApprovals: ToolApprovalPolicy[] = [],
  pinnedToolApprovals: ToolApprovalPolicy[] = [],
): ResolvedMcpServer {
  return {
    slug,
    connectionType: "http",
    url: "http://localhost",
    toolApprovals,
    pinnedToolApprovals,
    discoveredCapabilitiesEmpty: false,
  };
}

describe("builtInRequiresApproval", () => {
  describe("destructive tools require approval", () => {
    it.each(["Shell", "Delete"])("requires approval for %s", (tool) => {
      expect(builtInRequiresApproval(tool)).toBe(true);
    });
  });

  describe("read-only tools are auto-approved", () => {
    it.each(["Read", "Grep", "Glob", "SemanticSearch", "WebSearch", "WebFetch"])(
      "auto-approves %s",
      (tool) => {
        expect(builtInRequiresApproval(tool)).toBe(false);
      },
    );
  });

  describe("unknown tools require approval (fail-closed)", () => {
    it("requires approval for unknown tool", () => {
      expect(builtInRequiresApproval("CustomTool")).toBe(true);
    });
  });
});

describe("getBuiltInAllowList", () => {
  it("returns an array of built-in tool names", () => {
    const list = getBuiltInAllowList();
    expect(list).toContain("Read");
    expect(list).toContain("Grep");
    expect(list).not.toContain("Shell");
    expect(list).not.toContain("Delete");
  });
});

describe("mergeApprovalPolicies", () => {
  it("returns empty map when autoApproveAll is true", () => {
    const server = makeServer("planton", [makePolicy("apply_service", "Apply service")]);
    const merged = mergeApprovalPolicies([server], [], true);
    expect(merged.size).toBe(0);
  });

  it("includes tools from status.toolApprovals", () => {
    const server = makeServer("planton", [
      makePolicy("apply_service", "Apply service {{args.service}}"),
      makePolicy("delete_service", "Delete service {{args.id}}"),
    ]);
    const merged = mergeApprovalPolicies([server], [], false);
    expect(merged.size).toBe(2);
    expect(merged.get("planton/apply_service")?.requiresApproval).toBe(true);
    expect(merged.get("planton/delete_service")?.requiresApproval).toBe(true);
  });

  it("pinned overrides take precedence for message", () => {
    const server = makeServer(
      "planton",
      [makePolicy("apply_service", "System message")],
      [makePolicy("apply_service", "Pinned message")],
    );
    const merged = mergeApprovalPolicies([server], [], false);
    expect(merged.get("planton/apply_service")?.approvalMessage).toBe("Pinned message");
  });

  it("agent overrides can disable approval", () => {
    const server = makeServer("planton", [
      makePolicy("apply_service", "Apply service"),
    ]);
    const override = create(ToolApprovalOverrideSchema, {
      toolName: "apply_service",
      requiresApproval: false,
      message: "",
    });
    const merged = mergeApprovalPolicies([server], [override], false);
    expect(merged.has("planton/apply_service")).toBe(false);
  });

  it("agent overrides can enable approval for tools not in server policies", () => {
    const server = makeServer("planton", []);
    const override = create(ToolApprovalOverrideSchema, {
      toolName: "custom_tool",
      requiresApproval: true,
      message: "Custom approval",
    });
    const merged = mergeApprovalPolicies([server], [override], false);
    expect(merged.get("planton/custom_tool")?.requiresApproval).toBe(true);
    expect(merged.get("planton/custom_tool")?.approvalMessage).toBe("Custom approval");
  });

  it("handles multiple servers independently", () => {
    const server1 = makeServer("planton", [makePolicy("apply_service", "S1")]);
    const server2 = makeServer("github", [makePolicy("create_pr", "S2")]);
    const merged = mergeApprovalPolicies([server1, server2], [], false);
    expect(merged.size).toBe(2);
    expect(merged.has("planton/apply_service")).toBe(true);
    expect(merged.has("github/create_pr")).toBe(true);
  });

  it("generates default message when policy message is empty", () => {
    const server = makeServer("planton", [makePolicy("apply_service", "")]);
    const merged = mergeApprovalPolicies([server], [], false);
    expect(merged.get("planton/apply_service")?.approvalMessage).toBe("Execute tool: apply_service");
  });
});

describe("lookupMcpToolPolicy", () => {
  it("finds a policy by server slug and tool name", () => {
    const server = makeServer("planton", [makePolicy("apply_service", "Apply")]);
    const policies = mergeApprovalPolicies([server], [], false);
    const result = lookupMcpToolPolicy("apply_service", "planton", policies);
    expect(result).toBeDefined();
    expect(result?.requiresApproval).toBe(true);
  });

  it("returns undefined for tools without a policy", () => {
    const server = makeServer("planton", [makePolicy("apply_service", "Apply")]);
    const policies = mergeApprovalPolicies([server], [], false);
    expect(lookupMcpToolPolicy("search_services", "planton", policies)).toBeUndefined();
  });
});

describe("resolveApprovalMessage", () => {
  it("resolves {{args.field}} placeholders", () => {
    const result = resolveApprovalMessage(
      "Delete service {{args.id}}",
      "delete_service",
      { id: "svc-123" },
    );
    expect(result).toBe("Delete service svc-123");
  });

  it("resolves {{tool_name}} placeholder", () => {
    const result = resolveApprovalMessage(
      "Execute tool: {{tool_name}}",
      "apply_service",
      {},
    );
    expect(result).toBe("Execute tool: apply_service");
  });

  it("replaces missing args with <unknown>", () => {
    const result = resolveApprovalMessage(
      "Delete {{args.id}}",
      "delete_service",
      {},
    );
    expect(result).toBe("Delete <unknown>");
  });

  it("stringifies non-string arg values", () => {
    const result = resolveApprovalMessage(
      "Apply {{args.config}}",
      "apply",
      { config: { key: "value" } },
    );
    expect(result).toBe('Apply {"key":"value"}');
  });
});
