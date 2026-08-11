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

import type {
  createDiscoverMcpServerActivities,
  DiscoveredToolResult,
  ToolApprovalDict,
} from "../activities/discover-mcp-server.js";
import type {
  createClassifyToolApprovalsActivities,
  ToolApprovalResult,
} from "../activities/classify-tool-approvals.js";

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

// Discovery's bounds ladder (issue #239): the activity heartbeats every 15s,
// so heartbeatTimeout is pure LIVENESS (dead worker/pod detection) — it no
// longer kills slow-but-alive discoveries. The activity bounds its own WORK
// with a transport-aware init timeout (30s HTTP / 270s stdio) that fails with
// an actionable, endpoint-naming error; startToCloseTimeout is the hard cap
// above both. Keep the ordering: work bound < hard cap, heartbeat interval
// (15s) < heartbeatTimeout.
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
// Incremental classification planner (pure, deterministic, sandbox-safe)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical, order-stable signature of a single tool's definition.
 *
 * Mirrors the shape `toolsFingerprint` hashes (name + description + input_schema)
 * so "unchanged" here means the same thing it means for the whole-server
 * fingerprint. Uses only JSON — no `node:crypto` — so it is safe to call from
 * inside the Temporal deterministic V8 isolate.
 */
function toolSignature(tool: DiscoveredToolResult): string {
  return JSON.stringify({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema ?? null,
  });
}

/**
 * Partition the freshly discovered tools into those that must be classified and
 * the prior approval decisions that can be carried forward verbatim.
 *
 * Reuse is **content-addressed**: a prior decision is kept only when a tool's
 * name AND full definition are byte-identical to the previous connect. This is
 * deliberately stricter than reusing by name alone — a tool can keep its name
 * while its schema changes from benign to destructive, and such a tool MUST be
 * re-evaluated rather than left with a stale "auto-approve". Tools that are
 * unchanged are never re-classified (stable, deterministic, no LLM cost; no
 * flapping for borderline tools), and a tool present last time but gone now is
 * simply absent from both outputs (dropped).
 *
 * The previous approval list is a presence-set of *gated* tools (a tool in
 * `previousToolApprovals` requires approval; a known tool absent from it was
 * auto-approved). So a reused tool emits a carried-forward entry only when it
 * was gated; reused auto-approved tools emit nothing, which correctly keeps them
 * un-gated. `ClassifyToolApprovals` likewise returns only gated entries, so the
 * union `[...carriedForward, ...classified]` is the complete gated set.
 *
 * Pure and free of Temporal APIs so it can be exhaustively unit-tested and is
 * safe to evaluate inside the workflow sandbox.
 */
export function planIncrementalClassification(
  previousTools: DiscoveredToolResult[],
  previousToolApprovals: ToolApprovalDict[],
  currentTools: DiscoveredToolResult[],
): { toolsToClassify: DiscoveredToolResult[]; carriedForward: ToolApprovalResult[] } {
  const prevSigByName = new Map<string, string>();
  for (const tool of previousTools) {
    prevSigByName.set(tool.name, toolSignature(tool));
  }

  const prevGatedByName = new Map<string, ToolApprovalDict>();
  for (const approval of previousToolApprovals) {
    prevGatedByName.set(approval.toolName, approval);
  }

  const toolsToClassify: DiscoveredToolResult[] = [];
  const carriedForward: ToolApprovalResult[] = [];

  for (const tool of currentTools) {
    const prevSig = prevSigByName.get(tool.name);
    const unchanged = prevSig !== undefined && prevSig === toolSignature(tool);

    if (!unchanged) {
      toolsToClassify.push(tool);
      continue;
    }

    const gated = prevGatedByName.get(tool.name);
    if (gated) {
      carriedForward.push({
        tool_name: gated.toolName,
        requires_approval: true,
        message: gated.message,
      });
    }
    // An unchanged tool that was not gated stays auto-approved — emit nothing.
  }

  return { toolsToClassify, carriedForward };
}

// ─────────────────────────────────────────────────────────────────────────────
// destructiveHint fail-closed tightener (pure, deterministic, sandbox-safe)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Force-gate any tool whose live MCP annotation declares `destructiveHint:true`
 * but that the classifier (or carry-forward) left un-gated.
 *
 * This is the ONLY way annotations influence policy, and it is deliberately
 * one-directional. The MCP spec warns that clients must never make tool-use
 * decisions on annotations from untrusted servers; trusting a server's
 * "I am destructive" claim only ever ADDS an approval prompt (the safe
 * direction), so it cannot be abused. The inverse — trusting `readOnlyHint` to
 * AUTO-APPROVE — is exactly the unsafe direction the spec forbids, so a spoofed
 * `readOnlyHint:true` on a destructive tool must never relax it. Read-only
 * auto-approval authority lives solely with the trusted LLM classifier.
 *
 * Recomputed from live discovery on every connect, so it has zero coupling to
 * `toolSignature`/incremental reuse and needs no persistence. Pure JS so it is
 * safe to evaluate inside the Temporal deterministic isolate.
 */
export function applyDestructiveHintTightener(
  gated: ToolApprovalResult[],
  currentTools: DiscoveredToolResult[],
): { tightened: ToolApprovalResult[]; addedCount: number } {
  const gatedNames = new Set(gated.map((g) => g.tool_name));
  const tightened = [...gated];
  let addedCount = 0;

  for (const tool of currentTools) {
    if (tool.annotations?.destructiveHint === true && !gatedNames.has(tool.name)) {
      tightened.push({
        tool_name: tool.name,
        requires_approval: true,
        message: `Execute ${tool.name}`,
        from_destructive_hint: true,
      });
      gatedNames.add(tool.name);
      addedCount++;
    }
  }

  return { tightened, addedCount };
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

  // Content-addressed incremental classification: reuse prior decisions for
  // tools whose definition is unchanged, and classify only the new or changed
  // ones. Keeps decisions stable/deterministic across reconnects and avoids
  // redundant LLM calls, while still re-evaluating a tool whose schema changed.
  const { toolsToClassify, carriedForward } = planIncrementalClassification(
    discovery.previousTools,
    discovery.previousToolApprovals,
    discovery.tools,
  );

  let toolApprovals: ToolApprovalResult[];

  if (toolsToClassify.length === 0) {
    log.info(
      `Tools unchanged for '${input.mcp_server_id}' — reusing ` +
        `${carriedForward.length} previous approval(s), no classification needed`,
    );
    toolApprovals = carriedForward;
  } else {
    log.info(
      `Classifying ${toolsToClassify.length} new/changed tool(s) for ` +
        `'${input.mcp_server_id}', reusing ${carriedForward.length} prior decision(s)`,
    );

    const classifyInput = {
      tools: toolsToClassify.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema ?? null,
      })),
      serverName: input.mcp_server_id,
      serverDescription: "",
      mcpServerId: input.mcp_server_id,
    };

    const classify = classifyWithTimeout(toolsToClassify.length);
    const classified = await classify.ClassifyToolApprovals(classifyInput);
    toolApprovals = [...carriedForward, ...classified];
  }

  // Fail-closed tightener over the FULL live tool set: a tool the server's own
  // annotation marks destructiveHint=true is force-gated if it slipped through
  // un-gated. Runs on live discovery (not the reused/classified subset), so it
  // also re-asserts gating for carried-forward tools whose server later flips a
  // tool to destructive. We never trust readOnlyHint to relax — see the
  // tightener's contract for the MCP untrusted-hints rationale.
  const { tightened, addedCount } = applyDestructiveHintTightener(
    toolApprovals,
    discovery.tools,
  );
  if (addedCount > 0) {
    log.info(
      `Force-gated ${addedCount} tool(s) via destructiveHint annotation for ` +
        `'${input.mcp_server_id}'`,
    );
  }
  toolApprovals = tightened;

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
