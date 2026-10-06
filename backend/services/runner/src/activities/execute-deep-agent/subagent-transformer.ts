/**
 * SubAgent transformation and compilation.
 *
 * Transforms proto SubAgent definitions into CompiledSubAgent instances for
 * the deepagents JS runtime. Each compiled subagent is a runnable that builds
 * a fresh graph on a fresh middleware stack (loop detection, budget,
 * truncation, cost view) for every invocation, so concurrent invocations of
 * one sub-agent never share a conversation's state, and is gated for
 * concurrency by SubAgentGate.
 *
 * Design decisions:
 * - CompiledSubAgent format: full middleware control, no unwanted deepagents defaults
 * - Every declared sub-agent and the built-in general-purpose bind the parent's
 *   MCP tools (no reconnection overhead, stateless servers are the norm); what
 *   a sub-agent may see and call is its tool scope — the parent's, narrowed by
 *   the sub-agent's own `tools` / `disallowed_tools` and never widened —
 *   enforced inside its graph by the tool-scope middleware (`subagent-wiring.ts`)
 * - The main agent's `Agent(type, …)` entry limits which sub-agents compile;
 *   the built-in explore, shell and general-purpose count as types
 * - Prompt injection for skills: FilesystemBackend incompatible with native skills field
 * - Built-in explore/shell subagents use prompt-based tool restriction
 * - Built-in general-purpose replaces deepagents' auto-injected one (which carries
 *   no approval gate — see deepagents-profiles.ts for the suppression half)
 * - Sub-agent backends are shell-capable outside plan mode (issue #248), mirroring
 *   the parent's backend selection in turn-setup.ts
 * - Sub-agent graphs carry the parent's filesystem permissions explicitly
 *   (issue #255): pre-built CompiledSubAgents never inherit them, so plan
 *   mode's deny-all-writes rule is baked into each graph at compile time
 * - Invalid configurations are logged and skipped (graceful degradation)
 * - Empty subagent list returns null (no subagents configured)
 */

import { randomUUID } from "node:crypto";
import { createDeepAgent, FilesystemBackend, LocalShellBackend, DEFAULT_SUBAGENT_PROMPT } from "deepagents";
import type { AnyBackendProtocol, CompiledSubAgent, FilesystemPermission } from "deepagents";
import type { StructuredTool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";

import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import type { ApprovalGateConfig } from "../../middleware/approval-gate.js";
import type { ToolScopeConfig } from "../../middleware/tool-scope.js";
import type { ToolScope } from "../../shared/tool-lists.js";
import { createCasCaptureBackend } from "./cas-capture-backend.js";
import { mountPlatformRoute } from "./platform-route.js";
import type { CasCaptureObserver } from "./cas-capture-observer.js";
import type { CostAdvisoryMiddleware, StigmerMiddleware } from "../../middleware/index.js";
import { createWebFetchTool, type GuardPosture } from "../../tools/index.js";
import { buildSubAgentMiddleware } from "./subagent-wiring.js";
import { SubAgentGate } from "../../shared/subagent-gate.js";
import { isModelRegistered } from "../../shared/model-registry.js";
import type { SkillMetadata } from "../../shared/skill-resolver.js";
import { renderSkillsSection } from "./prompt-builder.js";
import { ENGINE_TOOL } from "./engine-tools.js";

// =========================================================================
// Built-in subagent types and prompts
// =========================================================================

export const BUILTIN_SUBAGENT_TYPES: ReadonlySet<string> = new Set([
  "explore",
  "shell",
  "general-purpose",
]);

// The task arrives as the sub-agent's first message (deepagents' `task`
// tool), so a prompt carries no slot for it. Tool names come from the one
// table of bound names (`engine-tools.ts`).
const EXPLORE_SYSTEM_PROMPT = `\
You are an exploration specialist. Your ONLY job is to explore codebases \
and report findings back to the parent agent.

STRICT BOUNDARIES:
- Use ONLY the read-only tools (${ENGINE_TOOL.readFile}, ${ENGINE_TOOL.ls}, ${ENGINE_TOOL.glob}, ${ENGINE_TOOL.grep})
- Do NOT write files, create files, or modify anything
- Do NOT execute shell commands
- Do NOT follow skill activation instructions from any context
- Do NOT create deliverables, scaffolds, or run initialization scripts
- Report your findings concisely — the parent agent has direct file access`;

const SHELL_SYSTEM_PROMPT = `\
You are a command execution specialist. Your ONLY job is to run shell \
commands and report the results back to the parent agent.

STRICT BOUNDARIES:
- Use ONLY ${ENGINE_TOOL.execute}, ${ENGINE_TOOL.readFile} and ${ENGINE_TOOL.ls}
- Do NOT write or modify files directly — use shell commands if needed
- Do NOT search extensively or explore the codebase beyond what is needed
- Do NOT follow skill activation instructions from any context
- Do NOT create deliverables, scaffolds, or run initialization scripts
- Report command output concisely — the parent agent will interpret results`;

/**
 * The general-purpose sub-agent's line in the `task` tool. Stigmer's own
 * words rather than upstream's `DEFAULT_GENERAL_PURPOSE_DESCRIPTION`, which
 * invites delegating a search ("use this agent to perform the search for
 * you") that the parent's working rules tell it to do itself
 * (`prompt-builder.ts`): each delegation is a sub-agent's own rounds on top
 * of the parent's.
 */
const GENERAL_PURPOSE_DESCRIPTION =
  "Runs a multi-step task with the same tools as you, in its own context, and returns one report. " +
  "Use it only for independent work you need as a summary.";

const BUILTIN_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  ["explore", (
    "Read-only codebase exploration specialist. Use for searching, " +
    "reading files, finding patterns, and understanding code structure. " +
    "Cannot write files or execute commands."
  )],
  ["shell", (
    "Command execution specialist. Use for running shell commands, " +
    "build operations, and system tasks. Has minimal file read access."
  )],
]);

const BUILTIN_PROMPTS: ReadonlyMap<string, string> = new Map([
  ["explore", EXPLORE_SYSTEM_PROMPT],
  ["shell", SHELL_SYSTEM_PROMPT],
]);

const RESPONSE_RULES = `\

## Response rules

- After reading a file with ${ENGINE_TOOL.readFile}, NEVER reprint, echo, \
list, or summarize file contents in your response. Tool results are \
already in your context. Proceed directly to the task.
- Your response is returned to the parent agent as a task \
result. Return concise findings and actionable results — not \
raw file contents. The parent agent has direct access to the \
same files.
- Do not begin responses with phrases like \
"Below is the complete content", \
"Here are the contents of the files", or similar.
`;

// =========================================================================
// Types
// =========================================================================

/**
 * Intermediate representation of a transformed subagent before compilation.
 * Contains all the data needed to create a compiled agent graph.
 */
export interface TransformedSubagent {
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly tools: StructuredTool[];
  readonly model?: string;
  /** What this sub-agent may see and call: the parent's scope, narrowed by its own lists. */
  readonly scope: ToolScope;
}

/** Everything a sub-agent's tool scope needs besides the scope itself; shared with the parent's. */
export type SubagentScopeBase = Omit<ToolScopeConfig, "scope">;

/** The name a sub-agent's lists are reported under, in a log line or a refusal. */
export function subAgentOwner(name: string): string {
  return `Sub-agent "${name}"`;
}

/** A declared sub-agent's scope: the parent's, narrowed by its own two lists. */
export function subAgentScope(parentScope: ToolScope, subAgent: SubAgent): ToolScope {
  return parentScope.narrow(subAgentOwner(subAgent.name), {
    tools: subAgent.tools,
    disallowedTools: subAgent.disallowedTools,
  });
}

/**
 * Options for the full subagent transformation and compilation pipeline.
 */
export interface SubagentTransformOptions {
  readonly subAgents: readonly SubAgent[];
  /** Every MCP tool the parent binds; each sub-agent binds them all and its scope narrows them. */
  readonly parentMcpTools: readonly StructuredTool[];
  /** The main agent's tool scope; a sub-agent's narrows it, and its `Agent(type, …)` picks which compile. */
  readonly parentScope: ToolScope;
  /** The attribution and confinement every sub-agent's scope middleware reads. */
  readonly scopeBase: SubagentScopeBase;
  /**
   * Each sub-agent's mounted skills, keyed by the sub-agent's name — the
   * runtime's `TurnSkills.bySubAgent` (resolved and mounted by its skills
   * phase, since #1096). A sub-agent with no entry renders no skills
   * section. Until then this module fetched and mounted them itself with
   * a control-plane client; the compile step is client-free now.
   */
  readonly skills: ReadonlyMap<string, readonly SkillMetadata[]>;
  readonly workspaceBackend: WorkspaceBackend;
  /**
   * The parent's approval-gate config, inherited verbatim so a mutating tool
   * inside a sub-agent is gated identically to one in the parent (same default,
   * toolServerMap, fingerprint key, execution id). Null under auto-approve-all,
   * where the parent gate is inert too — sub-agents then install no gate either.
   */
  readonly approvalGate: ApprovalGateConfig | null;
  /**
   * The parent turn's shared CAS observer, present only in capture mode. When
   * supplied, each sub-agent is built with a CAS-observing filesystem backend
   * wired to THIS observer, so its gitignored writes are captured into the same
   * change set as the parent's. Absent outside capture mode,
   * where sub-agents keep the plain backend and the classic gitignored deny-gate.
   */
  readonly casObserver?: CasCaptureObserver;
  readonly parentModelName: string;
  /**
   * URL-guard posture for the native `web_fetch` tool, inherited from the
   * parent (resolveGuardPosture(config.mode) in turn-setup.ts) so a sub-agent
   * fetch is bounded exactly like a parent fetch.
   */
  readonly webFetchPosture: GuardPosture;
  readonly costAdvisory?: CostAdvisoryMiddleware;
  /**
   * Builds a configured chat-model instance for a given model name. When
   * provided, sub-agents are compiled with the same proxy-aware model client
   * as the parent (base URL, auth headers, API key) — including registry-id
   * resolution, which is why this is async. When absent (unit tests), the
   * model name string is passed to deepagents directly.
   */
  readonly modelFactory?: (modelName: string) => Promise<BaseChatModel>;
  /**
   * Per-execution env for the sub-agent `execute` tool, snapshotted in setup
   * (see shell-env.ts). Presence is the single switch for shell capability:
   * undefined (plan mode) compiles sub-agents onto non-shell filesystem
   * backends, exactly like the parent's backend selection.
   */
  readonly shellEnv?: Record<string, string>;
  /**
   * Filesystem permission rules baked into each compiled sub-agent graph,
   * inherited from the parent's rules in turn-setup.ts (plan mode's deny-all-writes
   * today). Required because deepagents' parent-permission inheritance covers
   * only spec-style sub-agents — pre-built CompiledSubAgents bypass it, so
   * without this a plan-mode sub-agent could still write (issue #255).
   *
   * Must not be combined with `shellEnv`: deepagents rejects permissions on an
   * execution-capable backend (see the cas-capture-backend.ts header). Plan
   * mode guarantees that by construction — it is the mode that clears shellEnv.
   */
  readonly permissions?: FilesystemPermission[];
}

// =========================================================================
// Built-in subagent creation
// =========================================================================

/**
 * Create built-in explore, shell, and general-purpose subagent specifications.
 *
 * explore and shell receive:
 * - The full deepagents built-in tool set restricted via prompt
 * - Purpose-built system prompts with explicit scope boundaries
 * - No skills, no MCP tools, no parent prompt inheritance
 *
 * general-purpose is the gated replacement for the sub-agent deepagents would
 * otherwise auto-inject WITHOUT our approval gate (suppressed process-wide in
 * deepagents-profiles.ts; supplying our own under the same name is the
 * documented override path). It keeps deepagents' own prompt, but its line in
 * the `task` tool is Stigmer's ({@link GENERAL_PURPOSE_DESCRIPTION}): it was
 * upstream's while the goal was parity with the suppressed original, and
 * upstream's invites the delegation the parent's rules advise against. It
 * receives the parent's MCP tools for capability parity with the injected
 * original. Every built-in runs under the parent's own tool scope: it
 * declares no lists of its own. Conscious simplification: the parent's
 * skills prompt is NOT inherited — a sub-agent needing skills should be
 * declared explicitly in the Agent spec.
 *
 * Returns an empty array if no workspace is configured (subagents need
 * workspace tools to be useful).
 */
export function createBuiltinSubagents(
  hasWorkspace: boolean,
  parentScope: ToolScope,
  parentMcpTools: readonly StructuredTool[] = [],
  webFetchPosture?: GuardPosture,
): TransformedSubagent[] {
  if (!hasWorkspace) {
    return [];
  }

  const result: TransformedSubagent[] = [];

  for (const subagentType of ["explore", "shell", "general-purpose"] as const) {
    if (subagentType === "general-purpose") {
      result.push({
        name: "general-purpose",
        description: GENERAL_PURPOSE_DESCRIPTION,
        systemPrompt: DEFAULT_SUBAGENT_PROMPT + RESPONSE_RULES,
        // Parent-parity tool set: MCP tools plus the native web_fetch the
        // parent always carries. explore/shell stay web-less on purpose —
        // their prompts scope them to the workspace, not the internet.
        tools: [
          ...parentMcpTools,
          ...(webFetchPosture
            ? [createWebFetchTool({ posture: webFetchPosture }) as unknown as StructuredTool]
            : []),
        ],
        scope: parentScope,
      });
      continue;
    }

    const prompt = BUILTIN_PROMPTS.get(subagentType);
    const description = BUILTIN_DESCRIPTIONS.get(subagentType);
    if (!prompt || !description) continue;

    result.push({
      name: subagentType,
      description,
      systemPrompt: prompt + RESPONSE_RULES,
      tools: [],
      scope: parentScope,
    });
  }

  return result;
}

// =========================================================================
// Single subagent transformation
// =========================================================================

/**
 * Transform a single SubAgent proto into the intermediate representation.
 *
 * Handles: proto field extraction, model override validation, the runner's
 * own tools, the sub-agent's tool scope, and response rules appending. The
 * parent's MCP tools and skill resolution are composed by the caller.
 *
 * Returns null if the subagent should be skipped (e.g., invalid model override).
 */
export async function transformSingleSubagent(
  subAgent: SubAgent,
  opts: {
    readonly parentScope: ToolScope;
    readonly parentModelName: string;
    readonly webFetchPosture: GuardPosture;
  },
): Promise<TransformedSubagent | null> {
  const name = subAgent.name;
  const description = subAgent.description || `Sub-agent: ${name}`;
  let systemPrompt = subAgent.instructions || "";

  // Validate model_override if specified
  let model: string | undefined;
  if (subAgent.modelOverride) {
    const isKnown = await isModelRegistered(subAgent.modelOverride);
    if (!isKnown) {
      console.error(
        `[subagent-transformer] Sub-agent '${name}' specifies model_override='${subAgent.modelOverride}' ` +
        `which is not recognised by the ModelRegistry. Skipping this sub-agent. ` +
        `Use a registered model name (e.g. 'claude-haiku-4.5') or a valid API model ID.`,
      );
      return null;
    }
    model = subAgent.modelOverride;
  }

  // The runner's own tools; the caller prepends the parent's MCP tools.
  // web_fetch is unconditional: the parent always has it (turn-setup.ts
  // `buildEngine`), and a sub-agent silently lacking web access the parent
  // has would recreate the harness-parity gap of issue #214 one level down.
  // No tool stands in for reasoning: the sub-agent's model thinks in the
  // execution's thinking mode (#1976).
  const tools: StructuredTool[] = [createWebFetchTool({ posture: opts.webFetchPosture }) as unknown as StructuredTool];

  // Append response rules
  systemPrompt += RESPONSE_RULES;

  return { name, description, systemPrompt, tools, model, scope: subAgentScope(opts.parentScope, subAgent) };
}

// =========================================================================
// Skill resolution for subagents
// =========================================================================

/**
 * The `## Skills` section of one sub-agent's system prompt, from the skills
 * the runtime mounted for it. Empty when it has none.
 */
export function resolveSubagentSkillPrompt(
  subAgent: SubAgent,
  skills: ReadonlyMap<string, readonly SkillMetadata[]>,
): string {
  return renderSkillsSection(skills.get(subAgent.name) ?? []);
}

// =========================================================================
// Compilation pipeline
// =========================================================================

/**
 * Select a sub-agent's deepagents backend, mirroring the parent's selection in
 * turn-setup.ts along two independent axes:
 *
 * - CAS observation (capture mode): when a shared observer is supplied, the
 *   backend records pre-turn bytes of CAS-owned paths so the sub-agent's
 *   gitignored writes fold into the parent turn's change set. Without
 *   one, writes stay on the classic gitignored deny-gate.
 * - Shell capability (issue #248): when `shellEnv` is present the backend
 *   implements deepagents' sandbox protocol so the `execute` tool exists
 *   (approval-gated by the sub-agent's own middleware). Absent (plan mode),
 *   the backend is filesystem-only — read-only by construction, matching the
 *   parent.
 *
 * Every variant is virtual-rooted (`virtualMode: true`) like the parent's —
 * see the cas-capture-backend.ts header (issue #754): workspace confinement
 * is structural on every graph, sub-agents included. Every variant also gets
 * the parent's read-only `.stigmer/` platform mount (`platform-route.ts`), so
 * a sub-agent reads its skills where its prompt says they are.
 */
async function buildSubagentBackend(opts: {
  readonly workspaceRootDir: string;
  readonly platformDir?: string;
  readonly casObserver?: CasCaptureObserver;
  readonly shellEnv?: Record<string, string>;
}): Promise<AnyBackendProtocol> {
  return mountPlatformRoute(await buildSubagentWorkspaceBackend(opts), {
    workspaceDir: opts.workspaceRootDir,
    platformDir: opts.platformDir,
  });
}

async function buildSubagentWorkspaceBackend(opts: {
  readonly workspaceRootDir: string;
  readonly casObserver?: CasCaptureObserver;
  readonly shellEnv?: Record<string, string>;
}): Promise<FilesystemBackend> {
  if (opts.casObserver) {
    return createCasCaptureBackend({
      rootDir: opts.workspaceRootDir,
      observer: opts.casObserver,
      shellEnv: opts.shellEnv,
    });
  }

  if (opts.shellEnv === undefined) {
    return new FilesystemBackend({ rootDir: opts.workspaceRootDir, virtualMode: true });
  }

  const shellBackend = new LocalShellBackend({
    rootDir: opts.workspaceRootDir,
    virtualMode: true,
    env: opts.shellEnv,
  });
  await shellBackend.initialize();
  return shellBackend;
}

/**
 * Compile transformed subagent specifications into CompiledSubAgent instances.
 *
 * Each subagent gets:
 * - One model client and one backend sharing the parent's workspace root
 *   (shell-capable outside plan mode; see {@link buildSubagentBackend})
 * - A fresh agent graph and middleware stack (loop detection, budget,
 *   truncation, cost view) per invocation, built once more at compile only
 *   to refuse a spec deepagents cannot build
 * - Concurrency gating via shared SubAgentGate
 */
export async function compileSubagents(
  transformed: readonly TransformedSubagent[],
  opts: {
    readonly costAdvisory?: CostAdvisoryMiddleware;
    readonly approvalGate?: ApprovalGateConfig | null;
    /** Attribution and confinement for each sub-agent's scope middleware; absent, no scope is enforced (unit tests). */
    readonly scopeBase?: SubagentScopeBase;
    readonly parentModelName: string;
    readonly workspaceRootDir: string;
    /** The session's platform dir, mounted read-only at `.stigmer/` (`platform-route.ts`). */
    readonly platformDir?: string;
    /** Shared CAS observer (capture mode only); see {@link SubagentTransformOptions.casObserver}. */
    readonly casObserver?: CasCaptureObserver;
    readonly modelFactory?: (modelName: string) => Promise<BaseChatModel>;
    /** Shell env for `execute`; see {@link SubagentTransformOptions.shellEnv}. */
    readonly shellEnv?: Record<string, string>;
    /** Per-graph filesystem rules; see {@link SubagentTransformOptions.permissions}. */
    readonly permissions?: FilesystemPermission[];
  },
): Promise<CompiledSubAgent[]> {
  if (transformed.length === 0) return [];

  const gate = new SubAgentGate();
  const compiled: CompiledSubAgent[] = [];

  for (const spec of transformed) {
    try {
      const modelName = spec.model ?? opts.parentModelName;
      // Use a configured model instance (proxy base URL + auth, plus registry
      // id -> API id resolution) when a factory is supplied so sub-agent LLM
      // calls route through the same proxy as the parent. Falling back to the
      // bare name lets deepagents construct a default client (unit tests /
      // no-proxy paths).
      const model = opts.modelFactory ? await opts.modelFactory(modelName) : modelName;

      const backend = await buildSubagentBackend(opts);

      // One graph on one middleware stack per INVOCATION (stigmer/stigmer#1699).
      // Loop detection, the periodic budget and the cost view keep one
      // conversation's state in their closures; the parent may delegate to
      // this sub-agent several times in one message, and those invocations
      // run at once (SubAgentGate admits three), so a stack built per spec
      // pooled their histories, round counts and told flags. A build is about
      // a millisecond. The model, the backend, the parent's cost advisory (its
      // running total is the execution's) and the gate config are the spec's,
      // shared by every invocation as before.
      //
      // Structural coupling: a sub-agent gate flows gitignored writes into
      // CAS iff a CAS observer backs that sub-agent's filesystem backend. Deriving
      // both from the same `casObserver` makes "unobserved unreviewable bytes"
      // impossible by construction. Path normalization is unconditional
      // (issue #754): every graph speaks the virtual dialect, so every graph
      // carries the repair seam — matching the parent's composition.
      //
      // Each invocation gets an id of its own, which the agent's hooks see as
      // `agent_id` beside the sub-agent's name as `agent_type`
      // (`subAgentInvocationId`).
      const buildGraph = (invocationId: string) => createDeepAgent({
        model,
        systemPrompt: spec.systemPrompt,
        tools: spec.tools.length > 0 ? spec.tools : undefined,
        middleware: buildSubAgentMiddleware({
          costAdvisory: opts.costAdvisory,
          approvalGate: opts.approvalGate
            ? { ...opts.approvalGate, subAgent: { type: spec.name, id: invocationId } }
            : opts.approvalGate,
          captureIgnored: !!opts.casObserver,
          pathNormalization: { rootDir: opts.workspaceRootDir },
          ...(opts.scopeBase ? { toolScope: { ...opts.scopeBase, scope: spec.scope } } : {}),
        }) as unknown[],
        backend,
        // Enforced inside this graph's own filesystem tools — and inherited by
        // any spec-style sub-agent deepagents auto-injects one level deeper.
        ...(opts.permissions ? { permissions: opts.permissions } : {}),
      } as Parameters<typeof createDeepAgent>[0]);

      // Built once here and dropped: deepagents refuses a bad spec while
      // building (a tool named like a built-in, a permission rule on a
      // shell-capable backend), and a refused spec is skipped at setup with a
      // log line, never failed at its first delegation.
      buildGraph(randomUUID());

      const gatedRunnable = gate.wrapRunnable<Record<string, unknown>, Record<string, unknown>>(
        { invoke: (input, config) => buildGraph(subAgentInvocationId(config)).invoke(input, config) },
        spec.name,
      );

      compiled.push({
        name: spec.name,
        description: spec.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        runnable: gatedRunnable as any,
      });

      console.log(
        `[subagent-transformer] Compiled sub-agent '${spec.name}' ` +
        `(model=${modelName}, tools=${spec.tools.length})`,
      );
    } catch (err) {
      console.error(
        `[subagent-transformer] Failed to compile sub-agent '${spec.name}': ${err}`,
      );
    }
  }

  return compiled;
}

// =========================================================================
// Top-level orchestrator
// =========================================================================

/**
 * Transform proto SubAgents and compile into CompiledSubAgent instances.
 *
 * This is the main entry point called from turn-setup.ts. It orchestrates:
 * 1. Built-in subagent creation (explore, shell, general-purpose)
 * 2. Per-subagent transformation (proto → TransformedSubagent), each with
 *    the parent's MCP tools and its own narrowed scope
 * 3. Skill resolution and prompt injection
 * 4. The main agent's `Agent(type, …)` filter
 * 5. Compilation with middleware + gate wrapping
 *
 * Returns null if no valid subagents after transformation.
 */
export async function transformAndCompileSubagents(
  options: SubagentTransformOptions,
): Promise<CompiledSubAgent[] | null> {
  const {
    subAgents,
    parentMcpTools,
    parentScope,
    scopeBase,
    skills,
    workspaceBackend,
    approvalGate,
    casObserver,
    parentModelName,
    webFetchPosture,
    costAdvisory,
    modelFactory,
    shellEnv,
    permissions,
  } = options;

  if (subAgents.length === 0 && !workspaceBackend.rootDir) {
    return null;
  }

  console.log(
    `[subagent-transformer] Transforming ${subAgents.length} proto sub-agent(s)` +
    (workspaceBackend.rootDir ? " + built-in types" : ""),
  );

  // Step 1: Create built-in subagents
  const builtins = createBuiltinSubagents(
    !!workspaceBackend.rootDir,
    parentScope,
    parentMcpTools,
    webFetchPosture,
  );

  // Step 2: Transform proto subagents
  const transformed: TransformedSubagent[] = [];

  for (const subAgent of subAgents) {
    if (BUILTIN_SUBAGENT_TYPES.has(subAgent.name)) {
      console.warn(
        `[subagent-transformer] Sub-agent name '${subAgent.name}' conflicts with ` +
        "built-in type. The proto definition will override the built-in.",
      );
    }

    try {
      const result = await transformSingleSubagent(subAgent, {
        parentScope,
        parentModelName,
        webFetchPosture,
      });

      if (result) {
        // Resolve skills prompt section for this subagent
        const skillsSection = resolveSubagentSkillPrompt(subAgent, skills);
        const enhancedPrompt = skillsSection
          ? result.systemPrompt.replace(
              RESPONSE_RULES,
              skillsSection + RESPONSE_RULES,
            )
          : result.systemPrompt;

        transformed.push({
          ...result,
          systemPrompt: enhancedPrompt,
          tools: [...parentMcpTools, ...result.tools],
        });
      }
    } catch (err) {
      console.error(
        `[subagent-transformer] Failed to transform sub-agent '${subAgent.name}': ${err}`,
      );
    }
  }

  // Step 3: Merge built-ins with transformed (proto overrides take precedence).
  // Names are unique by the time deepagents sees them: since 1.14 it refuses
  // a duplicate sub-agent name and fails the turn, where it used to let the
  // later one win. Nothing upstream of the runner validates the names, so the
  // runner keeps the behaviour agents were written against — a later
  // declaration overrides an earlier one of the same name, as a proto
  // definition overrides a built-in.
  const declared = new Map<string, TransformedSubagent>();
  for (const spec of transformed) {
    if (declared.has(spec.name)) {
      console.warn(
        `[subagent-transformer] Sub-agent name '${spec.name}' is declared more than once. ` +
        "The later declaration overrides the earlier one.",
      );
      declared.delete(spec.name);
    }
    declared.set(spec.name, spec);
  }
  const candidates = [
    ...builtins.filter((b) => !declared.has(b.name)),
    ...declared.values(),
  ];
  // The main agent's `Agent(type, …)`: a type it does not name never compiles,
  // so the `task` tool cannot offer it.
  const allSpecs = candidates.filter((spec) => {
    if (parentScope.allowsSubAgentType(spec.name)) return true;
    console.log(`[subagent-transformer] Sub-agent '${spec.name}' is outside the agent's tool lists; not compiled`);
    return false;
  });

  if (allSpecs.length === 0) {
    console.warn("[subagent-transformer] No valid subagents after transformation");
    return null;
  }

  // Step 4: Compile all subagents
  const compiled = await compileSubagents(allSpecs, {
    costAdvisory,
    approvalGate,
    scopeBase,
    parentModelName,
    workspaceRootDir: workspaceBackend.rootDir,
    platformDir: workspaceBackend.platformDir,
    casObserver,
    modelFactory,
    shellEnv,
    permissions,
  });

  if (compiled.length === 0) {
    console.warn("[subagent-transformer] No subagents compiled successfully");
    return null;
  }

  console.log(
    `[subagent-transformer] Successfully compiled ${compiled.length} sub-agent(s)`,
  );
  return compiled;
}

/**
 * The id a sub-agent invocation's hooks see as `agent_id`: the parent's
 * `task` call id, which deepagents passes down in the config. A resume after
 * an approval re-invokes the sub-agent for the same call, so its hooks keep
 * one id across the approval; a call with none gets a fresh id.
 */
export function subAgentInvocationId(config: unknown): string {
  const toolCall = typeof config === "object" && config !== null ? (config as { toolCall?: { id?: unknown } }).toolCall : undefined;
  const id = toolCall?.id;
  return typeof id === "string" && id !== "" ? id : randomUUID();
}
