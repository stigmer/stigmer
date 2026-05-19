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

import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
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

export function createDeepAgentActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
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

        const result: StreamResult = await streamExecution({
          agentGraph: setup.agentGraph,
          langgraphInput: setup.langgraphInput,
          langgraphConfig: setup.langgraphConfig,
          executionId,
          client,
          initialStatus,
          streamingConfig,
          gracefulStop: setup.gracefulStop,
          inlinePublisher,
          writebackCoordinator: writebackCoordinator ?? undefined,
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
          return result.terminalStatus;
        }

        initialStatus.phase = ExecutionPhase.EXECUTION_COMPLETED;
        initialStatus.completedAt = utcTimestamp();
        await persistStatus(client, executionId, initialStatus);

        console.log(
          `[ExecuteDeepAgent] Completed for execution ${executionId}: ` +
          `events=${result.eventsProcessed}, ` +
          `messages=${initialStatus.messages.length}, ` +
          `artifacts=${initialStatus.artifacts.length}, ` +
          `writebacks=${initialStatus.workspaceWriteBacks.length}`,
        );

        return slimStatus(initialStatus);

      } catch (err: unknown) {
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
