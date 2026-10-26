/**
 * Claude adapter for the HITL gateway Contract Test Kit.
 *
 * Drives the REAL gate (`gate.ts`): the production `ClaudeGate`, its
 * `PreToolUse` callback and `canUseTool`, the hooks' feedback callbacks
 * (`hooks.ts`), the admission the host's tools run under, and the agents'
 * reach as a turn computes it (`agents.ts` `turnAgentsOf`). What stands in
 * for the engine is only its calling convention, measured on SDK 0.3.310:
 * a call reaches `PreToolUse`, then `canUseTool` unless the callback
 * deferred or refused it; an allowed call runs with the rewritten input
 * either returns; a deferred call stops the invocation, and the next one
 * re-fires the same call, by the same id, before anything else, its gate
 * built over the person's answer and the WAITING row's call. The engine's
 * own process is the hermetic suites' (`__tests__/hermetic/`), not this
 * kit's: its question is the gate's decision.
 *
 * Execution is real and counted: a write writes the workspace file, a read
 * reads it, a shell command runs in bash through the host shell's admission
 * and leaves a mark, an MCP tool counts its calls behind the same
 * admission. A delete is the shell's `rm`: this engine has no file tool
 * that deletes. Every hook is a real command run by bash, shared with the
 * other substrates (`approval-contract/hook-commands.ts`).
 *
 * Capabilities: an approval binds the exact call it answers, by its id and
 * its arguments as the person saw them, so a grant never authorizes another
 * resource, another content or another tool (`authorizeAfterGrant`: the
 * engine re-fires the approved id with the probe's call).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ApprovalAction, ApprovalPolicySource } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { deriveLeaseScope, hookLeaseKey, mcpToolKey, type ActiveLeases, type McpApprovalDefault } from "../../../shared/approval-policy.js";
import { HookEvaluator } from "../../../shared/hooks/evaluate.js";
import { HookSet } from "../../../shared/hooks/hook-set.js";
import type { ResolvedMcpServer } from "../../../shared/mcp-resolver.js";
import { buildShellEnv } from "../../../shared/shell-env.js";
import { skillContentReadCheck } from "../../../shared/skill-mount.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import type { ToolApprovalCategory } from "../../../shared/tool-kind.js";
import { contractHookSources } from "../../../__test-utils__/approval-contract/hook-commands.js";
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
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import { turnAgentsOf, type SubagentSpec } from "../agents.js";
import { ClaudeGate, canUseToolOf, gateHooks, notOfferedMessage, type GateFacts, type Reach, type WaitingCall } from "../gate.js";
import { ClaudeToolViews } from "../hook-views.js";
import { HookFeedback, NO_HOOKS, type TurnHookEvaluators } from "../hooks.js";
import { HOST_SHELL_TOOL } from "../host-shell.js";
import { mcpToolName } from "../mcp-bridge.js";

/** The kit's MCP server and every tool it lists. */
const SERVER = "srv";
const SERVER_TOOLS = ["search_issues", "close_issue", "delete_repository"];

/** The call id every drive's call carries; the resumed invocation re-fires it. */
const CALL_ID = "toolu_contract_1";

/** The sub-agent a drive's call is made in, and the engine's id for it. */
const HELPER = "helper";
const HELPER_ID = "agent_contract_1";

/** The marker file a shell probe appends to when it runs, one line per run. */
const SHELL_RAN = ".contract-ran";

/** The write resources a probe may create, checked after it runs. */
const WRITE_RESOURCES = ["/work/alpha.txt", "/work/beta.txt", "/work/.env"];

/** One call as the engine makes it: its engine name and input. */
interface EngineCall {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** The engine's call for an action, in the workspace `root`. */
function engineCallOf(action: ProposedAction, root: string): EngineCall {
  switch (action.kind) {
    case "write":
      return { name: "Write", input: { file_path: join(root, action.resource), content: action.content ?? "x" } };
    case "shell":
      return { name: HOST_SHELL_TOOL.aliasedName, input: { command: `${action.resource}; echo ran >> ${SHELL_RAN}` } };
    case "delete":
      return { name: HOST_SHELL_TOOL.aliasedName, input: { command: `rm -f ${join(root, action.resource)}; echo ran >> ${SHELL_RAN}` } };
    case "read":
      return { name: "Read", input: { file_path: action.platformContent ? join(root, ".stigmer", action.resource) : join(root, action.resource) } };
    case "mcp":
      return { name: mcpToolName(action.mcpServerSlug ?? SERVER, action.mcpToolName ?? "search_issues"), input: {} };
    default: {
      const exhaustive: never = action.kind;
      throw new Error(`engineCallOf: unknown action kind ${String(exhaustive)}`);
    }
  }
}

/** The name a call's WAITING row carries: `Bash` for the host's shell, an MCP tool's bare name. */
function rowNameOf(call: EngineCall): string {
  return call.name === HOST_SHELL_TOOL.aliasedName ? HOST_SHELL_TOOL.engineName : (serverOf(call.name)?.tool ?? call.name);
}

/** The MCP server and tool an engine name stands for. */
function serverOf(name: string): { slug: string; tool: string } | undefined {
  const match = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  return match === null || match[1] === HOST_SHELL_TOOL.server ? undefined : { slug: match[1]!, tool: match[2]! };
}

/** Claude Code's input for an action a hook rewrites a call into. */
function rewriteInputOf(action: ProposedAction, root: string): Record<string, unknown> {
  return engineCallOf(action, root).input;
}

/** The kit's MCP server, resolved as the agent's own. */
const SRV: ResolvedMcpServer = { slug: SERVER, connectionType: "http", home: { kind: "agent", agentId: "agt_contract", subagent: null, server: SERVER } };

/** Each agent's reach under `lists` (the agent's) and `subLists` (a sub-agent's, narrowed from them), as a turn computes it. */
function reachOf(lists: ContractToolLists | undefined, subLists: ContractToolLists | undefined): { root: Reach; subagents: Map<string, Reach> } {
  const scope = lists === undefined ? ToolScope.unrestricted() : ToolScope.of('Agent "contract"', lists);
  const input = turnInputFixture({
    mcp: { ...turnInputFixture().mcp, servers: [SRV], toolScope: scope },
  });
  const helperScope = subLists === undefined ? scope : scope.narrow('Sub-agent "helper"', subLists);
  const spec: SubagentSpec = { name: HELPER, kind: "saved", description: HELPER, instructions: "", scope: helperScope, skills: [], servers: [SRV], model: undefined, shellValues: {} };
  const offered = new Set(SERVER_TOOLS.map((tool) => mcpToolName(SERVER, tool)));
  const agents = turnAgentsOf(input, [spec], { offered, serverOf }, { planMode: false, structuredOutput: false });
  return { root: agents.root.reach, subagents: new Map([...agents.subagents].map(([name, world]) => [name, world.reach])) };
}

/** The approval default for one probe: its MCP tool asks only when the action says its server marks it destructive. */
function mcpDefaultFor(action: ProposedAction): McpApprovalDefault {
  const destructive = new Set<string>();
  if (action.kind === "mcp" && action.mcpDestructive) destructive.add(mcpToolKey(action.mcpServerSlug ?? SERVER, action.mcpToolName ?? "search_issues"));
  return { destructive, unlisted: new Set<string>(), leasedServers: new Set() };
}

/** What one drive's world holds. */
interface DriveWorld {
  readonly root: string;
  readonly reach: { root: Reach; subagents: Map<string, Reach> };
  readonly leases: ActiveLeases;
  readonly mcpDefault: McpApprovalDefault;
  readonly unattended: boolean;
  readonly hooks: TurnHookEvaluators;
  readonly failTool: boolean;
  readonly subAgent: boolean;
}

/** The gate's facts for one invocation of a drive, over a person's answer when the run resumes. */
function factsOf(world: DriveWorld, answer: { decision: ApprovalAction; shown: WaitingCall } | undefined): GateFacts {
  return {
    root: world.reach.root,
    subagents: world.reach.subagents,
    serverOf,
    leases: world.leases,
    mcpDefault: world.mcpDefault,
    unattended: world.unattended,
    posture: { fileCaptureMode: false, fileReviewOff: false, fileCaptureSubstrate: false, isCapturablePath: async () => false, captureIgnored: false },
    primaryDir: world.root,
    platformDir: undefined,
    engineHome: join(world.root, ".engine-home"),
    readsSkillContent: skillContentReadCheck(undefined),
    hooks: world.hooks,
    decisions: answer === undefined || answer.decision === ApprovalAction.UNSPECIFIED ? new Map() : new Map([[CALL_ID, answer.decision]]),
    denyMessages: new Map(),
    waitingCallOf: (id) => (answer !== undefined && id === CALL_ID ? answer.shown : undefined),
    staleCallId: undefined,
    unproposedCallId: undefined,
    observer: undefined,
  };
}

/** What one invocation made of the call. */
interface Invocation {
  readonly gate: ClaudeGate;
  readonly ran: boolean;
  readonly deferred: boolean;
  readonly modelRead: string;
}

/** Counts of what ran across a drive's invocations. */
interface Counts {
  mcp: number;
}

/** Run one call through one invocation's gate as the engine does (the header). */
async function invoke(world: DriveWorld, gate: ClaudeGate, call: EngineCall, counts: Counts): Promise<Invocation> {
  const signal = new AbortController().signal;
  const agentId = world.subAgent ? HELPER_ID : undefined;
  if (world.subAgent) gate.subagentStarted(HELPER_ID, HELPER);
  const base = { session_id: "contract", transcript_path: "", cwd: world.root };
  const pre = await gateHooks(gate).PreToolUse![0]!.hooks[0]!(
    { ...base, hook_event_name: "PreToolUse", tool_name: call.name, tool_input: call.input, tool_use_id: CALL_ID, ...(agentId !== undefined ? { agent_id: agentId, agent_type: HELPER } : {}) },
    CALL_ID,
    { signal },
  );
  const out = (pre as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; updatedInput?: Record<string, unknown> } }).hookSpecificOutput;
  if (out?.permissionDecision === "defer") return { gate, ran: false, deferred: true, modelRead: "" };
  if (out?.permissionDecision === "deny") return { gate, ran: false, deferred: false, modelRead: out.permissionDecisionReason ?? "" };
  const permission = await canUseToolOf(gate)(call.name, out?.updatedInput ?? call.input, { signal, toolUseID: CALL_ID, requestId: "r", ...(agentId !== undefined ? { agentID: agentId } : {}) });
  if (permission === null || permission.behavior === "deny") return { gate, ran: false, deferred: false, modelRead: permission?.behavior === "deny" ? permission.message : "" };
  const args = permission.updatedInput ?? out?.updatedInput ?? call.input;
  const result = runTool(world, gate, call.name, args, counts);
  const feedback = new HookFeedback({ hooks: world.hooks, verdictOf: (id) => gate.verdictOf(id), serverOf }).callbacks();
  const after = result.ok
    ? await feedback.PostToolUse![0]!.hooks[0]!({ ...base, hook_event_name: "PostToolUse", tool_name: call.name, tool_input: args, tool_response: [{ type: "text", text: result.text }], tool_use_id: CALL_ID, ...(agentId !== undefined ? { agent_id: agentId } : {}) }, CALL_ID, { signal })
    : await feedback.PostToolUseFailure![0]!.hooks[0]!({ ...base, hook_event_name: "PostToolUseFailure", tool_name: call.name, tool_input: args, tool_use_id: CALL_ID, error: result.text, ...(agentId !== undefined ? { agent_id: agentId } : {}) }, CALL_ID, { signal });
  const context = (after as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext;
  return { gate, ran: result.ran, deferred: false, modelRead: context === undefined ? result.text : `${result.text}\n\n${context}` };
}

/** The tool itself, as the engine (a built-in) or the host (its shell, a bridged server) runs it. */
function runTool(world: DriveWorld, gate: ClaudeGate, name: string, args: Record<string, unknown>, counts: Counts): { ran: boolean; ok: boolean; text: string } {
  if (name === "Write") {
    const path = String(args.file_path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(args.content ?? ""));
    return { ran: true, ok: true, text: "File created successfully" };
  }
  if (name === "Read") {
    const path = String(args.file_path);
    return existsSync(path) ? { ran: true, ok: true, text: readFileSync(path, "utf8") } : { ran: true, ok: false, text: "File does not exist." };
  }
  const server = name === HOST_SHELL_TOOL.aliasedName ? { slug: HOST_SHELL_TOOL.server, tool: HOST_SHELL_TOOL.tool } : serverOf(name);
  if (server === undefined) return { ran: false, ok: false, text: `the engine has no tool ${name}` };
  const refused = gate.admit({ server: server.slug, tool: server.tool, args, toolUseId: CALL_ID });
  if (refused !== undefined) return { ran: false, ok: false, text: refused };
  if (server.slug === HOST_SHELL_TOOL.server) {
    try {
      return { ran: true, ok: true, text: execFileSync("bash", ["-c", String(args.command)], { cwd: world.root, env: buildShellEnv({}), encoding: "utf8" }) };
    } catch (err) {
      return { ran: true, ok: false, text: err instanceof Error ? err.message : String(err) };
    }
  }
  counts.mcp += 1;
  return world.failTool ? { ran: true, ok: false, text: "the server failed" } : { ran: true, ok: true, text: "found three issues" };
}

/** A person's decision as the log answers it: none for no decision, or for one the runtime does not know. */
function answerOf(decision: GatewayDecision): ApprovalAction {
  switch (decision) {
    case "approve":
      return ApprovalAction.APPROVE;
    case "reject":
      return ApprovalAction.REJECT;
    case "skip":
      return ApprovalAction.SKIP;
    default:
      return ApprovalAction.UNSPECIFIED;
  }
}

/** One drive: the call through its first invocation, then, when it paused and a decision came, through the resumed one re-firing `resumed`. */
async function drive(
  world: DriveWorld,
  call: EngineCall,
  decision: GatewayDecision,
  resumed: EngineCall = call,
): Promise<{ first: Invocation; last: Invocation; counts: Counts }> {
  const counts: Counts = { mcp: 0 };
  const first = await invoke(world, new ClaudeGate(factsOf(world, undefined)), call, counts);
  if (!first.deferred || decision === "none") return { first, last: first, counts };
  const shown: WaitingCall = { name: rowNameOf(call), mcpServerSlug: serverOf(call.name)?.slug ?? "", args: call.input };
  const last = await invoke(world, new ClaudeGate(factsOf(world, { decision: answerOf(decision), shown })), resumed, counts);
  return { first, last, counts };
}

/** The workspace a drive runs in; for a read, seeded with the file it reads and the platform's content. */
function workspace(action: ProposedAction): string {
  const root = mkdtempSync(join(tmpdir(), "contract-claude-"));
  mkdirSync(join(root, "work"), { recursive: true });
  if (action.kind !== "read") return root;
  for (const rel of ["work/alpha.txt", ".stigmer/skills/guide/SKILL.md"]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), "seeded");
  }
  return root;
}

function worldOf(root: string, action: ProposedAction, over: Partial<DriveWorld> = {}): DriveWorld {
  return {
    root,
    reach: reachOf(undefined, undefined),
    leases: { global: false, categories: new Set(), servers: new Set(), hooks: new Set() },
    mcpDefault: mcpDefaultFor(action),
    unattended: false,
    hooks: NO_HOOKS,
    failTool: false,
    subAgent: false,
    ...over,
  };
}

/** What a drive ran, from the workspace and the counts. */
function executionCountOf(action: ProposedAction, root: string, counts: Counts, ran: boolean): number {
  switch (action.kind) {
    case "shell":
    case "delete":
      return existsSync(join(root, SHELL_RAN)) ? readFileSync(join(root, SHELL_RAN), "utf8").trim().split("\n").length : 0;
    case "write":
      return WRITE_RESOURCES.filter((resource) => existsSync(join(root, resource))).length;
    case "mcp":
      return counts.mcp;
    case "read":
      return ran ? 1 : 0;
    default: {
      const exhaustive: never = action.kind;
      throw new Error(`executionCountOf: unknown action kind ${String(exhaustive)}`);
    }
  }
}

/** The gate's provenance on a paused call. */
function pausedSource(invocation: Invocation): string {
  const verdict = invocation.gate.verdictOf(CALL_ID);
  return verdict?.kind === "pause" ? (verdict.source ?? "") : "";
}

async function authorizeWith(action: ProposedAction, decision: GatewayDecision, over: Partial<DriveWorld> = {}, probe?: ProposedAction): Promise<GatewayOutcome> {
  const root = workspace(action);
  try {
    const world = worldOf(root, action, over);
    const call = engineCallOf(action, root);
    const { first, last, counts } = await drive(world, call, decision, probe === undefined ? call : engineCallOf(probe, root));
    const executionCount = executionCountOf(probe ?? action, root, counts, last.ran);
    return { executed: executionCount > 0, gated: first.deferred, executionCount, policySource: pausedSource(first) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The hook lease key a held lease on `action` names, as a row of that call leases it. */
function hookLeaseFor(plugin: string, action: ProposedAction, root: string): string {
  const call = engineCallOf(action, root);
  const server = serverOf(call.name);
  return hookLeaseKey(plugin, server?.slug ?? "", rowNameOf(call));
}

async function runHooksProbe(hooks: readonly ContractHook[], action: ProposedAction, options: HooksDriveOptions): Promise<HooksOutcome> {
  const root = workspace(action);
  const pluginRoot = mkdtempSync(join(tmpdir(), "contract-claude-hooks-"));
  try {
    const files = { runs: join(pluginRoot, "runs.jsonl"), state: join(pluginRoot, "asked") };
    const leased = options.hookLease;
    const evaluator = new HookEvaluator({
      set: HookSet.of(contractHookSources(hooks, files, pluginRoot, (rewrite) => rewriteInputOf(rewrite, root))),
      views: new ClaudeToolViews({ workspaceRoot: root, serverNames: new Map(), platformServerSlugs: new Set() }),
      sessionId: "contract-session",
      workspaceRoot: root,
      permissionMode: options.autoApproveAll ? "bypassPermissions" : "default",
      baseEnv: buildShellEnv({}),
      homeDir: pluginRoot,
      leases: leased ? new Set([hookLeaseFor(leased.plugin, leased.action, root)]) : new Set(),
    });
    const world = worldOf(root, action, {
      reach: reachOf(options.lists, undefined),
      leases: { global: options.autoApproveAll ?? false, categories: new Set(options.categoryLease ? [options.categoryLease] : []), servers: new Set(), hooks: new Set() },
      unattended: options.unattended ?? false,
      hooks: { root: evaluator, subagents: new Map([[HELPER, evaluator]]) },
      failTool: options.failTool ?? false,
      subAgent: options.subAgent !== undefined,
    });
    const call = engineCallOf(action, root);
    const { first, last, counts } = await drive(world, call, options.decision ?? "none");
    const modelRead = last.modelRead;
    const writtenPaths = WRITE_RESOURCES.filter((resource) => existsSync(join(root, resource)));
    const executionCount = executionCountOf(action, root, counts, last.ran);
    const verdict = first.gate.verdictOf(CALL_ID);
    const hookRuns = existsSync(files.runs)
      ? readFileSync(files.runs, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
      : [];
    return {
      executed: executionCount > 0,
      gated: first.deferred,
      executionCount,
      policySource: pausedSource(first),
      ...(verdict?.kind === "pause" && verdict.hook !== undefined ? { policyHook: verdict.hook } : {}),
      refusedBy: refusedByOf(last.gate, call),
      modelRead,
      hookRuns,
      writtenPaths,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(pluginRoot, { recursive: true, force: true });
  }
}

/** Who refused a drive's call, read from the gate's verdict: the agent's lists (a tool outside its reach), or a hook's deny. */
function refusedByOf(gate: ClaudeGate, call: EngineCall): HooksOutcome["refusedBy"] {
  const verdict = gate.verdictOf(CALL_ID);
  if (verdict?.kind !== "refuse") return undefined;
  if (verdict.message === notOfferedMessage(call.name)) return "lists";
  return verdict.source === "hook" && verdict.message.includes("refused this call") ? "hook" : undefined;
}

async function runListsProbe(lists: ContractToolLists, action: ProposedAction, options: ListsDriveOptions): Promise<ListsOutcome> {
  const root = workspace(action);
  try {
    const world = worldOf(root, action, {
      reach: reachOf(lists, options.subAgent),
      leases: { global: options.autoApproveAll ?? false, categories: new Set(), servers: new Set(), hooks: new Set() },
      subAgent: options.subAgent !== undefined,
    });
    const { first, counts } = await drive(world, engineCallOf(action, root), "none");
    const refused = refusedByOf(first.gate, engineCallOf(action, root)) === "lists";
    const executionCount = executionCountOf(action, root, counts, first.ran);
    return { executed: !refused && executionCount > 0, gated: first.deferred, refused };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const NO_CATEGORIES: ReadonlySet<ToolApprovalCategory> = new Set();

export function createClaudeSubstrate(): GatewaySubstrate {
  return {
    name: "claude",
    available: true,
    capabilities: {
      observesExecution: true,
      // An approval answers one call by its id, and runs only that call as
      // the person saw it (`gate.ts`): another resource, content or tool
      // under the approved id is refused.
      enforcesExactResource: true,
      enforcesExactContent: true,
      appliesRunLifetimeLease: true,
      surfacesGatePolicySource: true,
      runsHooks: true,
      hookSeesSubAgent: true,
      enforcesSubAgentLists: true,
    },

    authorize: (action, decision) => authorizeWith(action, decision),

    authorizeAfterGrant: (granted, probe) => authorizeWith(granted, "approve", {}, probe),

    async authorizeUnderClassLease(leased: ProposedAction, probe: ProposedAction): Promise<GatewayOutcome> {
      // The runner derives a lease's class from the row the person approved "all" on.
      const call = engineCallOf(leased, "/");
      const scope = deriveLeaseScope({ name: rowNameOf(call), mcpServerSlug: serverOf(call.name)?.slug ?? "", approvalPolicySource: ApprovalPolicySource.UNSPECIFIED, approvalPolicyHook: "" });
      const categories = scope?.kind === "category" ? new Set([scope.category]) : NO_CATEGORIES;
      return authorizeWith(probe, "none", { leases: { global: false, categories, servers: new Set(), hooks: new Set() } });
    },

    authorizeUnderLists: (lists, action, options = {}) => runListsProbe(lists, action, options),

    authorizeUnderHooks: (hooks, action, options = {}) => runHooksProbe(hooks, action, options),
  };
}
