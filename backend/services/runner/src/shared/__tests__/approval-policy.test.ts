/**
 * Approval policy evaluation tests.
 *
 * Covers the four-level merge chain and placeholder resolution
 * in approval messages. Ported from Python test_hitl_contracts.py
 * policy evaluation sections.
 */

import { describe, it, expect } from "vitest";
import {
  mergeApprovalPolicies,
  lookupMcpToolPolicy,
  resolveApprovalMessage,
  hasApproveAllDecision,
  type MergedToolPolicy,
} from "../approval-policy.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";
import type { ToolApprovalOverride } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * Builds a minimal AgentExecution shaped just enough for
 * hasApproveAllDecision, which only reads tool-call approval actions on
 * root and sub-agent messages.
 */
function makeExecution(opts: {
  rootActions?: ApprovalAction[];
  subAgentActions?: ApprovalAction[];
  hasStatus?: boolean;
}): AgentExecution {
  const hasStatus = opts.hasStatus ?? true;
  if (!hasStatus) {
    return { status: undefined } as unknown as AgentExecution;
  }
  return {
    status: {
      messages: [
        { toolCalls: (opts.rootActions ?? []).map(a => ({ approvalAction: a })) },
      ],
      subAgentExecutions: [
        {
          messages: [
            { toolCalls: (opts.subAgentActions ?? []).map(a => ({ approvalAction: a })) },
          ],
        },
      ],
    },
  } as unknown as AgentExecution;
}

function makeServer(
  slug: string,
  toolApprovals: Array<{ toolName: string; message?: string }>,
  pinnedToolApprovals: Array<{ toolName: string; message?: string }> = [],
): ResolvedMcpServer {
  return {
    slug,
    connectionType: "stdio",
    toolApprovals: toolApprovals.map(a => ({
      toolName: a.toolName,
      message: a.message ?? "",
    })) as any[],
    pinnedToolApprovals: pinnedToolApprovals.map(a => ({
      toolName: a.toolName,
      message: a.message ?? "",
    })) as any[],
    discoveredCapabilitiesEmpty: false,
  };
}

describe("mergeApprovalPolicies", () => {
  it("returns empty map when autoApproveAll is true", () => {
    const servers = [makeServer("github", [{ toolName: "push" }])];
    const result = mergeApprovalPolicies(servers, [], true);
    expect(result.size).toBe(0);
  });

  it("creates policies from toolApprovals", () => {
    const servers = [
      makeServer("github", [
        { toolName: "create_issue", message: "Create issue?" },
      ]),
    ];
    const result = mergeApprovalPolicies(servers, [], false);

    expect(result.size).toBe(1);
    const policy = result.get("github/create_issue")!;
    expect(policy.requiresApproval).toBe(true);
    expect(policy.approvalMessage).toBe("Create issue?");
    expect(policy.mcpServerSlug).toBe("github");
  });

  it("pinnedToolApprovals override toolApprovals", () => {
    const servers = [
      makeServer(
        "github",
        [{ toolName: "push", message: "auto message" }],
        [{ toolName: "push", message: "pinned message" }],
      ),
    ];
    const result = mergeApprovalPolicies(servers, [], false);

    const policy = result.get("github/push")!;
    expect(policy.approvalMessage).toBe("pinned message");
  });

  it("agent overrides can disable approval", () => {
    const servers = [
      makeServer("github", [{ toolName: "push" }]),
    ];
    const overrides: ToolApprovalOverride[] = [{
      toolName: "push",
      requiresApproval: false,
      message: "",
    }] as any[];

    const result = mergeApprovalPolicies(servers, overrides, false);
    expect(result.size).toBe(0);
  });

  it("agent overrides can add new approval requirement", () => {
    const servers = [makeServer("github", [])];
    const overrides: ToolApprovalOverride[] = [{
      toolName: "delete_repo",
      requiresApproval: true,
      message: "Really delete?",
    }] as any[];

    const result = mergeApprovalPolicies(servers, overrides, false);
    expect(result.has("github/delete_repo")).toBe(true);
  });

  describe("provenance (source stamping)", () => {
    it("stamps classifier_default for a layer-1 tool approval", () => {
      const servers = [makeServer("github", [{ toolName: "create_issue" }])];
      const result = mergeApprovalPolicies(servers, [], false);
      expect(result.get("github/create_issue")!.source).toBe("classifier_default");
    });

    it("stamps pinned_override when a pinned approval wins", () => {
      const servers = [
        makeServer("github", [{ toolName: "push" }], [{ toolName: "push" }]),
      ];
      const result = mergeApprovalPolicies(servers, [], false);
      expect(result.get("github/push")!.source).toBe("pinned_override");
    });

    it("stamps agent_override when a per-agent override adds a gate", () => {
      const servers = [makeServer("github", [])];
      const overrides: ToolApprovalOverride[] = [{
        toolName: "delete_repo",
        requiresApproval: true,
        message: "Really delete?",
      }] as any[];
      const result = mergeApprovalPolicies(servers, overrides, false);
      expect(result.get("github/delete_repo")!.source).toBe("agent_override");
    });

    it("stamps agent_override when it overrides a classifier/pinned entry", () => {
      const servers = [
        makeServer("github", [{ toolName: "push", message: "classifier" }]),
      ];
      const overrides: ToolApprovalOverride[] = [{
        toolName: "push",
        requiresApproval: true,
        message: "agent says gate",
      }] as any[];
      const result = mergeApprovalPolicies(servers, overrides, false);
      const policy = result.get("github/push")!;
      expect(policy.source).toBe("agent_override");
      expect(policy.approvalMessage).toBe("agent says gate");
    });
  });

  it("skips tools without names", () => {
    const servers = [
      makeServer("github", [{ toolName: "" }]),
    ];
    const result = mergeApprovalPolicies(servers, [], false);
    expect(result.size).toBe(0);
  });

  it("generates default message when none provided", () => {
    const servers = [
      makeServer("github", [{ toolName: "push" }]),
    ];
    const result = mergeApprovalPolicies(servers, [], false);
    expect(result.get("github/push")!.approvalMessage).toContain("Execute tool: push");
  });

  it("handles multiple servers independently", () => {
    const servers = [
      makeServer("github", [{ toolName: "push" }]),
      makeServer("database", [{ toolName: "drop_table" }]),
    ];
    const result = mergeApprovalPolicies(servers, [], false);
    expect(result.size).toBe(2);
    expect(result.has("github/push")).toBe(true);
    expect(result.has("database/drop_table")).toBe(true);
  });
});

describe("hasApproveAllDecision", () => {
  it("returns false when there is no status", () => {
    expect(hasApproveAllDecision(makeExecution({ hasStatus: false }))).toBe(false);
  });

  it("returns false when no tool call carries APPROVE_ALL", () => {
    const exec = makeExecution({
      rootActions: [ApprovalAction.APPROVE, ApprovalAction.SKIP],
      subAgentActions: [ApprovalAction.REJECT],
    });
    expect(hasApproveAllDecision(exec)).toBe(false);
  });

  it("detects APPROVE_ALL on a root message tool call", () => {
    const exec = makeExecution({
      rootActions: [ApprovalAction.APPROVE, ApprovalAction.APPROVE_ALL],
    });
    expect(hasApproveAllDecision(exec)).toBe(true);
  });

  it("detects APPROVE_ALL on a sub-agent message tool call", () => {
    const exec = makeExecution({
      rootActions: [ApprovalAction.APPROVE],
      subAgentActions: [ApprovalAction.APPROVE_ALL],
    });
    expect(hasApproveAllDecision(exec)).toBe(true);
  });
});

describe("lookupMcpToolPolicy", () => {
  it("finds policy by server/tool key", () => {
    const policies = new Map<string, MergedToolPolicy>([
      ["github/push", {
        toolName: "push",
        mcpServerSlug: "github",
        requiresApproval: true,
        approvalMessage: "Push?",
        source: "classifier_default",
      }],
    ]);

    const policy = lookupMcpToolPolicy("push", "github", policies);
    expect(policy?.requiresApproval).toBe(true);
  });

  it("returns undefined for missing tool", () => {
    const policies = new Map();
    expect(lookupMcpToolPolicy("missing", "server", policies)).toBeUndefined();
  });
});

describe("resolveApprovalMessage", () => {
  it("resolves {{tool_name}} placeholder", () => {
    expect(resolveApprovalMessage(
      "Execute {{tool_name}}?",
      "create_issue",
      {},
    )).toBe("Execute create_issue?");
  });

  it("resolves {{args.field}} placeholders", () => {
    expect(resolveApprovalMessage(
      "Create issue '{{args.title}}' in {{args.repo}}?",
      "create_issue",
      { title: "Bug fix", repo: "org/repo" },
    )).toBe("Create issue 'Bug fix' in org/repo?");
  });

  it("shows <unknown> for missing args", () => {
    expect(resolveApprovalMessage(
      "Delete {{args.name}}?",
      "delete",
      {},
    )).toBe("Delete <unknown>?");
  });

  it("JSON-stringifies non-string arg values", () => {
    expect(resolveApprovalMessage(
      "Set {{args.count}}",
      "set",
      { count: 42 },
    )).toBe("Set 42");
  });

  it("handles null arg values", () => {
    expect(resolveApprovalMessage(
      "Value: {{args.val}}",
      "test",
      { val: null },
    )).toBe("Value: <unknown>");
  });

  it("returns template unchanged when no placeholders", () => {
    expect(resolveApprovalMessage("Simple message", "tool", {}))
      .toBe("Simple message");
  });
});
