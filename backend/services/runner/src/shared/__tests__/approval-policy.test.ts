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
  deriveActiveLeases,
  type ActiveLeases,
  type MergedToolPolicy,
} from "../approval-policy.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";
import type { ToolApprovalOverride } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/** No active leases — the default gate-everything state used by most merge tests. */
const NO_LEASES: ActiveLeases = { global: false, categories: new Set(), servers: new Set() };

/** ActiveLeases with the given scopes; `global` defaults to false. */
function leases(opts: {
  global?: boolean;
  categories?: Array<"write" | "delete" | "shell">;
  servers?: string[];
}): ActiveLeases {
  return {
    global: opts.global ?? false,
    categories: new Set(opts.categories ?? []),
    servers: new Set(opts.servers ?? []),
  };
}

/** A single tool call shaped just enough for deriveActiveLeases. */
interface TestToolCall {
  approvalAction: ApprovalAction;
  name?: string;
  mcpServerSlug?: string;
}

/**
 * Builds a minimal AgentExecution shaped just enough for deriveActiveLeases,
 * which reads each tool call's approval action plus its name / mcp_server_slug
 * (the scope inputs) on root and sub-agent messages, and spec.auto_approve_all.
 */
function makeExecution(opts: {
  rootCalls?: TestToolCall[];
  subAgentCalls?: TestToolCall[];
  autoApproveAll?: boolean;
  hasStatus?: boolean;
}): AgentExecution {
  const hasStatus = opts.hasStatus ?? true;
  const spec = { autoApproveAll: opts.autoApproveAll ?? false };
  if (!hasStatus) {
    return { spec, status: undefined } as unknown as AgentExecution;
  }
  const toCalls = (calls: TestToolCall[] = []) =>
    calls.map(c => ({
      approvalAction: c.approvalAction,
      name: c.name ?? "",
      mcpServerSlug: c.mcpServerSlug ?? "",
    }));
  return {
    spec,
    status: {
      messages: [{ toolCalls: toCalls(opts.rootCalls) }],
      subAgentExecutions: [
        { messages: [{ toolCalls: toCalls(opts.subAgentCalls) }] },
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
  it("returns empty map under a global lease (spec.auto_approve_all)", () => {
    const servers = [makeServer("github", [{ toolName: "push" }])];
    const result = mergeApprovalPolicies(servers, [], leases({ global: true }));
    expect(result.size).toBe(0);
  });

  it("drops a leased server's tools while keeping other servers gated", () => {
    const servers = [
      makeServer("github", [{ toolName: "push" }]),
      makeServer("database", [{ toolName: "drop_table" }]),
    ];
    const result = mergeApprovalPolicies(servers, [], leases({ servers: ["github"] }));
    expect(result.has("github/push")).toBe(false);
    expect(result.has("database/drop_table")).toBe(true);
  });

  it("creates policies from toolApprovals", () => {
    const servers = [
      makeServer("github", [
        { toolName: "create_issue", message: "Create issue?" },
      ]),
    ];
    const result = mergeApprovalPolicies(servers, [], NO_LEASES);

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
    const result = mergeApprovalPolicies(servers, [], NO_LEASES);

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

    const result = mergeApprovalPolicies(servers, overrides, NO_LEASES);
    expect(result.size).toBe(0);
  });

  it("agent overrides can add new approval requirement", () => {
    const servers = [makeServer("github", [])];
    const overrides: ToolApprovalOverride[] = [{
      toolName: "delete_repo",
      requiresApproval: true,
      message: "Really delete?",
    }] as any[];

    const result = mergeApprovalPolicies(servers, overrides, NO_LEASES);
    expect(result.has("github/delete_repo")).toBe(true);
  });

  describe("provenance (source stamping)", () => {
    it("stamps classifier_default for a layer-1 tool approval", () => {
      const servers = [makeServer("github", [{ toolName: "create_issue" }])];
      const result = mergeApprovalPolicies(servers, [], NO_LEASES);
      expect(result.get("github/create_issue")!.source).toBe("classifier_default");
    });

    it("stamps pinned_override when a pinned approval wins", () => {
      const servers = [
        makeServer("github", [{ toolName: "push" }], [{ toolName: "push" }]),
      ];
      const result = mergeApprovalPolicies(servers, [], NO_LEASES);
      expect(result.get("github/push")!.source).toBe("pinned_override");
    });

    it("stamps agent_override when a per-agent override adds a gate", () => {
      const servers = [makeServer("github", [])];
      const overrides: ToolApprovalOverride[] = [{
        toolName: "delete_repo",
        requiresApproval: true,
        message: "Really delete?",
      }] as any[];
      const result = mergeApprovalPolicies(servers, overrides, NO_LEASES);
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
      const result = mergeApprovalPolicies(servers, overrides, NO_LEASES);
      const policy = result.get("github/push")!;
      expect(policy.source).toBe("agent_override");
      expect(policy.approvalMessage).toBe("agent says gate");
    });
  });

  it("skips tools without names", () => {
    const servers = [
      makeServer("github", [{ toolName: "" }]),
    ];
    const result = mergeApprovalPolicies(servers, [], NO_LEASES);
    expect(result.size).toBe(0);
  });

  it("generates default message when none provided", () => {
    const servers = [
      makeServer("github", [{ toolName: "push" }]),
    ];
    const result = mergeApprovalPolicies(servers, [], NO_LEASES);
    expect(result.get("github/push")!.approvalMessage).toContain("Execute tool: push");
  });

  it("handles multiple servers independently", () => {
    const servers = [
      makeServer("github", [{ toolName: "push" }]),
      makeServer("database", [{ toolName: "drop_table" }]),
    ];
    const result = mergeApprovalPolicies(servers, [], NO_LEASES);
    expect(result.size).toBe(2);
    expect(result.has("github/push")).toBe(true);
    expect(result.has("database/drop_table")).toBe(true);
  });
});

describe("deriveActiveLeases", () => {
  it("returns no leases when there is no status", () => {
    const result = deriveActiveLeases(makeExecution({ hasStatus: false }));
    expect(result.global).toBe(false);
    expect(result.categories.size).toBe(0);
    expect(result.servers.size).toBe(0);
  });

  it("returns no scoped leases when no tool call carries APPROVE_ALL", () => {
    const exec = makeExecution({
      rootCalls: [
        { approvalAction: ApprovalAction.APPROVE, name: "shell" },
        { approvalAction: ApprovalAction.SKIP, name: "write" },
      ],
      subAgentCalls: [{ approvalAction: ApprovalAction.REJECT, name: "delete" }],
    });
    const result = deriveActiveLeases(exec);
    expect(result.categories.size).toBe(0);
    expect(result.servers.size).toBe(0);
  });

  it("reflects the global pre-arm from spec.auto_approve_all", () => {
    const result = deriveActiveLeases(makeExecution({ autoApproveAll: true }));
    expect(result.global).toBe(true);
  });

  it("derives a built-in CATEGORY lease from an APPROVE_ALL on a built-in", () => {
    const exec = makeExecution({
      rootCalls: [{ approvalAction: ApprovalAction.APPROVE_ALL, name: "shell" }],
    });
    const result = deriveActiveLeases(exec);
    expect([...result.categories]).toEqual(["shell"]);
    expect(result.servers.size).toBe(0);
  });

  it("collapses FILE_WRITE and FILE_EDIT to a single 'write' category lease", () => {
    const exec = makeExecution({
      rootCalls: [
        { approvalAction: ApprovalAction.APPROVE_ALL, name: "write_file" },
        { approvalAction: ApprovalAction.APPROVE_ALL, name: "edit_file" },
      ],
    });
    expect([...deriveActiveLeases(exec).categories]).toEqual(["write"]);
  });

  it("derives a SERVER lease from an APPROVE_ALL on an MCP tool", () => {
    const exec = makeExecution({
      rootCalls: [
        { approvalAction: ApprovalAction.APPROVE_ALL, name: "create_issue", mcpServerSlug: "github" },
      ],
    });
    const result = deriveActiveLeases(exec);
    expect([...result.servers]).toEqual(["github"]);
    expect(result.categories.size).toBe(0);
  });

  it("derives leases from sub-agent tool calls too", () => {
    const exec = makeExecution({
      subAgentCalls: [
        { approvalAction: ApprovalAction.APPROVE_ALL, name: "delete" },
        { approvalAction: ApprovalAction.APPROVE_ALL, name: "drop", mcpServerSlug: "database" },
      ],
    });
    const result = deriveActiveLeases(exec);
    expect([...result.categories]).toEqual(["delete"]);
    expect([...result.servers]).toEqual(["database"]);
  });

  it("does not lease a read-only built-in (no category) on APPROVE_ALL", () => {
    const exec = makeExecution({
      rootCalls: [{ approvalAction: ApprovalAction.APPROVE_ALL, name: "read" }],
    });
    const result = deriveActiveLeases(exec);
    expect(result.categories.size).toBe(0);
    expect(result.servers.size).toBe(0);
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
