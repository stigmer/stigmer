/**
 * Execution setup pipeline for the deep agent activity.
 *
 * Hydrates the execution from the database, resolves the full resource
 * chain (session -> agentInstance -> agent), provisions workspace, loads
 * MCP servers / environment, creates the LangGraph agent graph with the
 * full middleware stack, and returns a SetupResult containing everything
 * the streaming phase needs.
 */

import { createDeepAgent, StateBackend } from "deepagents";
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
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
import { WorkspaceProvisioner } from "../../shared/workspace/provisioner.js";
import { LocalWorkspaceBackend } from "../../shared/workspace/local-backend.js";
import type { WorkspaceBackend, ProvisionResult } from "../../shared/workspace/types.js";
import { buildWorkspaceFileTree } from "../../shared/workspace/file-tree.js";
import { reportSetupProgress } from "../../shared/status.js";
import { resolveEnvironment, type EnvironmentResult } from "./environment.js";
import { buildEnhancedSystemPrompt } from "./prompt-builder.js";
import { buildMiddlewareStack, createThinkTool } from "../../middleware/index.js";
import type { GracefulStopMiddleware } from "../../middleware/index.js";
import { getModelPricing, ensureLoaded as ensurePricingLoaded } from "../../shared/model-pricing.js";
import {
  loadArtifactStorageConfig,
  createArtifactStorage,
  type ArtifactStorage,
} from "../../shared/artifact-storage.js";

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
      || "claude-sonnet-4-20250514";

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
    );

    // Step 7: Resolve and connect MCP servers
    const mcpServerUsages = [
      ...(agent.spec!.mcpServerUsages || []),
      ...(session.spec!.mcpServerUsages || []),
    ];

    if (mcpServerUsages.length > 0) {
      await reportSetupProgress(client, executionId, "Connecting tools…");
      const resolved = await resolveMcpServers(
        client, mcpServerUsages, envResult.mergedEnvVars,
      );
      mcpConnection = await connectMcpServers(
        resolved.resolvedServers,
        { isCloudMode: config.cloudModeEnabled },
      );
    }

    // Step 8: Build enhanced system prompt
    const systemPrompt = buildEnhancedSystemPrompt({
      instructions,
      provisionResults,
      containerRoot: workspaceBackend.rootDir,
      skillsPromptSection: "",
      workspaceFileRefs: execution.spec!.workspaceFileRefs || [],
      workspaceRoot: workspaceBackend.rootDir,
      injectedFiles: [],
    });

    // Step 9: Construct the LLM model
    const model = constructModel(modelName, config);

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

    const maxCostUsd = execConfig?.maxCostUsd ?? 0;
    const { middleware, gracefulStop } = buildMiddlewareStack({
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
    });

    // Step 11: Build tools list (MCP tools + think tool)
    const tools = [
      ...(mcpConnection?.tools as DynamicStructuredTool[] ?? []),
      createThinkTool(),
    ];

    // Step 12: Create the agent graph with middleware
    await reportSetupProgress(client, executionId, "Creating agent…");
    const agentGraph = await createDeepAgent({
      model,
      checkpointer: checkpointer as any,
      backend: new StateBackend(),
      systemPrompt,
      tools,
      middleware: middleware as any,
    });

    // Step 11: Prepare invocation input and config
    const userMessage = execution.spec!.message;
    const langgraphInput = {
      messages: [{ role: "user", content: userMessage }],
    };

    const langgraphConfig: Record<string, unknown> = {
      configurable: { thread_id: threadId },
    };

    console.log(
      `[setup] Complete: model=${modelName}, ` +
      `tools=${tools.length}, middleware=${middleware.length}, ` +
      `thread_id=${threadId}`,
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
    };
  } catch (err) {
    if (mcpConnection) {
      try { await mcpConnection.client.close(); } catch { /* swallow */ }
    }
    throw err;
  }
}

/**
 * Construct the appropriate chat model with proxy routing.
 *
 * Uses pre-constructed BaseChatModel with explicit baseURL for proxy
 * routing control rather than relying on a global fetch interceptor.
 */
function constructModel(modelName: string, config: Config): BaseChatModel {
  const baseUrl = config.proxyEndpoint ?? undefined;
  const apiKey = config.proxyEndpoint
    ? (config.stigmerToken ?? "proxy-managed")
    : (process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "");

  if (modelName.startsWith("gpt") || modelName.startsWith("o1") || modelName.startsWith("o3")) {
    throw new Error(
      `OpenAI model '${modelName}' requested but @langchain/openai is not ` +
      `configured in Phase 3a. Multi-provider support is deferred to Phase 4.`,
    );
  }

  return new ChatAnthropic({
    model: modelName,
    apiKey,
    ...(baseUrl ? { clientOptions: { baseURL: baseUrl } } : {}),
    temperature: 0,
  });
}

/**
 * Provision workspace from session workspace entries.
 */
async function provisionWorkspace(
  config: Config,
  session: Session,
  mergedEnvVars: Record<string, string>,
): Promise<{ workspaceBackend: WorkspaceBackend; provisionResults: ProvisionResult[] }> {
  const workspaceBackend = new LocalWorkspaceBackend(config.workspaceRootDir);

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
  );

  // If single entry changed root dir, create a new backend
  if (
    provisionResults.length === 1 &&
    provisionResults[0].rootDir !== workspaceBackend.rootDir
  ) {
    return {
      workspaceBackend: new LocalWorkspaceBackend(provisionResults[0].rootDir),
      provisionResults,
    };
  }

  return { workspaceBackend, provisionResults };
}
