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
 *
 * The lists drive compiles the agent's lists into the state file exactly as
 * the runner does (`hook-scope.ts`), then asks the same hook. A refusal is
 * told apart from an approval gate by the out-of-scope message the hook hands
 * the model. Sub-agent lists are not driven here: the hook cannot tell which
 * sub-agent calls, so the engine refuses such a turn at setup instead
 * (`enforcesSubAgentLists: false`, pinned by `__tests__/check-tool-scope.test.ts`).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setupCursorHookHarness, hasBash, hookInputFor, hookRead, streamArgsFor, STREAM_NAME } from "./cursor-hook-harness.js";
import { toolIdentity, type ApprovalGrant } from "../approval-state.js";
import { contentDigest } from "../../../shared/file-tools.js";
import type { ApprovalCategory } from "../approval-policy.js";
import type {
  ContractToolLists,
  GatewayDecision,
  GatewayOutcome,
  GatewaySubstrate,
  ListsDriveOptions,
  ListsOutcome,
  ProposedAction,
} from "../../../__test-utils__/approval-contract/types.js";

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
  const args = streamArgsFor({ ...action, kind: action.kind });
  const identity = toolIdentity(streamName, "", args);
  return {
    toolName: streamName,
    mcpServerSlug: "",
    key: identity.key,
    salient: identity.salient,
    // Content-exact for a write (the sibling-isolation probe), coarse otherwise —
    // matching how the runner grants from the authoritative captured args.
    contentDigest: contentDigest(args),
    sourceToolCallId: `consent-${action.kind}`,
  };
}

/** The harness's destructive set for an action: its MCP tool, when its server marks it destructive. */
function destructiveToolsOf(action: ProposedAction): string[] {
  return action.kind === "mcp" && action.mcpDestructive ? [action.mcpToolName ?? "mcp_tool"] : [];
}

async function decide(grants: ApprovalGrant[], action: ProposedAction): Promise<GatewayOutcome> {
  // An MCP tool asks only when its server marks it destructive; built-ins are
  // gated by the script's baked-in category set, not state.
  const harness = setupCursorHookHarness({ grants, destructiveMcpTools: destructiveToolsOf(action) });
  const { permission } = harness.decide(hookInputFor(action));
  const executed = permission === "allow";
  return { executed, gated: !executed };
}

// A gated built-in's contract kind IS its approval category (write/shell/delete),
// so it doubles as the leasedCategories entry the hook reads.
function leaseCategoryOf(action: ProposedAction): ApprovalCategory {
  if (action.kind === "read" || action.kind === "mcp") {
    throw new Error(`leaseCategoryOf: ${action.kind} is not a leasable built-in class`);
  }
  return action.kind;
}

export function createCursorSubstrate(): GatewaySubstrate {
  return {
    name: "cursor",
    available: hasBash,
    capabilities: {
      observesExecution: false,
      enforcesExactResource: true,
      // The grant binds (category, path, contentDigest), so a DIFFERENT edit to
      // the same file re-gates — the sibling-hole fix.
      enforcesExactContent: true,
      appliesRunLifetimeLease: true,
      enforcesSubAgentLists: false,
      // The Cursor engine refuses a turn whose agent has hooks until it runs
      // them (`harness/turn-context.ts` `refuseUnrunnableHooks`).
      runsHooks: false,
      // The Cursor hook's deny decision does not carry approval_policy_source;
      // provenance is projected at translation time (the Cursor translator)
      // and asserted by the corpus + resolveApprovalProvenance suites instead.
      surfacesGatePolicySource: false,
    },

    async authorize(action: ProposedAction, decision: GatewayDecision): Promise<GatewayOutcome> {
      const grants = decision === "approve" ? [grantFor(action)] : [];
      return decide(grants, action);
    },

    async authorizeAfterGrant(granted: ProposedAction, probe: ProposedAction): Promise<GatewayOutcome> {
      return decide([grantFor(granted)], probe);
    },

    async authorizeUnderClassLease(leased: ProposedAction, probe: ProposedAction): Promise<GatewayOutcome> {
      // A run-lifetime category lease is carried in the state file (no per-call
      // grant), exactly as the runner writes it after an APPROVE_ALL; the hook
      // allows a probe iff its category is leased.
      const harness = setupCursorHookHarness({ leasedCategories: [leaseCategoryOf(leased)] });
      const { permission } = harness.decide(hookInputFor(probe));
      const executed = permission === "allow";
      return { executed, gated: !executed };
    },

    async authorizeUnderLists(
      lists: ContractToolLists,
      action: ProposedAction,
      options: ListsDriveOptions = {},
    ): Promise<ListsOutcome> {
      if (options.subAgent) {
        throw new Error("cursor substrate: sub-agent lists are refused at setup, never driven through the hook");
      }
      const slug = action.mcpServerSlug ?? "srv";
      const harness = setupCursorHookHarness({
        lists,
        autoApproveAll: options.autoApproveAll ?? false,
        destructiveMcpTools: destructiveToolsOf(action),
        mcpServers: [{ slug, discoveredToolNames: null }],
      });
      // The platform's content exists in the platform dir the turn's
      // `.stigmer` links to: an excluded Read is admitted by the file's real
      // path, so the file the action names is put there first.
      const platformRead = action.kind === "read" && action.platformContent;
      if (platformRead) {
        const file = join(harness.platformDir, action.resource);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, action.content ?? "platform content", "utf-8");
      }
      const input = platformRead ? hookRead(join(harness.root, ".stigmer", action.resource)) : hookInputFor(action);
      const { permission, raw } = harness.decide(input);
      const refused = permission === "deny" && raw.includes("is not available to this agent");
      const executed = permission === "allow";
      return { executed, gated: !executed && !refused, refused };
    },
  };
}
