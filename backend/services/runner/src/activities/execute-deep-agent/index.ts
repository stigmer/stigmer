/**
 * ExecuteDeepAgent activity — runs a Stigmer deep agent via LangGraph.
 *
 * Signature matches ExecuteGraphton (Python): (executionId, threadId) → status.
 * The slim-payload pattern is preserved: input is just IDs, output is a slim
 * AgentExecutionStatus proto.
 *
 * Phase 3b-iii: full middleware stack + artifact storage, inline publishing,
 * incremental git writeback, and post-stream safety net.
 */

import { Context, CancelledFailure } from "@temporalio/activity";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionPhase, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { activityStarted, activityFinished } from "../../idle-watchdog.js";
import { persistStatus, slimStatus, utcTimestamp } from "../../shared/status.js";
import type { Config } from "../../config.js";
import { StigmerClient } from "../../client/stigmer-client.js";
import { performSetup, type SetupResult } from "./setup.js";
import { streamExecution, type StreamResult } from "./streaming.js";
import { loadStreamingConfig } from "./streaming-scheduler.js";
import { StatusBuilder } from "./status-builder.js";
import { InlinePublisher } from "./inline-publisher.js";
import { WriteBackCoordinator } from "./writeback-coordinator.js";
import { processPostStream } from "./post-stream.js";
import { resolveResumeInput } from "./hitl.js";

export function createDeepAgentActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
    tokenRef: config.stigmerTokenRef,
  });

  const streamingConfig = loadStreamingConfig();

  return {
    ExecuteDeepAgent: async (executionId: string, threadId: string): Promise<unknown> => {
      activityStarted();
      let setup: SetupResult | null = null;

      try {
        console.log(`[ExecuteDeepAgent] Started for execution ${executionId}`);

        setup = await performSetup({ config, client, executionId, threadId });

        const initialStatus = create(AgentExecutionStatusSchema, {});
        const statusBuilder = new StatusBuilder(executionId, initialStatus);

        statusBuilder.setApprovalProvider({
          policies: setup.approvalPolicies,
          toolServerMap: setup.toolServerMap,
          autoApproveAll: setup.autoApproveAll,
        });

        const resume = await resolveResumeInput(
          setup.execution,
          setup.agentGraph,
          setup.langgraphConfig,
          setup.execution.spec!.message,
        );

        if (resume.hasRejection) {
          const failedStatus = create(AgentExecutionStatusSchema, {
            phase: ExecutionPhase.EXECUTION_FAILED,
            error: `Execution rejected: ${resume.rejectionReason}`,
            completedAt: utcTimestamp(),
            messages: [
              create(AgentMessageSchema, {
                type: MessageType.MESSAGE_SYSTEM,
                content: `Execution rejected by user: ${resume.rejectionReason}`,
                timestamp: utcTimestamp(),
              }),
            ],
          });
          await persistStatus(client, executionId, failedStatus);
          return slimStatus(failedStatus);
        }

        const effectiveInput = resume.isResumeFromApproval
          ? resume.graphInput
          : setup.langgraphInput;

        const inlinePublisher = new InlinePublisher({
          workspaceBackend: setup.workspaceBackend,
          artifactStorage: setup.artifactStorage,
          statusBuilder,
          executionId,
        });

        const workspaceEntries = setup.session.spec?.workspaceEntries ?? [];
        const writebackCoordinator = setup.provisionResults.length > 0
          ? new WriteBackCoordinator({
              statusBuilder,
              executionId,
              provisionResults: setup.provisionResults,
              workspaceEntries: workspaceEntries as any,
              workspaceBackend: setup.workspaceBackend,
            })
          : null;

        const cancellationSignal = Context.current().cancellationSignal;

        const result: StreamResult = await streamExecution({
          agentGraph: setup.agentGraph,
          langgraphInput: effectiveInput as Record<string, unknown>,
          langgraphConfig: setup.langgraphConfig,
          executionId,
          client,
          initialStatus,
          streamingConfig,
          gracefulStop: setup.gracefulStop,
          inlinePublisher,
          writebackCoordinator: writebackCoordinator ?? undefined,
          heartbeatFn: (details) => Context.current().heartbeat(details),
          isCancelledFn: () => cancellationSignal.aborted,
          approvalProvider: {
            policies: setup.approvalPolicies,
            toolServerMap: setup.toolServerMap,
            autoApproveAll: setup.autoApproveAll,
          },
        });

        await processPostStream({
          status: initialStatus,
          inlinePublisher,
          writebackCoordinator,
          pendingPublishPromises: result.pendingPublishPromises,
          pendingWritebackPromises: result.pendingWritebackPromises,
          executionId,
        });

        if (result.terminalStatus) {
          if (initialStatus.phase === ExecutionPhase.EXECUTION_PAUSED) {
            await persistStatus(client, executionId, initialStatus);
            console.log(`[ExecuteDeepAgent] Paused for execution ${executionId}: events=${result.eventsProcessed}`);
            throw new CancelledFailure("Activity paused by orchestrator");
          }
          return result.terminalStatus;
        }

        if (!setup.autoApproveAll) {
          const graphState = await setup.agentGraph.getState(setup.langgraphConfig);
          const pendingInterrupts = graphState.tasks?.flatMap(
            (task: { id: string; interrupts?: readonly { value: Record<string, unknown>; resumeValue?: unknown }[] }) =>
              (task.interrupts ?? [])
                .filter((intr) => intr.resumeValue === undefined)
                .map((intr) => {
                  const val = intr.value as Record<string, unknown>;
                  return {
                    toolCallId: (val?.tool_call_id as string) ?? "",
                    toolName: (val?.tool_name as string) ?? "",
                    mcpServerSlug: (val?.mcp_server_slug as string) ?? "",
                    message: (val?.message as string) ?? "",
                  };
                }),
          ) ?? [];

          if (pendingInterrupts.length > 0) {
            console.log(
              `[ExecuteDeepAgent] Detected ${pendingInterrupts.length} pending interrupt(s) ` +
              `for execution ${executionId} — setting WAITING_FOR_APPROVAL`,
            );
            initialStatus.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;

            const aiMsg = create(AgentMessageSchema, {
              type: MessageType.MESSAGE_AI,
              content: "",
              timestamp: utcTimestamp(),
              isStreaming: false,
            });
            for (const intr of pendingInterrupts) {
              aiMsg.toolCalls.push(create(ToolCallSchema, {
                id: intr.toolCallId,
                name: intr.toolName,
                status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
                requiresApproval: true,
                approvalMessage: intr.message,
                approvalRequestedAt: utcTimestamp(),
                mcpServerSlug: intr.mcpServerSlug,
                startedAt: utcTimestamp(),
              }));
            }
            initialStatus.messages.push(aiMsg);

            await persistStatus(client, executionId, initialStatus);
            return slimStatus(initialStatus);
          }
        }

        initialStatus.phase = ExecutionPhase.EXECUTION_COMPLETED;
        initialStatus.completedAt = utcTimestamp();

        // Extract structured output from LangGraph state BEFORE persisting,
        // so the subscriber sees COMPLETED + structured_output atomically.
        let structuredOutput: unknown = undefined;
        let finalText: string | undefined;

        if (setup.hasStructuredOutput) {
          try {
            const graphState = await setup.agentGraph.getState(setup.langgraphConfig);
            if (graphState?.values?.structuredResponse !== undefined) {
              structuredOutput = graphState.values.structuredResponse;
              initialStatus.structuredOutput = structuredOutput as JsonObject;
            }
          } catch (err) {
            console.warn(
              `[ExecuteDeepAgent] Failed to extract structured output (non-fatal): ${err}`,
            );
          }
        }

        // Extract final AI message text
        const lastAiMsg = [...initialStatus.messages]
          .reverse()
          .find(m => m.type === MessageType.MESSAGE_AI);
        if (lastAiMsg) {
          finalText = lastAiMsg.content;
        }

        // NOW persist — subscriber sees COMPLETED + structured_output atomically
        await persistStatus(client, executionId, initialStatus);

        console.log(
          `[ExecuteDeepAgent] Completed for execution ${executionId}: ` +
          `events=${result.eventsProcessed}, ` +
          `messages=${initialStatus.messages.length}, ` +
          `artifacts=${initialStatus.artifacts.length}, ` +
          `writebacks=${initialStatus.workspaceWriteBacks.length}, ` +
          `hasStructuredOutput=${structuredOutput !== undefined}`,
        );

        const slim = slimStatus(initialStatus) as Record<string, unknown>;
        if (finalText !== undefined) {
          slim.final_text = finalText;
        }
        if (structuredOutput !== undefined) {
          slim.structured = structuredOutput;
        }
        return slim;

      } catch (err: unknown) {
        if (err instanceof CancelledFailure) {
          console.log(`[ExecuteDeepAgent] Cancelled (pause) for execution ${executionId}`);
          const pausedStatus = create(AgentExecutionStatusSchema, {
            phase: ExecutionPhase.EXECUTION_PAUSED,
          });
          await persistStatus(client, executionId, pausedStatus).catch(() => {});
          throw err;
        }

        if (Context.current().cancellationSignal.aborted) {
          console.log(`[ExecuteDeepAgent] Error during cancellation for ${executionId}, treating as pause: ${err}`);
          const pausedStatus = create(AgentExecutionStatusSchema, {
            phase: ExecutionPhase.EXECUTION_PAUSED,
          });
          await persistStatus(client, executionId, pausedStatus).catch(() => {});
          throw new CancelledFailure("Activity paused by orchestrator (error during cancellation)");
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorType = err instanceof Error ? err.constructor.name : "UnknownError";

        console.error(
          `[ExecuteDeepAgent] Failed for execution ${executionId}: ` +
          `[${errorType}] ${errorMessage}`,
        );

        const failedStatus = create(AgentExecutionStatusSchema, {
          phase: ExecutionPhase.EXECUTION_FAILED,
          error: `Execution failed: [${errorType}] ${errorMessage}`,
          completedAt: utcTimestamp(),
          messages: [
            create(AgentMessageSchema, {
              type: MessageType.MESSAGE_SYSTEM,
              content: `Error: [${errorType}] ${errorMessage}`,
              timestamp: utcTimestamp(),
            }),
          ],
        });

        await persistStatus(client, executionId, failedStatus);
        return slimStatus(failedStatus);

      } finally {
        await cleanup(setup);
        activityFinished();
      }
    },
  };
}

async function cleanup(setup: SetupResult | null): Promise<void> {
  if (!setup) return;

  if (setup.mcpConnection) {
    try {
      await setup.mcpConnection.client.close();
    } catch (err) {
      console.warn("[ExecuteDeepAgent] MCP connection cleanup failed:", err);
    }
  }
}
