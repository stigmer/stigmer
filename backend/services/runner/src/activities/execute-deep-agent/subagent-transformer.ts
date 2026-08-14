/**
 * SubAgent transformation and compilation.
 *
 * Transforms proto SubAgent definitions into CompiledSubAgent instances for
 * the deepagents JS runtime. Each compiled subagent is a pre-compiled graph
 * with its own middleware stack (loop detection, budget, truncation, cost cap)
 * and concurrency gating via SubAgentGate.
 *
 * Design decisions:
 * - CompiledSubAgent format: full middleware control, no unwanted deepagents defaults
 * - Filter parent MCP tools: no reconnection overhead, stateless servers are the norm
 * - Prompt injection for skills: FilesystemBackend incompatible with native skills field
 * - Built-in explore/shell subagents use prompt-based tool restriction
 * - Built-in general-purpose replaces deepagents' auto-injected one (which carries
 *   no approval gate — see deepagents-profiles.ts for the suppression half)
 * - Sub-agent backends are shell-capable outside plan mode (issue #248), mirroring
 *   the parent's backend selection in setup.ts
 * - Sub-agent graphs carry the parent's filesystem permissions explicitly
 *   (issue #255): pre-built CompiledSubAgents never inherit them, so plan
 *   mode's deny-all-writes rule is baked into each graph at compile time
 * - Invalid configurations are logged and skipped (graceful degradation)
 * - Empty subagent list returns null (no subagents configured)
 */

import { createDeepAgent, FilesystemBackend, LocalShellBackend, DEFAULT_GENERAL_PURPOSE_DESCRIPTION, DEFAULT_SUBAGENT_PROMPT } from "deepagents";
import type { CompiledSubAgent, FilesystemPermission } from "deepagents";
import type { StructuredTool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { SubAgent, McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";

import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import type { StigmerClient } from "../../client/stigmer-client.js";
import type { ApprovalGateConfig } from "../../middleware/approval-gate.js";
import { createCasCaptureBackend } from "./cas-capture-backend.js";
import type { CasCaptureObserver } from "./cas-capture-observer.js";
import type { CostCapMiddleware, StigmerMiddleware } from "../../middleware/index.js";
import { createThinkTool, createWebFetchTool, type GuardPosture } from "../../tools/index.js";
import { buildSubAgentMiddleware } from "./subagent-wiring.js";
import { SubAgentGate } from "../../shared/subagent-gate.js";
import { isModelRegistered } from "../../shared/model-registry.js";
import {
  fetchSkillsByRefs,
  fetchSkillArtifacts,
  writeSkills,
  generatePromptSection,
} from "../../shared/skill-writer.js";

// =========================================================================
// Built-in subagent types and prompts
// =========================================================================

export const BUILTIN_SUBAGENT_TYPES: ReadonlySet<string> = new Set([
  "explore",
  "shell",
  "general-purpose",
]);

const EXPLORE_SYSTEM_PROMPT = `\
You are an exploration specialist. Your ONLY job is to explore codebases \
and report findings back to the parent agent.

STRICT BOUNDARIES:
- Use ONLY the read-only tools provided (read_file, list_dir, glob, grep, search)
- Do NOT write files, create files, or modify anything
- Do NOT execute shell commands
- Do NOT follow skill activation instructions from any context
- Do NOT create deliverables, scaffolds, or run initialization scripts
- Report your findings concisely — the parent agent has direct file access

Your task: {description}`;

const SHELL_SYSTEM_PROMPT = `\
You are a command execution specialist. Your ONLY job is to run shell \
commands and report the results back to the parent agent.

STRICT BOUNDARIES:
- Use ONLY the tools provided (execute, read_file, list_dir)
- Do NOT write or modify files directly — use shell commands if needed
- Do NOT search extensively or explore the codebase beyond what is needed
- Do NOT follow skill activation instructions from any context
- Do NOT create deliverables, scaffolds, or run initialization scripts
- Report command output concisely — the parent agent will interpret results

Your task: {description}`;

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

- After using the read tool, NEVER reprint, echo, list, or \
summarize file contents in your response. Tool results are \
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
}

/**
 * Options for the full subagent transformation and compilation pipeline.
 */
export interface SubagentTransformOptions {
  readonly subAgents: readonly SubAgent[];
  readonly parentMcpTools: readonly StructuredTool[];
  readonly parentMcpServerToolMap: ReadonlyMap<string, readonly StructuredTool[]>;
  readonly parentMcpUsages: readonly McpServerUsage[];
  readonly skillClient: StigmerClient;
  readonly workspaceBackend: WorkspaceBackend;
  /**
   * The parent's approval-gate config, inherited verbatim so a mutating tool
   * inside a sub-agent is gated identically to one in the parent (same policies,
   * toolServerMap, fingerprint key, execution id). Null under auto-approve-all,
   * where the parent gate is inert too — sub-agents then install no gate either.
   */
  readonly approvalGate: ApprovalGateConfig | null;
  /**
   * The parent turn's shared CAS observer, present only in capture mode. When
   * supplied, each sub-agent is built with a CAS-observing filesystem backend
   * wired to THIS observer, so its gitignored writes are captured into the same
   * change set as the parent's (Session 26, DD-19). Absent outside capture mode,
   * where sub-agents keep the plain backend and the classic gitignored deny-gate.
   */
  readonly casObserver?: CasCaptureObserver;
  readonly parentModelName: string;
  readonly parentHasNativeThinking: boolean;
  /**
   * URL-guard posture for the native `web_fetch` tool, inherited from the
   * parent (resolveGuardPosture(config.mode) in setup.ts) so a sub-agent
   * fetch is bounded exactly like a parent fetch.
   */
  readonly webFetchPosture: GuardPosture;
  readonly costCap?: CostCapMiddleware;
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
   * inherited from the parent's rules in setup.ts (plan mode's deny-all-writes
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
 * documented override path). It uses deepagents' own description/prompt so the
 * model's delegation behavior is unchanged, and receives the parent's MCP tools
 * for capability parity with the injected original. Conscious simplification:
 * the parent's skills prompt is NOT inherited — a sub-agent needing skills
 * should be declared explicitly in the Agent spec.
 *
 * Returns an empty array if no workspace is configured (subagents need
 * workspace tools to be useful).
 */
export function createBuiltinSubagents(
  hasWorkspace: boolean,
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
        description: DEFAULT_GENERAL_PURPOSE_DESCRIPTION,
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
 * Handles: proto field extraction, model override validation, think tool
 * injection, and response rules appending. MCP filtering and skill
 * resolution are handled separately and composed by the caller.
 *
 * Returns null if the subagent should be skipped (e.g., invalid model override).
 */
export async function transformSingleSubagent(
  subAgent: SubAgent,
  opts: {
    readonly parentMcpTools: readonly StructuredTool[];
    readonly parentMcpServerToolMap: ReadonlyMap<string, readonly StructuredTool[]>;
    readonly parentMcpUsages: readonly McpServerUsage[];
    readonly parentHasNativeThinking: boolean;
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

  // Build tools list — start with filtered MCP tools (populated by caller)
  const tools: StructuredTool[] = [];

  // Inject think tool when model lacks native extended thinking
  const saHasNativeThinking = model
    ? await _modelSupportsThinking(model)
    : opts.parentHasNativeThinking;

  if (!saHasNativeThinking) {
    tools.push(createThinkTool() as unknown as StructuredTool);
  }

  // web_fetch is unconditional — unlike think, it is a capability, not a
  // reasoning aid, and the parent always has it (setup.ts Step 11). A
  // sub-agent silently lacking web access the parent has would recreate the
  // harness-parity gap of issue #214 one level down.
  tools.push(createWebFetchTool({ posture: opts.webFetchPosture }) as unknown as StructuredTool);

  // Append response rules
  systemPrompt += RESPONSE_RULES;

  return { name, description, systemPrompt, tools, model };
}

// =========================================================================
// MCP tool filtering
// =========================================================================

/**
 * Filter parent MCP tools based on a subagent's McpAccess grants.
 *
 * Permission model:
 * - Subagent can only access MCP servers explicitly listed in its mcpAccess
 * - Tool names must be a subset of parent's enabled tools for that server
 * - Empty enabledTools in McpAccess = inherit all parent tools for that server
 * - Invalid slug or missing server → warn and skip
 */
export function filterMcpToolsForSubagent(
  mcpAccess: readonly { mcpServer: string; enabledTools: readonly string[] }[],
  parentMcpServerToolMap: ReadonlyMap<string, readonly StructuredTool[]>,
  parentMcpUsages: readonly McpServerUsage[],
): StructuredTool[] {
  if (mcpAccess.length === 0) return [];

  const usageSlugs = new Set(
    parentMcpUsages
      .map((u) => u.mcpServerRef?.slug)
      .filter((s): s is string => !!s),
  );

  const filtered: StructuredTool[] = [];

  for (const access of mcpAccess) {
    const slug = access.mcpServer;
    if (!slug) {
      console.warn("[subagent-transformer] McpAccess has empty mcp_server slug, skipping");
      continue;
    }

    if (!usageSlugs.has(slug)) {
      console.warn(
        `[subagent-transformer] SubAgent references unknown MCP server '${slug}' ` +
        "(not in parent's mcp_server_usages), skipping",
      );
      continue;
    }

    const serverTools = parentMcpServerToolMap.get(slug);
    if (!serverTools || serverTools.length === 0) {
      console.warn(
        `[subagent-transformer] MCP server '${slug}' has no tools in parent's connection, skipping`,
      );
      continue;
    }

    if (access.enabledTools.length === 0) {
      filtered.push(...serverTools);
    } else {
      const allowedNames = new Set(access.enabledTools);
      for (const tool of serverTools) {
        if (allowedNames.has(tool.name)) {
          filtered.push(tool);
        } else if (allowedNames.has(tool.name)) {
          // already included
        }
      }

      const parentToolNames = new Set(serverTools.map((t) => t.name));
      for (const requestedTool of access.enabledTools) {
        if (!parentToolNames.has(requestedTool)) {
          console.warn(
            `[subagent-transformer] SubAgent requests tool '${requestedTool}' from server '${slug}' ` +
            "but it's not in parent's enabled tools, skipping tool",
          );
        }
      }
    }
  }

  return filtered;
}

// =========================================================================
// Skill resolution for subagents
// =========================================================================

/**
 * Collect all unique skill refs across all subagents for batch fetching.
 *
 * Deduplicates by slug to minimize gRPC calls. Returns an array of refs
 * and the mapping from slug to original refs for distribution.
 */
export function collectAllSkillRefs(
  subAgents: readonly SubAgent[],
): { slug: string; ref: unknown }[] {
  const seen = new Set<string>();
  const unique: { slug: string; ref: unknown }[] = [];

  for (const sa of subAgents) {
    for (const ref of sa.skillRefs) {
      const slug = (ref as { slug?: string }).slug;
      if (slug && !seen.has(slug)) {
        seen.add(slug);
        unique.push({ slug, ref });
      }
    }
  }

  return unique;
}

/**
 * Resolve skills for a single subagent and return the prompt section.
 *
 * Looks up each of the subagent's skill_refs in the pre-fetched skills
 * collection and generates a prompt section containing activation
 * instructions and file paths.
 *
 * Returns empty string if no skills match or if the subagent has no skill_refs.
 */
export function resolveSubagentSkillPrompt(
  subAgent: SubAgent,
  skillsBySlug: ReadonlyMap<string, { skill: unknown; path: string }>,
): string {
  if (subAgent.skillRefs.length === 0) return "";

  const matchedSkills: unknown[] = [];
  const matchedPaths = new Map<string, string>();

  for (const ref of subAgent.skillRefs) {
    const slug = (ref as { slug?: string }).slug;
    if (!slug) continue;

    const entry = skillsBySlug.get(slug);
    if (entry) {
      matchedSkills.push(entry.skill);
      const id = (entry.skill as { metadata?: { id?: string } }).metadata?.id;
      if (id) matchedPaths.set(id, entry.path);
    }
  }

  if (matchedSkills.length === 0) return "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return generatePromptSection(matchedSkills as any[], matchedPaths);
}

// =========================================================================
// Compilation pipeline
// =========================================================================

/**
 * Select a sub-agent's deepagents backend, mirroring the parent's selection in
 * setup.ts along two independent axes:
 *
 * - CAS observation (capture mode): when a shared observer is supplied, the
 *   backend records pre-turn bytes of CAS-owned paths so the sub-agent's
 *   gitignored writes fold into the parent turn's change set (DD-19). Without
 *   one, writes stay on the classic gitignored deny-gate.
 * - Shell capability (issue #248): when `shellEnv` is present the backend
 *   implements deepagents' sandbox protocol so the `execute` tool exists
 *   (approval-gated by the sub-agent's own middleware). Absent (plan mode),
 *   the backend is filesystem-only — read-only by construction, matching the
 *   parent.
 *
 * Every variant is virtual-rooted (`virtualMode: true`) like the parent's —
 * see the cas-capture-backend.ts header (issue #754): workspace confinement
 * is structural on every graph, sub-agents included.
 */
async function buildSubagentBackend(opts: {
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
 * - Its own agent graph sharing the parent's workspace root (shell-capable
 *   outside plan mode; see {@link buildSubagentBackend})
 * - Per-subagent middleware (loop detection, budget, truncation, cost cap view)
 * - Concurrency gating via shared SubAgentGate
 */
export async function compileSubagents(
  transformed: readonly TransformedSubagent[],
  opts: {
    readonly costCap?: CostCapMiddleware;
    readonly approvalGate?: ApprovalGateConfig | null;
    readonly parentModelName: string;
    readonly workspaceRootDir: string;
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
      // Structural coupling (DD-19): a sub-agent gate flows gitignored writes into
      // CAS iff a CAS observer backs that sub-agent's filesystem backend. Deriving
      // both from the same `casObserver` makes "unobserved unreviewable bytes"
      // impossible by construction. Path normalization is unconditional
      // (issue #754): every graph speaks the virtual dialect, so every graph
      // carries the repair seam — matching the parent's composition.
      const middleware = buildSubAgentMiddleware({
        costCap: opts.costCap,
        approvalGate: opts.approvalGate,
        captureIgnored: !!opts.casObserver,
        pathNormalization: { rootDir: opts.workspaceRootDir },
      });

      const modelName = spec.model ?? opts.parentModelName;
      // Use a configured model instance (proxy base URL + auth, plus registry
      // id -> API id resolution) when a factory is supplied so sub-agent LLM
      // calls route through the same proxy as the parent. Falling back to the
      // bare name lets deepagents construct a default client (unit tests /
      // no-proxy paths).
      const model = opts.modelFactory ? await opts.modelFactory(modelName) : modelName;

      const backend = await buildSubagentBackend(opts);

      const agentGraph = await createDeepAgent({
        model,
        systemPrompt: spec.systemPrompt,
        tools: spec.tools.length > 0 ? spec.tools : undefined,
        middleware: middleware as unknown[],
        backend,
        // Enforced inside this graph's own filesystem tools — and inherited by
        // any spec-style sub-agent deepagents auto-injects one level deeper.
        ...(opts.permissions ? { permissions: opts.permissions } : {}),
      } as Parameters<typeof createDeepAgent>[0]);

      const gatedRunnable = gate.wrapRunnable(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        agentGraph as any,
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
 * This is the main entry point called from setup.ts. It orchestrates:
 * 1. Built-in subagent creation (explore, shell, general-purpose)
 * 2. Per-subagent transformation (proto → TransformedSubagent)
 * 3. MCP tool filtering per subagent
 * 4. Skill resolution and prompt injection (Session 2)
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
    parentMcpServerToolMap,
    parentMcpUsages,
    skillClient,
    workspaceBackend,
    approvalGate,
    casObserver,
    parentModelName,
    parentHasNativeThinking,
    webFetchPosture,
    costCap,
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
    parentMcpTools,
    webFetchPosture,
  );

  // Step 1b: Batch fetch all skills referenced by subagents
  const allSkillRefs = collectAllSkillRefs(subAgents);
  const skillsBySlug = new Map<string, { skill: unknown; path: string }>();

  if (allSkillRefs.length > 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const refs = allSkillRefs.map((r) => r.ref) as any[];
      const skills = await fetchSkillsByRefs(skillClient, refs);

      if (skills.length > 0) {
        const artifacts = await fetchSkillArtifacts(skillClient, skills);
        const { paths: skillPaths } = await writeSkills(skills, workspaceBackend, artifacts);

        for (const skill of skills) {
          const slug = (skill as { metadata?: { slug?: string } }).metadata?.slug;
          const id = (skill as { metadata?: { id?: string } }).metadata?.id;
          if (slug && id) {
            skillsBySlug.set(slug, { skill, path: skillPaths.get(id) ?? "" });
          }
        }
        console.log(
          `[subagent-transformer] Fetched ${skills.length} skill(s) for subagents`,
        );
      }
    } catch (err) {
      console.error(`[subagent-transformer] Failed to fetch skills for subagents: ${err}`);
    }
  }

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
        parentMcpTools,
        parentMcpServerToolMap,
        parentMcpUsages,
        parentHasNativeThinking,
        parentModelName,
        webFetchPosture,
      });

      if (result) {
        // Apply MCP filtering for this subagent
        const mcpTools = filterMcpToolsForSubagent(
          subAgent.mcpAccess,
          parentMcpServerToolMap,
          parentMcpUsages,
        );

        // Resolve skills prompt section for this subagent
        const skillsSection = resolveSubagentSkillPrompt(subAgent, skillsBySlug);
        const enhancedPrompt = skillsSection
          ? result.systemPrompt.replace(
              RESPONSE_RULES,
              skillsSection + RESPONSE_RULES,
            )
          : result.systemPrompt;

        transformed.push({
          ...result,
          systemPrompt: enhancedPrompt,
          tools: [...mcpTools, ...result.tools],
        });
      }
    } catch (err) {
      console.error(
        `[subagent-transformer] Failed to transform sub-agent '${subAgent.name}': ${err}`,
      );
    }
  }

  // Step 3: Merge built-ins with transformed (proto overrides take precedence)
  const protoNames = new Set(transformed.map((t) => t.name));
  const allSpecs = [
    ...builtins.filter((b) => !protoNames.has(b.name)),
    ...transformed,
  ];

  if (allSpecs.length === 0) {
    console.warn("[subagent-transformer] No valid subagents after transformation");
    return null;
  }

  // Step 4: Compile all subagents
  const compiled = await compileSubagents(allSpecs, {
    costCap,
    approvalGate,
    parentModelName,
    workspaceRootDir: workspaceBackend.rootDir,
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

// =========================================================================
// Private helpers
// =========================================================================

/**
 * Check if a model supports native extended thinking.
 *
 * Heuristic: models with "claude" in the name that are NOT haiku-class
 * support thinking. Models with "o1", "o3", "o4" support reasoning.
 * This is a conservative heuristic — err on the side of injecting the
 * think tool (it's harmless if the model already thinks natively).
 */
async function _modelSupportsThinking(modelId: string): Promise<boolean> {
  const lower = modelId.toLowerCase();

  if (lower.includes("haiku")) return false;
  if (lower.includes("gpt-4o-mini")) return false;

  if (lower.includes("claude") && (
    lower.includes("sonnet") || lower.includes("opus")
  )) return true;

  if (lower.includes("o1") || lower.includes("o3") || lower.includes("o4")) {
    return true;
  }

  return false;
}
