/**
 * Temporal workflows for the MCP server connect flow.
 *
 * ConnectMcpServerWorkflow ("stigmer/mcp-server/connect"):
 *   Two-stage pipeline — discover tools, then classify approval policies.
 *   Short-circuits classification when the tools fingerprint is unchanged
 *   and previous approvals exist.
 *
 * DiscoverMcpServerWorkflow ("stigmer/mcp-server/discover"):
 *   Legacy single-stage wrapper retained for in-flight backward
 *   compatibility during deployment transitions.
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins (crypto, fs, net), no non-deterministic
 * operations, no side-effecting imports. Only @temporalio/workflow APIs,
 * type-only imports, and pure JS/TS logic.
 */

import { proxyActivities, log } from "@temporalio/workflow";

import type { createDiscoverMcpServerActivities } from "../activities/discover-mcp-server.js";
import type { createClassifyToolApprovalsActivities } from "../activities/classify-tool-approvals.js";

import type {
  ConnectMcpServerWorkflowInput,
  ConnectMcpServerWorkflowOutput,
  DiscoverMcpServerWorkflowOutput,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Activity Proxies
// ─────────────────────────────────────────────────────────────────────────────

type DiscoverActivities = ReturnType<typeof createDiscoverMcpServerActivities>;
type ClassifyActivities = ReturnType<typeof createClassifyToolApprovalsActivities>;

const discover = proxyActivities<DiscoverActivities>({
  startToCloseTimeout: "600s",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 1 },
});

function classifyWithTimeout(numTools: number) {
  const timeoutSec = Math.max(120, (Math.floor(numTools / 40) + 1) * 60);
  return proxyActivities<ClassifyActivities>({
    startToCloseTimeout: `${timeoutSec}s`,
    retry: { maximumAttempts: 2 },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ConnectMcpServerWorkflow — primary connect flow
// ─────────────────────────────────────────────────────────────────────────────

export async function connectMcpServer(
  input: ConnectMcpServerWorkflowInput,
): Promise<ConnectMcpServerWorkflowOutput> {
  const discovery = await discover.DiscoverMcpServerCapabilities({
    mcpServerId: input.mcp_server_id,
    executionContextId: input.execution_context_id ?? null,
    invokerIdentityAccountId: input.invoker_identity_account_id ?? null,
  });

  const canReusePreviousApprovals =
    discovery.newToolsFingerprint !== "" &&
    discovery.newToolsFingerprint === discovery.previousToolsFingerprint &&
    discovery.previousToolApprovals.length > 0;

  let toolApprovals: Array<{
    tool_name: string;
    requires_approval: boolean;
    message: string;
  }>;

  if (canReusePreviousApprovals) {
    log.info(
      `Tools unchanged for '${input.mcp_server_id}' ` +
        `(fingerprint ${discovery.newToolsFingerprint.slice(0, 12)}) — ` +
        `reusing ${discovery.previousToolApprovals.length} previous approval(s)`,
    );

    toolApprovals = discovery.previousToolApprovals.map((a) => ({
      tool_name: a.toolName,
      requires_approval: a.requiresApproval,
      message: a.message,
    }));
  } else {
    const classifyInput = {
      tools: discovery.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema ?? null,
      })),
      serverName: input.mcp_server_id,
      serverDescription: "",
      mcpServerId: input.mcp_server_id,
    };

    const classify = classifyWithTimeout(discovery.tools.length);
    toolApprovals = await classify.ClassifyToolApprovals(classifyInput);
  }

  return {
    tools: discovery.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema ?? null,
    })),
    resource_templates: discovery.resourceTemplates.map((rt) => ({
      uri_template: rt.uriTemplate,
      name: rt.name,
      description: rt.description,
      mime_type: rt.mimeType,
    })),
    tool_approvals: toolApprovals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DiscoverMcpServerWorkflow — legacy backward-compatible wrapper
// ─────────────────────────────────────────────────────────────────────────────

export async function discoverMcpServerLegacy(
  input: ConnectMcpServerWorkflowInput,
): Promise<DiscoverMcpServerWorkflowOutput> {
  const discovery = await discover.DiscoverMcpServerCapabilities({
    mcpServerId: input.mcp_server_id,
    executionContextId: input.execution_context_id ?? null,
    invokerIdentityAccountId: input.invoker_identity_account_id ?? null,
  });

  return {
    tools: discovery.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema ?? null,
    })),
    resource_templates: discovery.resourceTemplates.map((rt) => ({
      uri_template: rt.uriTemplate,
      name: rt.name,
      description: rt.description,
      mime_type: rt.mimeType,
    })),
    previous_tools_fingerprint: discovery.previousToolsFingerprint,
    previous_tool_approvals: discovery.previousToolApprovals.map((a) => ({
      tool_name: a.toolName,
      requires_approval: a.requiresApproval,
      message: a.message,
    })),
    new_tools_fingerprint: discovery.newToolsFingerprint,
  };
}
