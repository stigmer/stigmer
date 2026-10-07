/**
 * Deep-agent adapter for the HITL gateway Contract Test Kit.
 *
 * Drives the REAL in-process gateway: a `createDeepAgent` graph carrying the
 * production {@link createApprovalGateMiddleware}, a `MemorySaver` checkpointer,
 * and a scripted model that proposes the action under test. `authorize` runs the
 * graph to its first pause and, for an approving/non-approving decision, resumes
 * via `Command(resume=…)` — exactly the production pause/resume cycle proven in
 * `__tests__/subagent-approval-propagation.test.ts`. There is no mocked
 * `interrupt()`: the gate's own `interrupt()` fires, so the contract exercises the
 * gateway end-to-end.
 *
 * Capabilities: this substrate IS the side effect, so it observes (and counts)
 * execution; resource-exact leasing is not a property of this gate (sameness comes
 * from checkpoint replay), so `enforcesExactResource` is false and
 * `authorizeAfterGrant` is intentionally not implemented.
 *
 * The lists drive (`authorizeUnderLists`) runs the production
 * {@link createToolScopeMiddleware} ahead of the gate, as `buildMiddlewareStack`
 * orders them, over deepagents' REAL built-ins (`read_file`, `write_file`,
 * `execute` on a `LocalShellBackend` over a throwaway directory): the scope
 * decides by the engine's own tool names, so the probe aliases above would read
 * as engine extras there. A sub-agent drive narrows the scope exactly as
 * `subagent-wiring.ts` hands each sub-agent graph its own.
 *
 * The hooks drive (`authorizeUnderHooks`) runs the production gate with the
 * production evaluator (`shared/hooks/`) over the same real built-ins, and
 * every hook is a real command run by bash: it appends what it read on stdin
 * to a log the outcome reports, then answers as the contract asks. A sub-agent
 * drive hands the gate the identity `buildSubAgentMiddleware` does.
 */

import { ApprovalPolicySource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createDeepAgent, LocalShellBackend, StateBackend } from "deepagents";

import { createApprovalGateMiddleware } from "../../../middleware/approval-gate.js";
import { normalizeWorkspacePathArg } from "../../../middleware/path-normalization.js";
import { createToolScopeMiddleware } from "../../../middleware/tool-scope.js";
import { deriveLeaseScope, hookLeaseKey, mcpToolKey, type McpApprovalDefault } from "../../../shared/approval-policy.js";
import { HookEvaluator } from "../../../shared/hooks/evaluate.js";
import { HookSet, type HookSourceGroups } from "../../../shared/hooks/hook-set.js";
import { contractHookSources } from "../../../__test-utils__/approval-contract/hook-commands.js";
import { NativeToolViews } from "../../../shared/hooks/tool-view.js";
import { buildShellEnv } from "../../../shared/shell-env.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import { PLATFORM_ROUTE_PREFIX, confinedReadAdmission } from "../platform-route.js";
import type { ToolApprovalCategory } from "../../../shared/tool-kind.js";
import { ScriptedModel, readPendingInterrupts } from "./scripted-model.js";
import type {
  ContractHook,
  ContractHookBehaviour,
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
 * Translate an abstract action into a deep-agent tool name + args + MCP server.
 * The names are deliberately ALIASES, not deepagents built-ins, so we can attach
 * a counting handler without shadowing an injected built-in, while still hitting
 * the right approval category via the shared classifier:
 *  - write  → `overwrite_file` (FILE_WRITE), delete → `remove_file` (FILE_DELETE),
 *    shell → `execute_command` (SHELL): each gated fail-closed by category.
 *  - read   → an unknown, non-mutating name: auto-approved (fail-open), no gate.
 *  - mcp    → the MCP tool name mapped to its server: governed by policy, absent
 *    policy ⇒ auto-approved.
 */
function toDeepAgentTool(action: ProposedAction): {
  name: string;
  args: Record<string, unknown>;
  serverSlug: string;
} {
  switch (action.kind) {
    case "write":
      return { name: "overwrite_file", args: { path: action.resource, content: "x" }, serverSlug: "" };
    case "shell":
      return { name: "execute_command", args: { command: action.resource }, serverSlug: "" };
    case "delete":
      return { name: "remove_file", args: { path: action.resource }, serverSlug: "" };
    case "read":
      return { name: "inspect_resource", args: { path: action.resource }, serverSlug: "" };
    case "mcp":
      return { name: action.mcpToolName ?? "mcp_tool", args: {}, serverSlug: action.mcpServerSlug ?? "srv" };
  }
}

/** Map a contract decision to the gate's resume verdict (anything unrecognized = unknown). */
function toResumeAction(decision: GatewayDecision): string {
  switch (decision) {
    case "approve":
      return "approve";
    case "skip":
      return "skip";
    case "reject":
      return "reject";
    default:
      return "unrecognized-verdict";
  }
}

let threadSeq = 0;

/**
 * Drive one probe action through a freshly built gate and report the outcome.
 * `leasedCategories` pre-arms a run-lifetime class lease (empty for the plain
 * authorize path); `decision` resumes a pause for the non-lease drives.
 */
async function runProbe(
  action: ProposedAction,
  decision: GatewayDecision,
  leasedCategories: ReadonlySet<ToolApprovalCategory>,
): Promise<GatewayOutcome> {
  const { name, args, serverSlug } = toDeepAgentTool(action);

  let executionCount = 0;
  const countingTool = tool(
    async () => {
      executionCount += 1;
      return "ok";
    },
    {
      name,
      description: `contract probe tool ${name}`,
      schema: z.object({}).passthrough(),
    },
  );

  const toolServerMap = serverSlug ? new Map([[name, serverSlug]]) : new Map<string, string>();
  const gate = createApprovalGateMiddleware({
    mcpDefault: mcpDefaultFor(action),
    toolServerMap,
    leasedCategories,
  });

  const agent = await createDeepAgent({
    model: new ScriptedModel(() => ({
      toolCalls: [{ name, args, id: "call_1" }],
      done: "done",
    })),
    checkpointer: new MemorySaver() as never,
    backend: new StateBackend(),
    tools: [countingTool],
    middleware: [gate],
  } as unknown as Parameters<typeof createDeepAgent>[0]);

  const config = { configurable: { thread_id: `contract-${threadSeq++}` }, recursionLimit: 50 };

  // Run to the first pause. A gated tool interrupts before its handler runs.
  await agent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);
  const pending = readPendingInterrupts((await agent.getState(config)) as never);
  const gated = pending.length > 0;
  // The gate stamps the authorization provenance on every interrupt it raises;
  // surface it so the contract can assert no side effect is gated without one.
  const policySource = gated ? pending[0].policySource : "";

  // `none` is the "no decision yet" probe: leave the action withheld.
  if (gated && decision !== "none") {
    const resume: Record<string, { action: string }> = {};
    for (const p of pending) resume[p.interruptId] = { action: toResumeAction(decision) };
    await agent.invoke(new Command({ resume }), config);
  }

  return { executed: executionCount > 0, gated, executionCount, policySource };
}

const NO_LEASED_CATEGORIES: ReadonlySet<ToolApprovalCategory> = new Set();

/** The turn's approval default for one probe: its MCP tool asks only when the action says its server marks it destructive. */
function mcpDefaultFor(action: ProposedAction): McpApprovalDefault {
  const destructive = new Set<string>();
  if (action.kind === "mcp" && action.mcpDestructive) {
    destructive.add(mcpToolKey(action.mcpServerSlug ?? "srv", action.mcpToolName ?? "mcp_tool"));
  }
  return { destructive, leasedServers: new Set() };
}

/** The workspace file every read probe reads, and the platform file a `platformContent` read names. */
function seedWorkspace(root: string): void {
  const files = ["work/alpha.txt", `${PLATFORM_ROUTE_PREFIX.slice(1)}skills/guide/SKILL.md`];
  for (const rel of files) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), "seeded");
  }
}

/** An action as the native engine's own built-in call, or an MCP tool call. */
function toNativeCall(action: ProposedAction): { name: string; args: Record<string, unknown>; serverSlug: string } {
  switch (action.kind) {
    case "write":
      return { name: "write_file", args: { file_path: action.resource, content: action.content ?? "x" }, serverSlug: "" };
    case "shell":
      return { name: "execute", args: { command: action.resource }, serverSlug: "" };
    case "read": {
      const path = action.platformContent ? `${PLATFORM_ROUTE_PREFIX}${action.resource}` : action.resource;
      return { name: "read_file", args: { file_path: path }, serverSlug: "" };
    }
    case "delete":
      throw new Error("toNativeCall: the native engine binds no delete tool (deepagents-profiles.ts)");
    case "mcp":
      return { name: action.mcpToolName ?? "mcp_tool", args: {}, serverSlug: action.mcpServerSlug ?? "srv" };
    default: {
      const exhaustive: never = action.kind;
      throw new Error(`toNativeCall: unknown action kind ${String(exhaustive)}`);
    }
  }
}

/** Drive one action through the scope middleware (and the gate, unless trust is pre-armed). */
async function runListsProbe(
  lists: ContractToolLists,
  action: ProposedAction,
  options: ListsDriveOptions,
): Promise<ListsOutcome> {
  const root = mkdtempSync(join(tmpdir(), "contract-lists-"));
  try {
    seedWorkspace(root);
    const { name, args, serverSlug } = toNativeCall(action);

    let mcpCount = 0;
    const mcpTools =
      action.kind === "mcp"
        ? [
            tool(
              async () => {
                mcpCount += 1;
                return "ok";
              },
              { name, description: `contract MCP tool ${name}`, schema: z.object({}).passthrough() },
            ),
          ]
        : [];

    let scope = ToolScope.of('Agent "contract"', lists);
    if (options.subAgent) scope = scope.narrow('Sub-agent "helper"', options.subAgent);

    const middleware: unknown[] = [
      createToolScopeMiddleware({
        scope,
        serverToolMap: new Map(serverSlug ? [[serverSlug, mcpTools]] : []),
        platformServerSlugs: new Set(),
        admitsConfinedRead: confinedReadAdmission(root),
      }),
    ];
    if (!options.autoApproveAll) {
      middleware.push(
        createApprovalGateMiddleware({
          mcpDefault: mcpDefaultFor(action),
          toolServerMap: serverSlug ? new Map([[name, serverSlug]]) : new Map<string, string>(),
          leasedCategories: NO_LEASED_CATEGORIES,
        }),
      );
    }

    const backend = new LocalShellBackend({ rootDir: root, virtualMode: true });
    await backend.initialize();
    const agent = await createDeepAgent({
      model: new ScriptedModel(() => ({ toolCalls: [{ name, args, id: "call_1" }], done: "done" })),
      checkpointer: new MemorySaver() as never,
      backend,
      tools: mcpTools,
      middleware,
    } as unknown as Parameters<typeof createDeepAgent>[0]);

    const config = { configurable: { thread_id: `contract-lists-${threadSeq++}` }, recursionLimit: 50 };
    const result = (await agent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config)) as {
      messages: BaseMessage[];
    };
    const gated = readPendingInterrupts((await agent.getState(config)) as never).length > 0;
    const answer = result.messages.find(
      (m): m is ToolMessage => m instanceof ToolMessage && m.tool_call_id === "call_1",
    );
    const text = answer === undefined ? "" : typeof answer.content === "string" ? answer.content : JSON.stringify(answer.content);
    const refused = text.includes("is not available to this agent");
    const executed = answer !== undefined && !refused && (action.kind !== "mcp" || mcpCount > 0);
    return { executed, gated, refused };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A string as one single-quoted bash word. */
function shellWord(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The marker file a shell probe appends to when it runs, one line per run. */
const SHELL_RAN = ".contract-ran";

/** The native call for a hooks probe: a shell leaves a mark, a write and a read touch the workspace. */
function toHooksCall(action: ProposedAction): { name: string; args: Record<string, unknown>; serverSlug: string } {
  if (action.kind === "shell") {
    return { name: "execute", args: { command: `${action.resource}; echo ran >> ${SHELL_RAN}` }, serverSlug: "" };
  }
  return toNativeCall(action);
}

/** Claude Code's input for an action a hook rewrites a call into, as the hook would write it. */
function claudeInputOf(action: ProposedAction, root: string): Record<string, unknown> {
  switch (action.kind) {
    case "write":
      return { file_path: join(root, action.resource), content: action.content ?? "x" };
    case "shell":
      return { command: action.resource };
    default:
      throw new Error(`claudeInputOf: no rewrite into a ${action.kind} action`);
  }
}



/** The write resources a hooks probe may create, checked after it runs. */
const WRITE_RESOURCES = ["/work/alpha.txt", "/work/beta.txt", "/work/.env"];

/** Drive one action through the tool lists, the gate and its hooks. */
async function runHooksProbe(
  hooks: readonly ContractHook[],
  action: ProposedAction,
  options: HooksDriveOptions,
): Promise<HooksOutcome> {
  const root = mkdtempSync(join(tmpdir(), "contract-hooks-"));
  const pluginRoot = mkdtempSync(join(tmpdir(), "contract-hook-plugin-"));
  try {
    if (action.kind === "read") seedWorkspace(root);
    mkdirSync(join(root, "work"), { recursive: true });
    const files = { runs: join(pluginRoot, "runs.jsonl"), state: join(pluginRoot, "asked") };
    const { name, args, serverSlug } = toHooksCall(action);

    let mcpCount = 0;
    const mcpTools =
      action.kind === "mcp"
        ? [
            tool(
              async (_input, config) => {
                mcpCount += 1;
                if (!options.failTool) return "found three issues";
                return new ToolMessage({ content: "the server failed", tool_call_id: config?.toolCall?.id ?? "call_1", name, status: "error" });
              },
              { name, description: `contract MCP tool ${name}`, schema: z.object({}).passthrough() },
            ),
          ]
        : [];
    const toolServerMap = serverSlug ? new Map([[name, serverSlug]]) : new Map<string, string>();

    const sources: HookSourceGroups[] = contractHookSources(hooks, files, pluginRoot, (rewrite) => claudeInputOf(rewrite, root));
    const leased = options.hookLease;
    const evaluator = new HookEvaluator({
      set: HookSet.of(sources),
      views: new NativeToolViews({
        workspaceRoot: root,
        toVirtualPath: (path) => normalizeWorkspacePathArg(path, root),
        toolServerMap,
        pluginServers: new Map(),
        platformServerSlugs: new Set(),
      }),
      sessionId: "contract-session",
      workspaceRoot: root,
      permissionMode: options.autoApproveAll ? "bypassPermissions" : "default",
      baseEnv: buildShellEnv({}),
      homeDir: pluginRoot,
      leases: leased
        ? new Set([hookLeaseKey(leased.plugin, toHooksCall(leased.action).serverSlug, toHooksCall(leased.action).name)])
        : new Set(),
    });

    const middleware: unknown[] = [];
    if (options.lists) {
      middleware.push(createToolScopeMiddleware({
        scope: ToolScope.of('Agent "contract"', options.lists),
        serverToolMap: new Map(serverSlug ? [[serverSlug, mcpTools]] : []),
        platformServerSlugs: new Set(),
        admitsConfinedRead: confinedReadAdmission(root),
      }));
    }
    middleware.push(createApprovalGateMiddleware({
      mcpDefault: mcpDefaultFor(action),
      toolServerMap,
      leasedCategories: options.categoryLease ? new Set([options.categoryLease]) : NO_LEASED_CATEGORIES,
      hooks: evaluator,
      globalBypass: options.autoApproveAll ?? false,
      unattended: options.unattended ?? false,
      unattendedSkips: new Map(),
      ...(options.subAgent ? { subAgent: { type: options.subAgent, id: "contract-invocation" } } : {}),
    }));

    const backend = new LocalShellBackend({ rootDir: root, virtualMode: true });
    await backend.initialize();
    const agent = await createDeepAgent({
      model: new ScriptedModel(() => ({ toolCalls: [{ name, args, id: "call_1" }], done: "done" })),
      checkpointer: new MemorySaver() as never,
      backend,
      tools: mcpTools,
      middleware,
    } as unknown as Parameters<typeof createDeepAgent>[0]);

    const config = { configurable: { thread_id: `contract-hooks-${threadSeq++}` }, recursionLimit: 50 };
    await agent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);
    const pending = readPendingInterrupts((await agent.getState(config)) as never);
    const gated = pending.length > 0;
    const decision = options.decision ?? "none";
    if (gated && decision !== "none") {
      const resume: Record<string, { action: string }> = {};
      for (const p of pending) resume[p.interruptId] = { action: toResumeAction(decision) };
      await agent.invoke(new Command({ resume }), config);
    }

    const messages = ((await agent.getState(config)) as { values: { messages?: BaseMessage[] } }).values.messages ?? [];
    const answer = [...messages].reverse().find(
      (m): m is ToolMessage => m instanceof ToolMessage && m.tool_call_id === "call_1",
    );
    const modelRead = answer === undefined ? "" : typeof answer.content === "string" ? answer.content : JSON.stringify(answer.content);
    const refusedBy = modelRead.includes("is not available to this agent")
      ? "lists" as const
      : modelRead.includes("refused this call")
        ? "hook" as const
        : undefined;
    const writtenPaths = WRITE_RESOURCES.filter((resource) => existsSync(join(root, resource)));
    const shellRuns = existsSync(join(root, SHELL_RAN)) ? readFileSync(join(root, SHELL_RAN), "utf-8").trim().split("\n").length : 0;
    const executionCount = action.kind === "shell"
      ? shellRuns
      : action.kind === "write"
        ? writtenPaths.length
        : action.kind === "mcp"
          ? mcpCount
          : modelRead.includes("seeded") ? 1 : 0;
    const hookRuns = existsSync(files.runs)
      ? readFileSync(files.runs, "utf-8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
      : [];

    return {
      executed: executionCount > 0,
      gated,
      executionCount,
      policySource: gated ? pending[0]!.policySource : "",
      ...(gated && pending[0]!.policyHook !== undefined ? { policyHook: pending[0]!.policyHook } : {}),
      refusedBy,
      modelRead,
      hookRuns,
      writtenPaths,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(pluginRoot, { recursive: true, force: true });
  }
}

export function createDeepAgentSubstrate(): GatewaySubstrate {
  return {
    name: "deep-agent",
    available: true,
    capabilities: {
      observesExecution: true,
      enforcesExactResource: false,
      // The deep-agent gate re-checks every distinct call and relies on
      // checkpoint replay for sameness; content isolation is not a property of
      // the gate itself, so the content-exact invariant does not apply here.
      enforcesExactContent: false,
      appliesRunLifetimeLease: true,
      surfacesGatePolicySource: true,
      enforcesSubAgentLists: true,
      runsHooks: true,
      hookSeesSubAgent: true,
    },

    async authorize(action: ProposedAction, decision: GatewayDecision): Promise<GatewayOutcome> {
      return runProbe(action, decision, NO_LEASED_CATEGORIES);
    },

    async authorizeUnderClassLease(
      leased: ProposedAction,
      probe: ProposedAction,
    ): Promise<GatewayOutcome> {
      // Reduce the leased action to its class exactly as the runner does, then
      // arm the gate with that category lease and run the probe with no fresh
      // decision — so only the lease can clear it.
      const leasedTool = toDeepAgentTool(leased);
      const scope = deriveLeaseScope({
        name: leasedTool.name,
        mcpServerSlug: leasedTool.serverSlug,
        approvalPolicySource: ApprovalPolicySource.UNSPECIFIED,
        approvalPolicyHook: "",
      });
      const leasedCategories =
        scope?.kind === "category" ? new Set([scope.category]) : NO_LEASED_CATEGORIES;
      return runProbe(probe, "none", leasedCategories);
    },

    async authorizeUnderLists(
      lists: ContractToolLists,
      action: ProposedAction,
      options: ListsDriveOptions = {},
    ): Promise<ListsOutcome> {
      return runListsProbe(lists, action, options);
    },

    async authorizeUnderHooks(
      hooks: readonly ContractHook[],
      action: ProposedAction,
      options: HooksDriveOptions = {},
    ): Promise<HooksOutcome> {
      return runHooksProbe(hooks, action, options);
    },
  };
}
