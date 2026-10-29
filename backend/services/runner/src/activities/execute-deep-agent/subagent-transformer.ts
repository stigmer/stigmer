/**
 * Subagent transformation and compilation.
 *
 * Transforms the turn's subagents into CompiledSubAgent instances for the
 * deepagents JS runtime: the saved agents the turn's agent lists, each from
 * its own context (`TurnSubagent`), the plugins' agents
 * (`PluginSubagent`), and the built-ins. Each compiled subagent is a runnable that builds
 * a fresh graph on a fresh middleware stack (loop detection, budget,
 * truncation, cost view) for every invocation, so concurrent invocations of
 * one sub-agent never share a conversation's state, and is gated for
 * concurrency by SubAgentGate.
 *
 * Design decisions:
 * - CompiledSubAgent format: full middleware control, no unwanted deepagents defaults
 * - A saved subagent runs its own definition: its own plugins' MCP tools (a
 *   server the parent also has is the one connection), its own scope, model,
 *   skills, shell values and hooks, the conversation's hooks running first
 *   (its gate config is its own, built by turn-setup.ts). It gets none of the
 *   parent's MCP tools and none of the platform's own servers.
 * - A plugin subagent and the built-in general-purpose bind the parent's MCP
 *   tools (no reconnection overhead, stateless servers are the norm); what one
 *   may see and call is its tool scope — the parent's, narrowed by the plugin's
 *   lists for it and never widened — enforced inside its graph by the
 *   tool-scope middleware (`subagent-wiring.ts`)
 * - One level: every subagent's scope denies `Agent`, so the tool-scope
 *   middleware takes deepagents' `task` tool out of what its model sees and
 *   refuses a call to it; no subagent hands work on
 * - The main agent's `Agent(type, …)` entry limits which subagents compile;
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
 * - The workspace's own instruction files reach every sub-agent whose own
 *   scope may read the workspace: the roots' section closes its prompt, and
 *   a folder's file rides its first read beneath it, as on the parent
 *   (`repository-instructions.ts`); a sub-agent edits the same tree
 * - Invalid configurations are logged and skipped (graceful degradation)
 * - Empty subagent list returns null (no subagents configured)
 */

import { randomUUID } from "node:crypto";
import { createDeepAgent, FilesystemBackend, LocalShellBackend, DEFAULT_SUBAGENT_PROMPT } from "deepagents";
import type { AnyBackendProtocol, CompiledSubAgent, FilesystemPermission } from "deepagents";
import type { StructuredTool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { STIGMER_TOOL_COVERS } from "@stigmer/tool-vocabulary";

import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import type { ApprovalGateConfig } from "../../middleware/approval-gate.js";
import type { ToolScopeConfig } from "../../middleware/tool-scope.js";
import type { ToolTruncationConfig } from "../../middleware/types.js";
import type { TurnBoundarySignals } from "../../middleware/turn-boundary.js";
import type { ToolScope } from "../../shared/tool-lists.js";
import { CasCaptureShellBackend, createCasCaptureBackend } from "./cas-capture-backend.js";
import { createShellBinding, type ShellToolOptions } from "./shell-tool.js";
import { trimTrailingLineEnds } from "../../shared/text-cut.js";

/** How a sub-agent's shell tool runs, beside its backend: the parent's ceiling and streaming floor. */
export type ShellStreaming = Omit<ShellToolOptions, "backend">;

/** The run's tool-result bound a sub-agent takes; its backend is its own. */
export type SubagentToolTruncation = Pick<ToolTruncationConfig, "maxChars">;

/** The workspace's own instruction files as the turn read them (`repository-instructions.ts`); each sub-agent reads deeper ones through its own backend. */
export interface SubagentRepositoryInstructions {
  /** The roots' rendered `## Repository instructions` section; empty when none reads. */
  readonly section: string;
  /** The workspace's roots, where the folder walk stops. */
  readonly roots: readonly string[];
  /** The run's bound on each file. */
  readonly maxChars: number;
}
import { mountPlatformRoute, OUTPUTS_ROUTE_PREFIX as STIGMER_OUTPUTS_FOLDER } from "./platform-route.js";
import { outputsFolderInstruction } from "../../shared/prompt-sections.js";
import type { CasCaptureObserver } from "../../shared/filereview/cas-capture-observer.js";
import type { CostAdvisoryMiddleware, StigmerMiddleware } from "../../middleware/index.js";
import { createWebFetchTool, type GuardPosture } from "../../tools/index.js";
import { withSubAgentSpan } from "../../middleware/otel-spans.js";
import { createCompactionMiddleware } from "../../middleware/compaction.js";
import { buildSubAgentMiddleware } from "./subagent-wiring.js";
import { SubAgentGate } from "../../shared/subagent-gate.js";
import type { SkillMetadata } from "../../shared/skill-resolver.js";
import type { PluginSubagent } from "../../shared/blueprint-resolver.js";
import type { TurnSubagent } from "../../harness/types.js";
import { ONE_LEVEL_LAYER, pluginSubagentScope, subagentModel, subagentPromptExtras } from "../../shared/subagents.js";
import { renderSkillsSection } from "./prompt-builder.js";
import { ENGINE_TOOL } from "./engine-tools.js";
import { McpToolIndex } from "../../shared/mcp-tool-names.js";

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

/**
 * A sub-agent's prompt as it is compiled: its own, and, when it may save a
 * file for the person, the outputs folder's line closing its response
 * rules. Not under plan mode, whose rules deny every write, and not on the
 * read-only `explore` agent, whose prompt forbids writing. Then, when its own
 * scope may read the workspace, the workspace roots' instruction files, last,
 * beneath its instructions ({@link readsWorkspace}).
 */
export function compiledPrompt(spec: TransformedSubagent, writesAllowed: boolean, repositoryInstructionsSection = ""): string {
  const extras = subagentPromptExtras({
    writesAllowed: writesAllowed && spec.name !== "explore",
    readsWorkspace: readsWorkspace(spec),
    hasRepositoryInstructions: repositoryInstructionsSection !== "",
  });
  const own = extras.outputsLine ? `${spec.systemPrompt}- ${outputsFolderInstruction(STIGMER_OUTPUTS_FOLDER)}\n` : spec.systemPrompt;
  if (!extras.repositoryInstructions) return own;
  return `${trimTrailingLineEnds(own)}${repositoryInstructionsSection}\n`;
}

/** Whether a sub-agent's own scope lets `read_file` read the workspace, as its scope middleware judges a read (`middleware/tool-scope.ts`). */
export function readsWorkspace(spec: TransformedSubagent): boolean {
  return spec.scope.allowsEngineTool(ENGINE_TOOL.readFile, STIGMER_TOOL_COVERS);
}

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
  /** What this subagent may see and call (the module header). */
  readonly scope: ToolScope;
  /** A saved subagent's own gate and shell; absent, the parent's. */
  readonly own?: {
    readonly approvalGate: ApprovalGateConfig | null;
    readonly shellEnv: Record<string, string> | undefined;
  };
}

/** What a saved subagent's graph is built from: its context, and what this engine made of it. */
export interface SavedSubagentGraph {
  readonly subagent: TurnSubagent;
  /** The MCP tools of its own servers. */
  readonly mcpTools: readonly StructuredTool[];
  /** Its gate: the parent's posture with its own hook evaluator (turn-setup.ts). */
  readonly approvalGate: ApprovalGateConfig | null;
  /** Its shell's environment: its own values only; undefined in plan mode, as the parent's. */
  readonly shellEnv: Record<string, string> | undefined;
}

/** Everything a sub-agent's tool scope needs besides the scope itself; shared with the parent's. */
export type SubagentScopeBase = Omit<ToolScopeConfig, "scope">;

/** A built-in's scope: the parent's, with `Agent` denied (one level). */
function builtinScope(parentScope: ToolScope): ToolScope {
  return parentScope.narrow(ONE_LEVEL_LAYER.owner, ONE_LEVEL_LAYER.lists);
}

/**
 * Options for the full subagent transformation and compilation pipeline.
 */
export interface SubagentTransformOptions {
  /** The plugins' agents, which bind the parent's MCP tools under the parent's scope narrowed. */
  readonly pluginAgents: readonly PluginSubagent[];
  /** The saved agents the turn's agent lists, each with what its graph is built from. */
  readonly subagents: readonly SavedSubagentGraph[];
  /** Every MCP tool the parent binds; a plugin subagent binds them all and its scope narrows them. */
  readonly parentMcpTools: readonly StructuredTool[];
  /** The main agent's tool scope; a plugin subagent's narrows it, and its `Agent(type, …)` picks which compile. */
  readonly parentScope: ToolScope;
  /** The attribution and confinement every sub-agent's scope middleware reads. */
  readonly scopeBase: SubagentScopeBase;
  /**
   * Each plugin subagent's mounted skills, keyed by its name — the
   * runtime's `TurnSkills.bySubAgent`. One with no entry renders no skills
   * section. A saved subagent's are on its context.
   */
  readonly skills: ReadonlyMap<string, readonly SkillMetadata[]>;
  readonly workspaceBackend: WorkspaceBackend;
  /**
   * The parent's approval-gate config, inherited verbatim so a mutating tool
   * inside a sub-agent is gated identically to one in the parent (same default,
   * MCP index, fingerprint key, execution id). Null under auto-approve-all,
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
  /** The server and bare tool each MCP engine name stands for, for the sub-agents' tool spans (`middleware/otel-spans.ts`). */
  readonly mcpIndex?: McpToolIndex;
  /**
   * URL-guard posture for the Stigmer harness's `web_fetch` tool, inherited from the
   * parent (resolveGuardPosture(config.mode) in turn-setup.ts) so a sub-agent
   * fetch is bounded exactly like a parent fetch.
   */
  readonly webFetchPosture: GuardPosture;
  readonly costAdvisory?: CostAdvisoryMiddleware;
  /** The turn's stop, taken at every sub-agent's model calls (`middleware/turn-boundary.ts`). */
  readonly turnBoundary?: TurnBoundarySignals;
  /**
   * The run's bound on a tool result (`max_tool_result_chars`), which the
   * contract applies to every tool result, a sub-agent's included. Each
   * sub-agent keeps a long result through its own backend
   * (`middleware/tool-truncation.ts`). Absent, the middleware's default.
   */
  readonly toolTruncation?: SubagentToolTruncation;
  /**
   * The workspace's own instruction files (`repository-instructions.ts`),
   * shown to each sub-agent whose own scope may read the workspace. Absent,
   * none is shown (unit tests).
   */
  readonly repositoryInstructions?: SubagentRepositoryInstructions;
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
   * How a shell-capable sub-agent's `execute` tool runs (`shell-tool.ts`):
   * the timeout ceiling and the streaming floor, the parent's. Absent, a
   * sub-agent's shell is deepagents' own (unit tests that build no turn).
   */
  readonly shellStreaming?: ShellStreaming;
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
 * original. Every built-in runs under the parent's own tool scope with
 * `Agent` denied: it declares no lists of its own and hands no work on. Conscious simplification: the parent's
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
        // Parent-parity tool set: MCP tools plus the Stigmer web_fetch the
        // parent always carries. explore/shell stay web-less on purpose —
        // their prompts scope them to the workspace, not the internet.
        tools: [
          ...parentMcpTools,
          ...(webFetchPosture
            ? [createWebFetchTool({ posture: webFetchPosture }) as unknown as StructuredTool]
            : []),
        ],
        scope: builtinScope(parentScope),
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
      scope: builtinScope(parentScope),
    });
  }

  return result;
}

// =========================================================================
// Single subagent transformation
// =========================================================================

/**
 * A plugin subagent in the intermediate representation: its plugin's
 * instructions, the model its file names where this engine lists it (else
 * the turn's), the runner's own tools, and the parent's scope narrowed by
 * its lists. The parent's MCP tools are composed by the caller.
 */
export async function transformPluginSubagent(
  agent: PluginSubagent,
  opts: {
    readonly parentScope: ToolScope;
    readonly webFetchPosture: GuardPosture;
    readonly skills: ReadonlyMap<string, readonly SkillMetadata[]>;
  },
): Promise<TransformedSubagent> {
  const model = await subagentModel(agent.model, Harness.STIGMER);
  if (agent.model !== "" && model === undefined) {
    console.log(
      `[subagent-transformer] Plugin subagent '${agent.name}' names model '${agent.model}', which this engine does not list; it runs on the turn's model`,
    );
  }
  return {
    name: agent.name,
    description: agent.description || `Sub-agent: ${agent.name}`,
    systemPrompt: withSkills(agent.instructions, opts.skills.get(agent.name) ?? []),
    tools: [webFetch(opts.webFetchPosture)],
    ...(model !== undefined ? { model } : {}),
    scope: pluginSubagentScope(opts.parentScope, agent),
  };
}

/**
 * A saved subagent in the intermediate representation, from its context:
 * its instructions and skills, its model (the runtime resolved it), its own
 * servers' tools and the runner's, its own scope, and its own gate and
 * shell.
 */
export function transformSavedSubagent(graph: SavedSubagentGraph, webFetchPosture: GuardPosture): TransformedSubagent {
  const { subagent } = graph;
  return {
    name: subagent.name,
    description: subagent.description || `Subagent: ${subagent.name}`,
    systemPrompt: withSkills(subagent.instructions, subagent.skills),
    tools: [...graph.mcpTools, webFetch(webFetchPosture)],
    ...(subagent.model !== undefined ? { model: subagent.model } : {}),
    scope: subagent.toolScope,
    own: { approvalGate: graph.approvalGate, shellEnv: graph.shellEnv },
  };
}

/**
 * The runner's own tool every subagent binds. web_fetch is unconditional:
 * the parent always has it (turn-setup.ts `buildEngine`), and a subagent
 * silently lacking web access the parent has would recreate the
 * harness-parity gap of issue #214 one level down. No tool stands in for
 * reasoning: a subagent's model thinks in the execution's thinking mode
 * (#1976).
 */
function webFetch(posture: GuardPosture): StructuredTool {
  return createWebFetchTool({ posture }) as unknown as StructuredTool;
}

/** A subagent's system prompt: its instructions, its `## Skills` section, then the response rules. */
function withSkills(instructions: string, skills: readonly SkillMetadata[]): string {
  return instructions + renderSkillsSection(skills) + RESPONSE_RULES;
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
 *   (shell-capable outside plan mode, with the runner's shell tool over it;
 *   see {@link buildSubagentWorkspaceBackend})
 * - A fresh agent graph and middleware stack (loop detection, budget,
 *   truncation, cost view) per invocation, built once more at compile only
 *   to refuse a spec deepagents cannot build
 * - Concurrency gating via shared SubAgentGate
 */
export async function compileSubagents(
  transformed: readonly TransformedSubagent[],
  opts: {
    readonly costAdvisory?: CostAdvisoryMiddleware;
    readonly turnBoundary?: TurnBoundarySignals;
    /** See {@link SubagentTransformOptions.toolTruncation}. */
    readonly toolTruncation?: SubagentToolTruncation;
    /** See {@link SubagentTransformOptions.repositoryInstructions}. */
    readonly repositoryInstructions?: SubagentRepositoryInstructions;
    readonly approvalGate?: ApprovalGateConfig | null;
    /** Attribution and confinement for each sub-agent's scope middleware; absent, no scope is enforced (unit tests). */
    readonly scopeBase?: SubagentScopeBase;
    readonly parentModelName: string;
    readonly workspaceRootDir: string;
    /** The session's platform dir, mounted read-only at `.stigmer/` (`platform-route.ts`). */
    readonly platformDir?: string;
    /** Shared CAS observer (capture mode only); see {@link SubagentTransformOptions.casObserver}. */
    readonly casObserver?: CasCaptureObserver;
    /** See {@link SubagentTransformOptions.mcpIndex}. */
    readonly mcpIndex?: McpToolIndex;
    readonly modelFactory?: (modelName: string) => Promise<BaseChatModel>;
    /** Shell env for `execute`; see {@link SubagentTransformOptions.shellEnv}. */
    readonly shellEnv?: Record<string, string>;
    /** See {@link SubagentTransformOptions.shellStreaming}. */
    readonly shellStreaming?: ShellStreaming;
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

      // A saved subagent's gate and shell are its own (its hooks, its
      // values); every other subagent's are the parent's.
      const approvalGate = spec.own ? spec.own.approvalGate : opts.approvalGate;
      const shellEnv = spec.own ? spec.own.shellEnv : opts.shellEnv;
      const workspace = await buildSubagentWorkspaceBackend({ ...opts, shellEnv });
      const backend = await mountPlatformRoute(workspace, { workspaceDir: opts.workspaceRootDir, platformDir: opts.platformDir });
      // The sub-agent's own shell over its own backend (its values, never the
      // parent's), shared by every invocation as the backend is.
      const shell = workspace instanceof CasCaptureShellBackend && opts.shellStreaming
        ? createShellBinding({ backend: workspace, ...opts.shellStreaming })
        : undefined;
      // The workspace's instruction files, when this sub-agent's own scope
      // may read the workspace: deeper ones through its own backend.
      const repository = opts.repositoryInstructions !== undefined && readsWorkspace(spec)
        ? opts.repositoryInstructions
        : undefined;
      const systemPrompt = compiledPrompt(spec, opts.permissions === undefined, repository?.section);

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
        systemPrompt,
        tools: spec.tools.length > 0 ? spec.tools : undefined,
        // The summarizer replaces deepagents' own by name, over this
        // sub-agent's backend and on its own model (`middleware/compaction.ts`).
        middleware: [createCompactionMiddleware({ backend }), ...buildSubAgentMiddleware({
          costAdvisory: opts.costAdvisory,
          ...(opts.turnBoundary ? { turnBoundary: opts.turnBoundary } : {}),
          toolTruncation: { ...opts.toolTruncation, backend },
          ...(repository
            ? { folderInstructions: { backend, roots: repository.roots, maxChars: repository.maxChars } }
            : {}),
          approvalGate: approvalGate
            ? { ...approvalGate, subAgent: { type: spec.name, id: invocationId } }
            : approvalGate,
          captureIgnored: !!opts.casObserver,
          pathNormalization: { rootDir: opts.workspaceRootDir },
          ...(opts.scopeBase ? { toolScope: { ...opts.scopeBase, scope: spec.scope } } : {}),
          otelSpans: { mcpIndex: opts.mcpIndex ?? McpToolIndex.EMPTY },
          ...(shell ? { shell } : {}),
        })] as unknown[],
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

      // Each invocation runs in an `invoke_agent` span of its own, opened
      // inside the parent's `task` tool span, so the sub-agent's calls nest
      // where they happened in the run's trace.
      const gatedRunnable = gate.wrapRunnable<Record<string, unknown>, Record<string, unknown>>(
        {
          invoke: (input, config) =>
            withSubAgentSpan(spec.name, () => buildGraph(subAgentInvocationId(config)).invoke(input, config)),
        },
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
 * Transform the turn's subagents and compile them into CompiledSubAgent
 * instances.
 *
 * This is the main entry point called from turn-setup.ts. It orchestrates:
 * 1. Built-in subagent creation (explore, shell, general-purpose)
 * 2. Each plugin subagent, with the parent's MCP tools under its narrowed
 *    scope, and each saved subagent, from its own context
 * 3. The main agent's `Agent(type, …)` filter
 * 4. Compilation with middleware + gate wrapping
 *
 * Returns null if no valid subagents after transformation.
 */
export async function transformAndCompileSubagents(
  options: SubagentTransformOptions,
): Promise<CompiledSubAgent[] | null> {
  const {
    pluginAgents,
    subagents,
    parentMcpTools,
    parentScope,
    scopeBase,
    skills,
    workspaceBackend,
    approvalGate,
    casObserver,
    parentModelName,
    mcpIndex,
    webFetchPosture,
    costAdvisory,
    turnBoundary,
    toolTruncation,
    repositoryInstructions,
    modelFactory,
    shellEnv,
    shellStreaming,
    permissions,
  } = options;

  if (pluginAgents.length === 0 && subagents.length === 0 && !workspaceBackend.rootDir) {
    return null;
  }

  console.log(
    `[subagent-transformer] Transforming ${subagents.length} subagent(s) and ${pluginAgents.length} plugin subagent(s)` +
    (workspaceBackend.rootDir ? " + built-in types" : ""),
  );

  const builtins = createBuiltinSubagents(
    !!workspaceBackend.rootDir,
    parentScope,
    parentMcpTools,
    webFetchPosture,
  );

  const transformed: TransformedSubagent[] = [];
  for (const agent of pluginAgents) {
    const result = await transformPluginSubagent(agent, { parentScope, webFetchPosture, skills });
    transformed.push({ ...result, tools: [...parentMcpTools, ...result.tools] });
  }
  for (const graph of subagents) {
    if (BUILTIN_SUBAGENT_TYPES.has(graph.subagent.name)) {
      console.warn(
        `[subagent-transformer] Subagent '${graph.subagent.name}' has a built-in type's name; it overrides the built-in.`,
      );
    }
    transformed.push(transformSavedSubagent(graph, webFetchPosture));
  }

  // Names are unique by the time deepagents sees them, which refuses a
  // duplicate since 1.14: a saved subagent's slug holds no ':' and a plugin
  // subagent's name always does, and a declared name overrides a built-in.
  const declared = new Set(transformed.map((spec) => spec.name));
  const candidates = [...builtins.filter((b) => !declared.has(b.name)), ...transformed];
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

  const compiled = await compileSubagents(allSpecs, {
    costAdvisory,
    ...(turnBoundary ? { turnBoundary } : {}),
    ...(toolTruncation ? { toolTruncation } : {}),
    ...(repositoryInstructions ? { repositoryInstructions } : {}),
    approvalGate,
    scopeBase,
    parentModelName,
    workspaceRootDir: workspaceBackend.rootDir,
    platformDir: workspaceBackend.platformDir,
    casObserver,
    mcpIndex,
    modelFactory,
    shellEnv,
    shellStreaming,
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
