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
 *
 * The hooks drive runs the agent's hooks as the engine does: the real gate
 * script asks a real hook server (`hook-server.ts`) in this process, which
 * runs the contract's real commands through the evaluator over this
 * engine's views (`hook-views.ts`). `executed` is again the gate's allow; a
 * card is an approval-kind ledger entry; a decision on it is the next
 * turn's gate, with the approval's grant or the person's refusal, as the
 * runtime installs them. An allowed MCP call then gets its `postToolUse`
 * run, and the model reads the context the gate hands back.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setupCursorHookHarness, hasBash, hookInputFor, hookMcp, hookRead, streamArgsFor, STREAM_NAME } from "./cursor-hook-harness.js";
import { decodeIdentityToken, toolIdentity, type ApprovalGrant, type PersonRefusal } from "../approval-state.js";
import { approvalDigest } from "../boundary-rows.js";
import { startHookServer } from "../hook-server.js";
import { CursorEngineToolViews, rowNameOf } from "../hook-views.js";
import { hookLeaseKey } from "../../../shared/approval-policy.js";
import { HookEvaluator } from "../../../shared/hooks/evaluate.js";
import { HookSet } from "../../../shared/hooks/hook-set.js";
import { buildShellEnv } from "../../../shared/shell-env.js";
import { contractHookSources } from "../../../__test-utils__/approval-contract/hook-commands.js";
import { contentDigest } from "../../../shared/file-tools.js";
import type { ApprovalCategory } from "../approval-policy.js";
import type {
  ContractHook,
  ContractToolLists,
  GatewayDecision,
  GatewayOutcome,
  GatewaySubstrate,
  HooksDriveOptions,
  HooksOutcome,
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

/** The engine's call for a hooks probe, as the hook server receives it: the hook's name and input, the server for MCP. */
function hooksCallOf(action: ProposedAction): { name: string; args: Record<string, unknown>; serverSlug: string } {
  if (action.kind === "mcp") return { name: action.mcpToolName ?? "mcp_tool", args: {}, serverSlug: action.mcpServerSlug ?? "srv" };
  const payload = hookInputFor(action) as { tool_name: string; tool_input: Record<string, unknown> };
  return { name: payload.tool_name, args: payload.tool_input, serverSlug: "" };
}

/** The pre-execution payload for a hooks probe: `beforeMCPExecution` for MCP, `preToolUse` for a built-in. */
function prePayloadOf(action: ProposedAction): object {
  if (action.kind === "mcp") return hookMcp(action.mcpToolName ?? "mcp_tool", {}, action.mcpServerSlug ?? "srv");
  return { ...hookInputFor(action), hook_event_name: "preToolUse", tool_use_id: "call_1" };
}

/** Claude Code's input for an action a hook rewrites a call into, with the content the call carried. */
function rewriteInputOf(action: ProposedAction): Record<string, unknown> {
  switch (action.kind) {
    case "write":
      return { file_path: action.resource, content: action.content ?? "x" };
    case "shell":
      return { command: action.resource };
    default:
      throw new Error(`rewriteInputOf: no rewrite into a ${action.kind} action`);
  }
}

/** What the gate's answer told the model: its message, or the context an allow carried. */
function modelReadOf(raw: string): string {
  try {
    const answer = JSON.parse(raw.trim()) as { agent_message?: unknown; additional_context?: unknown };
    return [answer.agent_message, answer.additional_context].filter((t): t is string => typeof t === "string").join("\n");
  } catch {
    return raw;
  }
}

/** Drive one action through the tool lists, the gate and the agent's hooks, as one turn and, on a decision, the next. */
async function runCursorHooksProbe(hooks: readonly ContractHook[], action: ProposedAction, options: HooksDriveOptions): Promise<HooksOutcome> {
  const pluginRoot = mkdtempSync(join(tmpdir(), "contract-cursor-hook-plugin-"));
  try {
    const files = { runs: join(pluginRoot, "runs.jsonl"), state: join(pluginRoot, "asked") };
    const leased = options.hookLease;
    const leasedCall = leased ? hooksCallOf(leased.action) : undefined;
    const evaluator = new HookEvaluator({
      set: HookSet.of(contractHookSources(hooks, files, pluginRoot, rewriteInputOf)),
      views: new CursorEngineToolViews({ workspaceRoot: "/", pluginServers: new Map(), platformServerSlugs: new Set() }),
      sessionId: "contract-session",
      workspaceRoot: pluginRoot,
      permissionMode: options.autoApproveAll ? "bypassPermissions" : "default",
      baseEnv: buildShellEnv({}),
      homeDir: pluginRoot,
      leases: leased && leasedCall ? new Set([hookLeaseKey(leased.plugin, leasedCall.serverSlug, rowNameOf(leasedCall))]) : new Set(),
    });

    /** One turn's gate: a fresh server and state, as the runtime installs them. */
    const turn = async (grants: ApprovalGrant[], refusals: ReadonlyMap<string, PersonRefusal>) => {
      const server = await startHookServer({ evaluator, refusals, captureMode: false, globalBypass: false });
      try {
        const harness = setupCursorHookHarness({
          grants,
          autoApproveAll: options.autoApproveAll ?? false,
          unattendedSkip: options.unattended ?? false,
          ...(options.categoryLease ? { leasedCategories: [options.categoryLease] } : {}),
          ...(options.lists ? { lists: options.lists, mcpServers: [{ slug: action.mcpServerSlug ?? "srv", discoveredToolNames: null }] } : {}),
          destructiveMcpTools: destructiveToolsOf(action),
          hookServer: { socketPath: server.socketPath, token: server.token },
        });
        const answer = await harness.decideAsync(prePayloadOf(action));
        let post = "";
        if (answer.permission === "allow" && action.kind === "mcp" && !options.failTool) {
          const postAnswer = await harness.decideAsync({
            hook_event_name: "postToolUse",
            tool_name: `MCP:${action.mcpToolName ?? "mcp_tool"}`,
            tool_input: {},
            tool_output: JSON.stringify({ content: [{ type: "text", text: "found three issues" }], isError: false }),
          });
          post = modelReadOf(postAnswer.raw);
        }
        return { ...answer, post, ledger: harness.ledger() };
      } finally {
        await server.close();
      }
    };

    const first = await turn([], new Map());
    const card = first.ledger.find((e) => (e.kind ?? "approval") === "approval");
    const decision = options.decision ?? "none";
    let final = first;
    if (card !== undefined && decision !== "none") {
      const decoded = decodeIdentityToken(card.token)!;
      const call = hooksCallOf(action);
      // The grant the boundary leaves, by its own rule (`approvalDigest`): a
      // hook's ask on a call without file content is approved under the
      // call's whole input, as the hook saw it.
      const input = card.input ? (JSON.parse(Buffer.from(card.input, "base64").toString("utf-8")) as Record<string, unknown>) : undefined;
      const digest = approvalDigest(call.serverSlug, decoded.digest, input, card.hook !== undefined);
      final = decision === "approve"
        ? await turn([{ toolName: rowNameOf(call), mcpServerSlug: call.serverSlug, key: decoded.key, salient: decoded.salient, contentDigest: digest, sourceToolCallId: "consent-hook" }], new Map())
        : await turn([], new Map([[card.token, { action: decision === "skip" ? "skip" : "reject", toolName: rowNameOf(call) } as const]]));
    }

    const executed = final.permission === "allow";
    // A `hook` entry names the hook that refused; one that names none is a
    // person's earlier refusal standing over a hook's allow.
    const refusedBy = final.ledger.some((e) => e.kind === "disabled")
      ? "lists" as const
      : final.ledger.some((e) => e.kind === "hook" && e.hook !== undefined)
        ? "hook" as const
        : undefined;
    const cardHook = card?.hook;
    const call = hooksCallOf(action);
    const rewritten = executed ? (JSON.parse(final.raw.trim()) as { updated_input?: { file_path?: unknown } }).updated_input : undefined;
    const writtenPath = typeof rewritten?.file_path === "string" ? rewritten.file_path : call.args["file_path"];
    const hookRuns = existsSync(files.runs)
      ? readFileSync(files.runs, "utf-8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
      : [];
    return {
      executed,
      gated: card !== undefined,
      policySource: card === undefined ? "" : cardHook !== undefined ? "hook" : action.kind === "mcp" ? "annotation_destructive_tighten" : "builtin_category",
      ...(cardHook !== undefined ? { policyHook: cardHook === "=" ? "" : Buffer.from(cardHook, "base64").toString("utf-8") } : {}),
      refusedBy,
      modelRead: [action.kind === "mcp" && executed ? "found three issues" : "", modelReadOf(final.raw), final.post].filter((t) => t !== "").join("\n"),
      hookRuns,
      writtenPaths: executed && action.kind === "write" && typeof writtenPath === "string" ? [writtenPath] : [],
    };
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
  }
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
      // The gate's script asks the runner's hook server (`hook-server.ts`).
      runsHooks: true,
      // Cursor's hook payload names no sub-agent (live probe, 2026-10-05).
      hookSeesSubAgent: false,
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

    async authorizeUnderHooks(hooks: readonly ContractHook[], action: ProposedAction, options: HooksDriveOptions = {}): Promise<HooksOutcome> {
      if (options.subAgent) throw new Error("cursor substrate: a hook cannot tell a sub-agent's call here (hookSeesSubAgent: false)");
      return runCursorHooksProbe(hooks, action, options);
    },
  };
}
