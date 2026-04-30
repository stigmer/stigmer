/**
 * ExecuteCursor Temporal activity — the core of the cursor-runner service.
 *
 * Implements the same Slim-Payload Pattern as ExecuteGraphton:
 * - Receives only executionId + threadId (Cursor agentId)
 * - Hydrates execution from DB via gRPC
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

import { type Context, heartbeat } from "@temporalio/activity";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb.js";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb.js";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb.js";
import { SetupProgressSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb.js";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb.js";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb.js";
import { ExecutionPhase, MessageType, ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb.js";
import type { SDKMessage } from "@cursor/sdk";

import type { Config } from "../config.js";
import { StigmerClient } from "../client/stigmer-client.js";
import { resolveAgent } from "../adapter/session-lifecycle.js";
import { translateEvent, extractDeniedToolCalls, utcTimestamp } from "../adapter/message-translator.js";
import { UsageTracker } from "../adapter/usage-tracker.js";
import { toCursorMcpConfig } from "../adapter/mcp-resolver.js";
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
    ExecuteCursor: async (executionId: string, threadId: string): Promise<AgentExecutionStatus> => {
      return executeCursor(config, client, executionId, threadId);
    },
  };
}

async function executeCursor(
  config: Config,
  client: StigmerClient,
  executionId: string,
  threadId: string,
): Promise<AgentExecutionStatus> {
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

    // Phase 2: Load session for MCP and workspace config
    await reportSetupProgress(client, executionId, "Loading session");
    const session = await client.getSession(sessionId);
    const sessionSpec = session.spec!;

    // Phase 3: Check if this is a reinvocation after approval
    const isReinvocation = !!threadId;
    let approvalDecisions: Map<string, ApprovalAction> | undefined;

    if (isReinvocation) {
      const existingStatus = execution.status;
      if (existingStatus?.pendingApprovals?.length) {
        approvalDecisions = new Map();
        for (const pa of existingStatus.pendingApprovals) {
          const matchingTc = findToolCallByIdInMessages(existingStatus.messages, pa.toolCallId);
          if (matchingTc?.approvalAction && matchingTc.approvalAction !== ApprovalAction.APPROVAL_ACTION_UNSPECIFIED) {
            approvalDecisions.set(pa.toolCallId, matchingTc.approvalAction);
          }
        }

        const hasReject = [...approvalDecisions.values()].some(
          (a) => a === ApprovalAction.APPROVAL_ACTION_REJECT,
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

    // Phase 4: Resolve Cursor Agent (create or resume)
    await reportSetupProgress(client, executionId, "Initializing Cursor agent");
    heartbeat();

    const mcpConfig = toCursorMcpConfig([]); // TODO: resolve MCP servers from session usages
    const { agent, isNew } = await resolveAgent(threadId, {
      apiKey: config.cursorApiKey,
      model: spec.executionConfig?.modelName || "composer-2",
      workspaceCwd: config.workspaceRootDir,
      mcpServers: mcpConfig,
    });

    // Phase 5: Write hooks for HITL
    const approvalState = buildApprovalState(approvalDecisions);
    await writeHooksToWorkspace(config.workspaceRootDir, approvalState);

    // Phase 6: Store new agentId as thread_id if this is a new agent
    if (isNew && agent.agentId) {
      try {
        sessionSpec.threadId = agent.agentId;
        await client.updateSession(session);
        console.log(`Stored Cursor agentId=${agent.agentId} as thread_id on session ${sessionId}`);
      } catch (err) {
        console.warn("Failed to persist thread_id on session (non-fatal):", err);
      }
    }

    // Phase 7: Build the prompt
    const prompt = buildPrompt(spec.message, isReinvocation, approvalDecisions);

    // Phase 8: Send message and stream events
    status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;
    const usageTracker = new UsageTracker(spec.executionConfig?.modelName || "composer-2");
    const collectedEvents: SDKMessage[] = [];

    const run = await agent.send(prompt, {
      onDelta: ({ update }) => {
        if (update.type === "turn-ended" && update.usage) {
          usageTracker.recordTurn({
            inputTokens: update.usage.inputTokens,
            outputTokens: update.usage.outputTokens,
            cacheReadTokens: update.usage.cacheReadTokens,
            cacheWriteTokens: update.usage.cacheWriteTokens,
          });
        }
        heartbeat();
      },
    });

    for await (const event of run.stream()) {
      collectedEvents.push(event);
      const messages = translateEvent(event);
      status.messages.push(...messages);

      if (status.messages.length % 5 === 0) {
        await persistStatus(client, executionId, status);
        heartbeat();
      }
    }

    // Phase 9: Check for denied tool calls (HITL)
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

    // Phase 10: Map final result
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
 * Build the prompt to send to the Cursor Agent.
 *
 * On first invocation: the user's message from the execution spec.
 * On reinvocation after approval: a structured message telling the agent
 * which tools were approved/skipped so it can proceed.
 */
function buildPrompt(
  userMessage: string,
  isReinvocation: boolean,
  approvalDecisions?: Map<string, ApprovalAction>,
): string {
  if (!isReinvocation || !approvalDecisions?.size) {
    return userMessage;
  }

  const approved: string[] = [];
  const skipped: string[] = [];

  for (const [toolCallId, action] of approvalDecisions) {
    if (action === ApprovalAction.APPROVAL_ACTION_APPROVE) {
      approved.push(toolCallId);
    } else if (action === ApprovalAction.APPROVAL_ACTION_SKIP) {
      skipped.push(toolCallId);
    }
  }

  const parts: string[] = [];
  if (approved.length) {
    parts.push(
      `The user has approved the following tool calls. Please execute them now: ${approved.join(", ")}.`,
    );
  }
  if (skipped.length) {
    parts.push(
      `The user has skipped the following tool calls. Do not execute them and continue without them: ${skipped.join(", ")}.`,
    );
  }

  return parts.join("\n\n");
}

/**
 * Return a slim status containing only workflow-critical fields.
 * Heavy fields (messages, tool_calls) are already persisted via gRPC.
 */
function slimStatus(full: AgentExecutionStatus): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {
    phase: full.phase,
    error: full.error,
    startedAt: full.startedAt,
    completedAt: full.completedAt,
    pendingApprovals: full.pendingApprovals,
  });
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
