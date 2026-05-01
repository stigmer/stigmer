/**
 * ExecuteCursor Temporal activity — the core of the cursor-runner service.
 *
 * Implements the same Slim-Payload Pattern as ExecuteGraphton:
 * - Receives only executionId + threadId (Cursor agentId)
 * - Hydrates execution from DB via gRPC
 * - Resolves full agent blueprint (instructions, MCP servers, skills, sub-agents)
 * - Runs the Cursor agent, streams events, reports status
 * - Returns slim AgentExecutionStatus to workflow
 *
 * Durable HITL Model:
 * When a tool requires approval, the preToolUse hook denies it. The activity
 * captures the denied tool details, reports WAITING_FOR_APPROVAL, and RETURNS
 * to the workflow. The workflow waits for the approvalGateResolved signal,
 * then reinvokes this activity. On reinvocation, the activity resumes the
 * Cursor Agent and prompts it to execute the approved tool.
 *
 * This is identical to the LangGraph flow from the workflow's perspective.
 */

import { heartbeat } from "@temporalio/activity";
import { create, toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { SetupProgressSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionPhase, MessageType, ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { LlmCallMetrics } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import type { SDKMessage } from "@cursor/sdk";

import type { Config } from "../config.js";
import { StigmerClient } from "../client/stigmer-client.js";
import { resolveAgent } from "../adapter/session-lifecycle.js";
import { translateEvent, extractDeniedToolCalls, utcTimestamp } from "../adapter/message-translator.js";
import { UsageTracker } from "../adapter/usage-tracker.js";
import { resolveMcpServers } from "../adapter/mcp-resolver.js";
import { resolveBlueprint } from "../adapter/blueprint-resolver.js";
import { resolveSkills } from "../adapter/skill-resolver.js";
import { resolveAttachments } from "../adapter/attachment-resolver.js";
import { buildEnhancedPrompt, buildReinvocationPrompt } from "../adapter/prompt-builder.js";
import { writeHooksToWorkspace } from "../hitl/workspace-setup.js";
import { buildApprovalState } from "../hitl/approval-state.js";

/**
 * Creates the activity functions bound to the runner config.
 * Returned object is passed to Temporal Worker.create({ activities }).
 */
export function createActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
  });

  return {
    ExecuteCursor: async (executionId: string, threadId: string): Promise<unknown> => {
      return executeCursor(config, client, executionId, threadId);
    },
  };
}

async function executeCursor(
  config: Config,
  client: StigmerClient,
  executionId: string,
  threadId: string,
): Promise<unknown> {
  console.log(`ExecuteCursor started: execution=${executionId}, threadId=${threadId || "(new)"}`);

  const status = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    startedAt: utcTimestamp(),
  });

  try {
    // Phase 1: Hydrate execution from DB
    await reportSetupProgress(client, executionId, "Fetching execution");
    const execution = await client.getExecution(executionId);
    const spec = execution.spec!;
    const sessionId = spec.sessionId;

    // Phase 2: Load session and resolve full agent blueprint
    await reportSetupProgress(client, executionId, "Resolving agent blueprint");
    const session = await client.getSession(sessionId);
    const blueprint = await resolveBlueprint(client, session, config.workspaceRootDir);
    heartbeat();

    // Phase 3: Check if this is a reinvocation after approval
    const isReinvocation = !!threadId;
    let approvalDecisions: Map<string, ApprovalAction> | undefined;

    if (isReinvocation) {
      const existingStatus = execution.status;
      if (existingStatus?.pendingApprovals?.length) {
        approvalDecisions = new Map();
        for (const pa of existingStatus.pendingApprovals) {
          const matchingTc = findToolCallByIdInMessages(existingStatus.messages, pa.toolCallId);
          if (matchingTc?.approvalAction) {
            approvalDecisions.set(pa.toolCallId, matchingTc.approvalAction);
          }
        }

        const hasReject = [...approvalDecisions.values()].some(
          (a) => a === ApprovalAction.REJECT,
        );
        if (hasReject) {
          status.phase = ExecutionPhase.EXECUTION_FAILED;
          status.error = "Execution rejected by user";
          status.completedAt = utcTimestamp();
          status.messages.push(create(AgentMessageSchema, {
            type: MessageType.MESSAGE_SYSTEM,
            content: "Execution was rejected by the user during tool approval.",
            timestamp: utcTimestamp(),
          }));
          await persistStatus(client, executionId, status);
          return slimStatus(status);
        }
      }
    }

    // Phase 4: Resolve MCP servers (merged from agent + session)
    await reportSetupProgress(client, executionId, "Resolving MCP servers");
    const mcpConfig = await resolveMcpServers(client, blueprint.mergedMcpServerUsages);
    heartbeat();

    // Phase 5: Resolve skills (merged from agent + session)
    await reportSetupProgress(client, executionId, "Resolving skills");
    const primaryWorkspaceDir = blueprint.workspaceDirs[0];
    const skillMetadata = await resolveSkills(client, blueprint.mergedSkillRefs, {
      sessionId,
      primaryWorkspaceDir,
    });
    heartbeat();

    // Phase 5b: Resolve attachments
    const attachmentResults = await resolveAttachments(
      spec.attachments,
      sessionId,
      primaryWorkspaceDir,
      config.mode,
    );
    const attachmentPaths = attachmentResults.map((a) => a.relativePath);

    // Phase 6: Resolve Cursor Agent (create or resume)
    await reportSetupProgress(client, executionId, "Initializing Cursor agent");
    const { agent, isNew } = await resolveAgent(threadId, {
      apiKey: config.cursorApiKey,
      model: spec.executionConfig?.modelName || "composer-2",
      workspaceDirs: blueprint.workspaceDirs,
      mcpServers: mcpConfig,
    });

    // Phase 7: Write hooks for HITL
    const approvalState = buildApprovalState(approvalDecisions);
    await writeHooksToWorkspace(primaryWorkspaceDir, approvalState);

    // Phase 8: Store new agentId as thread_id if this is a new agent
    if (isNew && agent.agentId) {
      try {
        blueprint.sessionSpec.threadId = agent.agentId;
        await client.updateSession(blueprint.session);
        console.log(`Stored Cursor agentId=${agent.agentId} as thread_id on session ${sessionId}`);
      } catch (err) {
        console.warn("Failed to persist thread_id on session (non-fatal):", err);
      }
    }

    // Phase 9: Build the prompt
    let prompt: string;
    if (isReinvocation && approvalDecisions?.size) {
      prompt = buildReinvocationPrompt(approvalDecisions);
    } else {
      prompt = buildEnhancedPrompt({
        instructions: blueprint.instructions,
        userMessage: spec.message,
        skills: skillMetadata,
        subAgents: blueprint.subAgents,
        workspaceDirs: blueprint.workspaceDirs,
        workspaceFileRefs: spec.workspaceFileRefs ?? [],
        attachmentPaths,
      });
    }

    // Phase 10: Send message and stream events
    status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;
    const modelName = spec.executionConfig?.modelName || "composer-2";
    const usageTracker = new UsageTracker(modelName);
    const collectedEvents: SDKMessage[] = [];

    const pendingMetrics: LlmCallMetrics[] = [];

    const run = await agent.send(prompt, {
      onDelta: ({ update }) => {
        if (update.type === "turn-ended" && update.usage) {
          const metrics = usageTracker.recordTurn({
            inputTokens: update.usage.inputTokens,
            outputTokens: update.usage.outputTokens,
            cacheReadTokens: update.usage.cacheReadTokens,
            cacheWriteTokens: update.usage.cacheWriteTokens,
          });
          pendingMetrics.push(metrics);
        }
        heartbeat();
      },
    });

    for await (const event of run.stream()) {
      collectedEvents.push(event);
      const messages = translateEvent(event);
      status.messages.push(...messages);

      while (pendingMetrics.length > 0) {
        const metrics = pendingMetrics.shift()!;
        stampMetricsOnLastAiMessage(status.messages, metrics);
      }

      if (status.messages.length % 5 === 0) {
        await persistStatus(client, executionId, status);
        heartbeat();
      }
    }

    while (pendingMetrics.length > 0) {
      const metrics = pendingMetrics.shift()!;
      stampMetricsOnLastAiMessage(status.messages, metrics);
    }

    // Phase 11: Check for denied tool calls (HITL)
    const deniedCalls = extractDeniedToolCalls(collectedEvents);
    if (deniedCalls.length > 0) {
      status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;
      status.pendingApprovals = deniedCalls.map((dc) =>
        create(PendingApprovalSchema, {
          toolCallId: dc.callId,
          toolName: dc.name,
          argsPreview: dc.argsPreview,
        }),
      );
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: `Tool approval required for: ${deniedCalls.map((d) => d.name).join(", ")}`,
        timestamp: utcTimestamp(),
      }));
      await persistStatus(client, executionId, status);
      console.log(`ExecuteCursor returning WAITING_FOR_APPROVAL: ${deniedCalls.length} tools pending`);
      return slimStatus(status);
    }

    // Phase 12: Map final result
    const result = await run.wait();
    status.completedAt = utcTimestamp();

    switch (result.status) {
      case "finished":
        status.phase = ExecutionPhase.EXECUTION_COMPLETED;
        break;
      case "error":
        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = result.result ?? "Cursor run failed";
        break;
      case "cancelled":
        status.phase = ExecutionPhase.EXECUTION_CANCELLED;
        break;
      default:
        status.phase = ExecutionPhase.EXECUTION_COMPLETED;
    }

    await persistStatus(client, executionId, status);
    console.log(`ExecuteCursor completed: execution=${executionId}, phase=${ExecutionPhase[status.phase]}`);

    return slimStatus(status);

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errType = err instanceof Error ? err.constructor.name : "Unknown";
    console.error(`ExecuteCursor failed: execution=${executionId}, [${errType}] ${errMsg}`);

    status.phase = ExecutionPhase.EXECUTION_FAILED;
    status.error = `Execution failed: [${errType}] ${errMsg}`;
    status.completedAt = utcTimestamp();
    status.messages.push(
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Internal system error occurred. Please contact support if this issue persists.",
        timestamp: utcTimestamp(),
      }),
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: `Error details: [${errType}] ${errMsg}`,
        timestamp: utcTimestamp(),
      }),
    );

    try {
      await persistStatus(client, executionId, status);
    } catch (persistErr) {
      console.error("Failed to persist error status (best-effort):", persistErr);
    }

    return slimStatus(status);
  }
}

/**
 * Return a slim status containing only workflow-critical fields.
 * Heavy fields (messages, tool_calls) are already persisted via gRPC.
 *
 * Uses toJson() to produce canonical protobuf JSON (base64 bytes, string
 * enums, omitted defaults) instead of returning a raw @bufbuild/protobuf
 * message. Temporal's default JsonPayloadConverter calls JSON.stringify,
 * which serializes Uint8Array bytes fields as {} — invalid protobuf JSON
 * that the Java workflow's JsonFormat.Parser rejects.
 */
function slimStatus(full: AgentExecutionStatus): unknown {
  const slim = create(AgentExecutionStatusSchema, {
    phase: full.phase,
    error: full.error,
    startedAt: full.startedAt,
    completedAt: full.completedAt,
    pendingApprovals: full.pendingApprovals,
  });
  return toJson(AgentExecutionStatusSchema, slim);
}

async function persistStatus(
  client: StigmerClient,
  executionId: string,
  status: AgentExecutionStatus,
): Promise<void> {
  try {
    await client.updateStatus(executionId, status);
  } catch (err) {
    console.error(`Failed to persist status for ${executionId}:`, err);
  }
}

async function reportSetupProgress(
  client: StigmerClient,
  executionId: string,
  phase: string,
): Promise<void> {
  const status = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    setupProgress: create(SetupProgressSchema, { currentPhase: phase }),
  });
  await persistStatus(client, executionId, status);
}

/**
 * Stamp LlmCallMetrics onto the most recent MESSAGE_AI message.
 *
 * Cursor's turn-ended event reports aggregate token usage for the entire
 * turn. The corresponding AI message (the model's text output for that
 * turn) is the natural home for llm_metrics — matching the Python
 * agent-runner's pattern where each on_chat_model_end stamps metrics
 * onto the AI message it produced.
 *
 * If no AI message exists yet (e.g., the turn consisted only of tool
 * calls with no assistant text), we skip silently. The tokens are still
 * logged by UsageTracker for observability.
 */
function stampMetricsOnLastAiMessage(
  messages: AgentMessage[],
  metrics: LlmCallMetrics,
): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === MessageType.MESSAGE_AI && !messages[i].llmMetrics) {
      messages[i].llmMetrics = metrics;
      return;
    }
  }
  console.warn(
    "No unstamped MESSAGE_AI found for turn %d — metrics not attached to a message",
    metrics.sequence,
  );
}

/**
 * Find a tool call by ID in the execution's messages.
 * Used during reinvocation to read approval decisions from the DB.
 */
function findToolCallByIdInMessages(
  messages: AgentMessage[] | undefined,
  toolCallId: string,
) {
  if (!messages) return undefined;
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.id === toolCallId) return tc;
    }
  }
  return undefined;
}
