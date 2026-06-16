/**
 * Execution setup pipeline for the deep agent activity.
 *
 * Hydrates the execution from the database, resolves the full resource
 * chain (session -> agentInstance -> agent), provisions workspace, loads
 * MCP servers / environment, creates the LangGraph agent graph with the
 * full middleware stack, and returns a SetupResult containing everything
 * the streaming phase needs.
 */

import { createDeepAgent, type FilesystemPermission } from "deepagents";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentGraph = any;

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { DynamicStructuredTool } from "@langchain/core/tools";

import type { Config } from "../../config.js";
import type { StigmerClient } from "../../client/stigmer-client.js";
import { createCheckpointer } from "../../shared/checkpointer/factory.js";
import { connectMcpServers, type McpConnectionResult } from "../../shared/mcp-manager.js";
import { resolveMcpServers } from "../../shared/mcp-resolver.js";
import { backfillMcpServersIfNeeded } from "../../shared/connect-backfill.js";
import { WorkspaceProvisioner } from "../../shared/workspace/provisioner.js";
import { LocalWorkspaceBackend } from "../../shared/workspace/local-backend.js";
import type { WorkspaceBackend, ProvisionResult } from "../../shared/workspace/types.js";
import { CapturingFilesystemBackend } from "./capturing-filesystem-backend.js";
import { FileChangeCaptureBuffer } from "./file-change-buffer.js";
import { ensurePlatformDir } from "../../shared/workspace/platform-dir.js";
import { buildWorkspaceFileTree } from "../../shared/workspace/file-tree.js";
import { reportSetupProgress } from "../../shared/status.js";
import { resolveEnvironment, type EnvironmentResult } from "./environment.js";
import { buildEnhancedSystemPrompt } from "./prompt-builder.js";
import { buildMiddlewareStack, createThinkTool } from "../../middleware/index.js";
import type { GracefulStopMiddleware } from "../../middleware/index.js";
import { getModelPricing, ensureLoaded as ensurePricingLoaded } from "../../shared/model-pricing.js";
import { getDefaultModel } from "../../shared/model-registry.js";
import {
  loadArtifactStorageConfig,
  createArtifactStorage,
  type ArtifactStorage,
} from "../../shared/artifact-storage.js";
import {
  mergeApprovalPolicies,
  hasApproveAllDecision,
  type MergedToolPolicy,
} from "../../shared/approval-policy.js";
import {
  inferProvider,
  stripProviderPrefix,
  resolveProxyBaseUrl,
  buildProxyHeaders,
} from "../../shared/llm-proxy.js";
import {
  mergeSkillRefs,
  fetchSkillsByRefs,
  writeSkills,
  computeSkillPaths,
  checkSkillIntegrity,
  generatePromptSection,
  generateAlsoAvailableSection,
  fetchSkillArtifacts,
} from "../../shared/skill-writer.js";
import { filterSkills, SKILL_COUNT_THRESHOLD } from "../../shared/skill-relevance.js";
import { injectAttachments } from "./attachment-injector.js";
import { transformAndCompileSubagents } from "./subagent-transformer.js";

export interface SetupResult {
  readonly agentGraph: AgentGraph;
  readonly langgraphConfig: Record<string, unknown>;
  readonly langgraphInput: Record<string, unknown>;
  readonly execution: AgentExecution;
  readonly agent: Agent;
  readonly session: Session;
  readonly workspaceBackend: WorkspaceBackend;
  readonly mcpConnection: McpConnectionResult | null;
  readonly mergedEnvVars: Record<string, string>;
  readonly secretKeys: ReadonlySet<string>;
  readonly modelName: string;
  readonly gracefulStop: GracefulStopMiddleware;
  readonly artifactStorage: ArtifactStorage;
  readonly provisionResults: readonly ProvisionResult[];
  readonly approvalPolicies: ReadonlyMap<string, MergedToolPolicy>;
  readonly toolServerMap: ReadonlyMap<string, string>;
  readonly autoApproveAll: boolean;
  readonly hasStructuredOutput: boolean;
  readonly streamVersion: "v2" | "v3";
  /** Race-free before/after captures from the wrapped FilesystemBackend. */
  readonly fileChangeBuffer: FileChangeCaptureBuffer;
}

export interface SetupDependencies {
  config: Config;
  client: StigmerClient;
  executionId: string;
  threadId: string;
}

/**
 * Execute all setup phases and return resources for the streaming phase.
 *
 * On failure, partial resources (MCP connections, workspace backend) are
 * cleaned up internally before re-throwing.
 */
export async function performSetup(deps: SetupDependencies): Promise<SetupResult> {
  const { config, client, executionId, threadId } = deps;
  let mcpConnection: McpConnectionResult | null = null;

  try {
    // Step 1: Hydrate execution
    await reportSetupProgress(client, executionId, "Fetching execution…");
    const execution = await client.getExecution(executionId);
    console.log(`[setup] Execution fetched: agent_id=${execution.spec?.agentId}`);

    // Step 2: Resolve chain — execution → session → agentInstance → agent
    await reportSetupProgress(client, executionId, "Resolving agent…");
    const sessionId = execution.spec!.sessionId;
    if (!sessionId) {
      throw new Error(
        `Session ID is required for execution ${executionId}. ` +
        "Execution must have a valid session_id.",
      );
    }

    const session = await client.getSession(sessionId);
    const agentInstance = await client.getAgentInstance(session.spec!.agentInstanceId);
    const agent = await client.getAgent(agentInstance.spec!.agentId);

    const instructions = agent.spec!.instructions || "You are a helpful AI assistant.";
    console.log(
      `[setup] Chain resolved: session=${sessionId}, ` +
      `agent=${agent.metadata!.name}`,
    );

    // Step 3: Resolve model
    const modelName = execution.spec!.executionConfig?.modelName
      || await getDefaultModel();

    // Step 4: Create checkpointer
    const checkpointer = await createCheckpointer({
      type: config.checkpointerType,
      proxyEndpoint: config.checkpointerProxyEndpoint ?? undefined,
      authToken: config.stigmerToken ?? undefined,
    });

    // Step 5: Resolve environment
    await reportSetupProgress(client, executionId, "Resolving environment…");
    const envResult: EnvironmentResult = await resolveEnvironment(client, executionId);

    // Step 6: Create artifact storage
    const artifactStorageConfig = loadArtifactStorageConfig(config);
    const artifactStorage = createArtifactStorage(artifactStorageConfig);

    // Step 7: Provision workspace
    await reportSetupProgress(client, executionId, "Initializing workspace…");
    const { workspaceBackend, provisionResults } = await provisionWorkspace(
      config,
      session,
      envResult.mergedEnvVars,
      sessionId,
    );

    // Step 7: Resolve and connect MCP servers
    const mcpServerUsages = [
      ...(agent.spec!.mcpServerUsages || []),
      ...(session.spec!.mcpServerUsages || []),
    ];

    let resolvedMcpServers: Awaited<ReturnType<typeof resolveMcpServers>> | null = null;
    if (mcpServerUsages.length > 0) {
      await reportSetupProgress(client, executionId, "Connecting tools…");
      resolvedMcpServers = await resolveMcpServers(
        client, mcpServerUsages, envResult.mergedEnvVars,
      );

      const sessionOrg = session.metadata?.org ?? "";
      const backfilledServers = await backfillMcpServersIfNeeded(
        client,
        resolvedMcpServers.resolvedServers,
        mcpServerUsages,
        envResult.mergedEnvVars,
        sessionOrg,
        undefined,
        envResult.secretKeys,
      );
      resolvedMcpServers = { resolvedServers: backfilledServers };

      mcpConnection = await connectMcpServers(
        resolvedMcpServers.resolvedServers,
        { isCloudMode: config.cloudModeEnabled },
      );
    }

    // Step 7b: Resolve and write skills
    const skillRefs = mergeSkillRefs(
      agent.spec!.skillRefs || [],
      session.spec!.skillRefs || [],
    );

    let skillsPromptSection = "";
    if (skillRefs.length > 0) {
      await reportSetupProgress(client, executionId, "Loading skills…");
      const skills = await fetchSkillsByRefs(client, skillRefs);

      if (skills.length > 0) {
        const artifacts = await fetchSkillArtifacts(client, skills);
        const { paths: skillPaths } = await writeSkills(skills, workspaceBackend, artifacts);

        const userMessage = execution.spec!.message || "";
        const skillNames = skills.map(s => s.spec?.name || s.metadata?.slug || "unknown");
        const skillDescriptions = skills.map(s => s.spec?.description || "");

        if (skills.length >= SKILL_COUNT_THRESHOLD) {
          const filterResult = filterSkills(userMessage, skillNames, skillDescriptions);
          if (filterResult.excludedNames.length > 0) {
            const includedSkills = filterResult.includedIndices.map(i => skills[i]);
            console.log(
              `[setup] Skill relevance filter: ${includedSkills.length} included, ` +
              `${filterResult.excludedNames.length} excluded: ${filterResult.excludedNames.join(", ")}`,
            );
            skillsPromptSection =
              generatePromptSection(includedSkills, skillPaths) +
              generateAlsoAvailableSection(filterResult.excludedNames);
          } else {
            skillsPromptSection = generatePromptSection(skills, skillPaths);
          }
        } else {
          skillsPromptSection = generatePromptSection(skills, skillPaths);
        }

        console.log(
          `[setup] Skills loaded: ${skills.length} total, prompt section ${skillsPromptSection.length} chars`,
        );
      }
    }

    // Step 7c: Inject attachments
    const attachments = execution.spec!.attachments || [];
    const injectedFiles = await injectAttachments({
      backend: workspaceBackend,
      attachments,
      storage: artifactStorage,
      isLocalMode: config.mode === "local",
    });

    // Step 8: Build enhanced system prompt
    const systemPrompt = buildEnhancedSystemPrompt({
      instructions,
      provisionResults,
      containerRoot: workspaceBackend.rootDir,
      skillsPromptSection,
      workspaceFileRefs: execution.spec!.workspaceFileRefs || [],
      workspaceRoot: workspaceBackend.rootDir,
      injectedFiles,
    });

    // Step 9: Construct the LLM model
    const model = constructModel(modelName, config, executionId);

    // Step 10: Build middleware stack
    await ensurePricingLoaded();
    const pricing = getModelPricing(modelName);
    const execConfig = execution.spec!.executionConfig;

    const toolServerMap = new Map<string, string>();
    if (mcpConnection) {
      for (const [serverName, serverTools] of Object.entries(mcpConnection.serverToolMap)) {
        for (const t of serverTools) {
          toolServerMap.set(t.name, serverName);
        }
      }
    }

    // Step 10b: Resolve approval policies
    //
    // Effective auto-approve is true when EITHER the execution was pre-armed via
    // spec.auto_approve_all (CLI --auto-approve, API, CI/CD) OR a user chose
    // APPROVE_ALL ("approve and don't ask again") at some gate earlier in this
    // run. In both cases the gate is disabled for the rest of the execution, and
    // the value propagates to mergeApprovalPolicies and (below) to sub-agents so
    // they inherit it. See the ApprovalAction doc in enum.proto.
    const autoApproveAll =
      (execution.spec!.autoApproveAll ?? false) || hasApproveAllDecision(execution);
    const agentOverrides = agent.spec!.mcpServerUsages?.flatMap(
      u => u.toolApprovalOverrides ?? [],
    ) ?? [];
    const approvalPolicies = mergeApprovalPolicies(
      resolvedMcpServers?.resolvedServers ?? [],
      agentOverrides,
      autoApproveAll,
    );

    const maxCostUsd = execConfig?.maxCostUsd ?? 0;
    const { middleware, gracefulStop, costCap: costCapMiddleware } = buildMiddlewareStack({
      loopDetection: {
        historySize: 20,
        consecutiveThreshold: 7,
        totalThreshold: 20,
      },
      executionBudget: {
        recursionLimit: execConfig?.maxToolRounds
          ? execConfig.maxToolRounds * 6
          : 6000,
        warningPct: 80,
      },
      toolTruncation: {
        maxChars: execConfig?.maxToolResultChars || 30_000,
      },
      costCap: maxCostUsd > 0 ? {
        maxCostUsd,
        inputPricePerMillion: pricing.inputPricePerMillion,
        outputPricePerMillion: pricing.outputPricePerMillion,
        cacheReadPricePerMillion: pricing.cacheReadPricePerMillion,
        warningPct: 80,
      } : null,
      otelSpans: { toolServerMap },
      approvalGate: !autoApproveAll ? {
        policies: approvalPolicies,
        autoApproveAll,
        toolServerMap,
      } : null,
    });

    // Step 11: Build tools list (MCP tools + think tool)
    const tools = [
      ...(mcpConnection?.tools as DynamicStructuredTool[] ?? []),
      createThinkTool(),
    ];

    // Step 11b: Transform and compile subagents
    const subAgentProtos = agent.spec!.subAgents || [];
    let compiledSubagents: Awaited<ReturnType<typeof transformAndCompileSubagents>> | undefined;

    if (subAgentProtos.length > 0 || workspaceBackend.rootDir) {
      await reportSetupProgress(client, executionId, "Configuring sub-agents…");

      const parentMcpServerToolMap = new Map<string, DynamicStructuredTool[]>();
      if (mcpConnection) {
        for (const [serverName, serverTools] of Object.entries(mcpConnection.serverToolMap)) {
          parentMcpServerToolMap.set(serverName, serverTools as DynamicStructuredTool[]);
        }
      }

      compiledSubagents = await transformAndCompileSubagents({
        subAgents: subAgentProtos,
        parentMcpTools: mcpConnection?.tools as DynamicStructuredTool[] ?? [],
        parentMcpServerToolMap,
        parentMcpUsages: mcpServerUsages,
        skillClient: client,
        workspaceBackend,
        approvalPolicies,
        autoApproveAll,
        parentModelName: modelName,
        parentHasNativeThinking: _modelHasNativeThinking(modelName),
        costCap: costCapMiddleware ?? undefined,
        modelFactory: (m: string) => constructModel(m, config, executionId),
      });
    }

    // Step 12: Create the agent graph with middleware
    await reportSetupProgress(client, executionId, "Creating agent…");

    const outputSchema = execution.spec!.executionConfig?.structuredOutputSchema;
    let responseFormat: z.ZodType | undefined;
    if (outputSchema) {
      responseFormat = jsonSchemaToZod(outputSchema as unknown as Record<string, unknown>);
    }

    // Plan mode is read-only. Deny every filesystem write operation at the tool
    // level so write_file/edit_file/etc. cannot mutate the workspace — enforcing
    // the InteractionMode.PLAN contract by construction, not by prompt. Rules are
    // first-match-wins with a permissive default, so a single deny-all-writes
    // rule is sufficient. (The Cursor harness enforces plan mode via its prompt
    // prefix; the native harness enforces it here.)
    const isPlanMode = execConfig?.interactionMode === InteractionMode.PLAN;
    const planModePermissions: FilesystemPermission[] = [
      { operations: ["write"], paths: ["/**"], mode: "deny" },
    ];

    // Capture before/after of every file mutation at the source. The buffer is
    // drained at tool-finished by the FileChangeCoordinator (see index.ts), so
    // the wrapped backend is the single race-free capture point for both stream
    // versions, which share this backend.
    const fileChangeBuffer = new FileChangeCaptureBuffer();
    const agentGraph = await createDeepAgent({
      model,
      checkpointer: checkpointer as any,
      backend: new CapturingFilesystemBackend(
        { rootDir: workspaceBackend.rootDir },
        { buffer: fileChangeBuffer, reader: workspaceBackend },
      ),
      systemPrompt,
      tools,
      middleware: middleware as any,
      subagents: compiledSubagents ?? undefined,
      ...(responseFormat ? { responseFormat } : {}),
      ...(isPlanMode ? { permissions: planModePermissions } : {}),
    } as Parameters<typeof createDeepAgent>[0]);

    // Step 11: Prepare invocation input and config
    let userMessage = execution.spec!.message;
    if (outputSchema) {
      userMessage += `\n\n---\nIMPORTANT: When your analysis is complete, provide your findings as structured output matching the required schema. The system will capture your structured response automatically.`;
    }
    const langgraphInput = {
      messages: [{ role: "user", content: userMessage }],
    };

    const langgraphConfig: Record<string, unknown> = {
      configurable: { thread_id: threadId },
    };

    const streamVersion: "v2" | "v3" =
      process.env.LANGGRAPH_STREAM_EVENTS_VERSION === "v2" ? "v2" : "v3";

    console.log(
      `[setup] Complete: model=${modelName}, ` +
      `tools=${tools.length}, middleware=${middleware.length}, ` +
      `thread_id=${threadId}, streamVersion=${streamVersion}`,
    );

    return {
      agentGraph,
      langgraphConfig,
      langgraphInput,
      execution,
      agent,
      session,
      workspaceBackend,
      mcpConnection,
      mergedEnvVars: envResult.mergedEnvVars,
      secretKeys: envResult.secretKeys,
      modelName,
      gracefulStop,
      artifactStorage,
      provisionResults,
      approvalPolicies,
      toolServerMap,
      autoApproveAll,
      hasStructuredOutput: !!outputSchema,
      streamVersion,
      fileChangeBuffer,
    };
  } catch (err) {
    if (mcpConnection) {
      try { await mcpConnection.client.close(); } catch { /* swallow */ }
    }
    throw err;
  }
}

/**
 * Construct the appropriate chat model for the given model name.
 *
 * Provider inference uses name prefix heuristics (claude → Anthropic,
 * gpt/o1/o3/o4 → OpenAI). In proxy mode, requests route through the
 * stigmer-cloud LlmProxyController at provider-specific paths.
 */
function constructModel(
  modelName: string,
  config: Config,
  executionId?: string,
): BaseChatModel {
  const provider = inferProvider(modelName);
  const apiModelId = stripProviderPrefix(modelName);

  const baseUrl = config.proxyEndpoint
    ? resolveProxyBaseUrl(config.proxyEndpoint, provider)
    : undefined;

  const headers = config.proxyEndpoint && config.stigmerToken
    ? buildProxyHeaders(config.stigmerToken, { executionId })
    : undefined;

  switch (provider) {
    case "anthropic":
      return buildAnthropicModel(apiModelId, baseUrl, headers, config);
    case "openai":
      return buildOpenAIModel(apiModelId, baseUrl, headers, config);
  }
}

function buildAnthropicModel(
  model: string,
  baseUrl: string | undefined,
  headers: Record<string, string> | undefined,
  config: Config,
): BaseChatModel {
  const apiKey = config.proxyEndpoint
    ? (config.stigmerToken ?? "proxy-managed")
    : (process.env.ANTHROPIC_API_KEY ?? "");

  const requestTimeoutMs = parseInt(process.env.STIGMER_LLM_REQUEST_TIMEOUT_MS ?? "0") || undefined;

  return new ChatAnthropic({
    model,
    apiKey,
    temperature: 0,
    ...(requestTimeoutMs ? { maxRetries: 0, timeout: requestTimeoutMs } : {}),
    ...(baseUrl || headers
      ? {
          clientOptions: {
            ...(baseUrl ? { baseURL: baseUrl } : {}),
            ...(headers ? { defaultHeaders: headers } : {}),
          },
        }
      : {}),
  });
}

function buildOpenAIModel(
  model: string,
  baseUrl: string | undefined,
  headers: Record<string, string> | undefined,
  config: Config,
): BaseChatModel {
  const apiKey = config.proxyEndpoint
    ? (config.stigmerToken ?? "proxy-managed")
    : (process.env.OPENAI_API_KEY ?? "");

  const requestTimeoutMs = parseInt(process.env.STIGMER_LLM_REQUEST_TIMEOUT_MS ?? "0") || undefined;

  return new ChatOpenAI({
    model,
    apiKey,
    temperature: 0,
    ...(requestTimeoutMs ? { maxRetries: 0, timeout: requestTimeoutMs } : {}),
    ...(baseUrl || headers
      ? {
          configuration: {
            ...(baseUrl ? { baseURL: baseUrl } : {}),
            ...(headers ? { defaultHeaders: headers } : {}),
          },
        }
      : {}),
  });
}

/**
 * Provision workspace from session workspace entries.
 */
async function provisionWorkspace(
  config: Config,
  session: Session,
  mergedEnvVars: Record<string, string>,
  sessionId: string,
): Promise<{ workspaceBackend: WorkspaceBackend; provisionResults: ProvisionResult[] }> {
  const platformDir = await ensurePlatformDir(sessionId);
  const workspaceBackend = new LocalWorkspaceBackend(config.workspaceRootDir, platformDir);

  const workspaceEntries = session.spec!.workspaceEntries || [];
  if (workspaceEntries.length === 0) {
    return { workspaceBackend, provisionResults: [] };
  }

  const provisioner = new WorkspaceProvisioner();
  const provisionResults = await provisioner.provisionAll(
    workspaceEntries.map(entry => ({
      name: entry.name,
      source: entry.source,
    })),
    workspaceBackend,
    mergedEnvVars,
    config.mode === "local",
    config.mode !== "local",
  );

  // If single entry changed root dir, create a new backend with the same platformDir
  if (
    provisionResults.length === 1 &&
    provisionResults[0].rootDir !== workspaceBackend.rootDir
  ) {
    return {
      workspaceBackend: new LocalWorkspaceBackend(provisionResults[0].rootDir, platformDir),
      provisionResults,
    };
  }

  return { workspaceBackend, provisionResults };
}

// Shared JSON Schema → Zod converter (consolidated from 3 duplicate copies).
import { jsonSchemaToZod } from "../../shared/json-schema-to-zod.js";

/**
 * Heuristic check for native extended thinking support.
 * Models with thinking support don't need the explicit think tool.
 */
function _modelHasNativeThinking(modelId: string): boolean {
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
