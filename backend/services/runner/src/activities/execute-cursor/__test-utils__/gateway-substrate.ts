/**
 * Cursor deny-oracle adapter for the HITL gateway Contract Test Kit.
 *
 * Drives the REAL out-of-process gateway: the runner writes the approval state
 * file (with any grants), then the generated bash preToolUse hook makes the
 * allow/deny decision for the tool the agent would run inside cursor-agent. There
 * is no in-process execution to observe, so `executed` means "the hook allowed
 * it" and the substrate cannot count executions (`observesExecution: false`).
 *
 * Cross-taxonomy by construction: grants are minted from the STREAM-side identity
 * (`edit`/`shell`/`delete`), while the hook is fed the HOOK-side payload
 * (`Write`/`Shell`/`Delete`). So every approve drive exercises the category
 * collapse that lets a stream-minted grant match a hook-named call. The grant
 * token binds the exact resource, so this substrate enforces lease isolation
 * (`enforcesExactResource: true`) and implements `authorizeAfterGrant`.
 */

import {
  setupCursorHookHarness,
  hasBash,
  hookWrite,
  hookShell,
  hookDelete,
  hookRead,
  hookMcp,
} from "./cursor-hook-harness.js";
import { toolIdentity, type ApprovalGrant } from "../approval-state.js";
import type {
  GatewayDecision,
  GatewayOutcome,
  GatewaySubstrate,
  ProposedAction,
} from "../../../__test-utils__/approval-contract/types.js";

/** Build the real preToolUse hook-input payload for an abstract action. */
function hookInputFor(action: ProposedAction): object {
  switch (action.kind) {
    case "write":
      return hookWrite(action.resource);
    case "shell":
      return hookShell(action.resource);
    case "delete":
      return hookDelete(action.resource);
    case "read":
      return hookRead(action.resource);
    case "mcp":
      return hookMcp(action.mcpToolName ?? "mcp_tool");
  }
}

// Stream-side (SDK) tool name per gated category — deliberately the OTHER
// taxonomy from the hook input, so a grant minted here matches a hook-named call
// only via the canonical category, not the raw name.
const STREAM_NAME: Record<"write" | "shell" | "delete", string> = {
  write: "edit",
  shell: "shell",
  delete: "delete",
};

/**
 * Mint the approval grant for an action using its stream-side identity. Only the
 * gated built-in categories are ever granted in the contract (read is never
 * gated; the MCP cases under test are auto-approved, needing no grant).
 */
function grantFor(action: ProposedAction): ApprovalGrant {
  if (action.kind === "read" || action.kind === "mcp") {
    throw new Error(`grantFor: ${action.kind} actions are not granted in the contract`);
  }
  const streamName = STREAM_NAME[action.kind];
  const args = action.kind === "shell" ? { command: action.resource } : { path: action.resource };
  const identity = toolIdentity(streamName, "", args);
  return { toolName: streamName, mcpServerSlug: "", key: identity.key, salient: identity.salient };
}

async function decide(grants: ApprovalGrant[], action: ProposedAction): Promise<GatewayOutcome> {
  // MCP cases under test are auto-approved: no policy entry, so the hook allows
  // them. Built-ins are gated by the script's baked-in category set, not state.
  const harness = setupCursorHookHarness({ grants });
  const { permission } = harness.decide(hookInputFor(action));
  const executed = permission === "allow";
  return { executed, gated: !executed };
}

export function createCursorSubstrate(): GatewaySubstrate {
  return {
    name: "cursor",
    available: hasBash,
    capabilities: { observesExecution: false, enforcesExactResource: true },

    async authorize(action: ProposedAction, decision: GatewayDecision): Promise<GatewayOutcome> {
      const grants = decision === "approve" ? [grantFor(action)] : [];
      return decide(grants, action);
    },

    async authorizeAfterGrant(granted: ProposedAction, probe: ProposedAction): Promise<GatewayOutcome> {
      return decide([grantFor(granted)], probe);
    },
  };
}
