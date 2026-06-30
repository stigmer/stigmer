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
import { create, clone, type JsonObject } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution, AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionPhase, InteractionMode, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { activityStarted, activityFinished } from "../../idle-watchdog.js";
import { normalizeActivityInput, type ExecuteActivityInput } from "../../shared/activity-input.js";
import { persistStatus, slimStatus, utcTimestamp } from "../../shared/status.js";
import type { ToolOutputOffloadContext } from "../../shared/status-offload.js";
import { publishPlanArtifact } from "../../shared/plan-artifact.js";
import { classifyTool } from "../../shared/tool-kind.js";
import {
  POLICY_ENGINE_VERSION,
  toProtoPolicySource,
  type PolicySource,
} from "../../shared/approval-policy.js";
import type { Config } from "../../config.js";
import { StigmerClient } from "../../client/stigmer-client.js";
import { performSetup, type SetupResult } from "./setup.js";
import { streamExecution, type StreamResult } from "./streaming.js";
import { loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { StatusBuilder } from "./status-builder.js";
import { InlinePublisher } from "./inline-publisher.js";
import { WriteBackCoordinator } from "./writeback-coordinator.js";
import { FileChangeCoordinator } from "./file-change-coordinator.js";
import { processPostStream } from "./post-stream.js";
import { resolveResumeInput, type GraphStateSnapshot } from "./hitl.js";
import { captureApprovalArtifacts } from "./approval-file-change.js";

export function createDeepAgentActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
    tokenRef: config.stigmerTokenRef,
  });

  const streamingConfig = loadStreamingConfig();

  return {
    // Accepts the new typed object OR the legacy positional args (transitional
    // dual-shape so the runner can deploy before the control planes — see
    // shared/activity-input.ts). Drop the positional arm once both control
    // planes send the object.
    ExecuteDeepAgent: async (
      arg0: ExecuteActivityInput | string,
      arg1?: string,
    ): Promise<unknown> => {
      const { executionId, threadId } = normalizeActivityInput(arg0, arg1);
      activityStarted();
      let setup: SetupResult | null = null;

      try {
        console.log(`[ExecuteDeepAgent] Started for execution ${executionId}`);

        setup = await performSetup({ config, client, executionId, threadId });

        // Single offload context for every persist in this execution: spill
        // oversized tool outputs (e.g. computer-use screenshots) to artifact
        // storage so the UI can render them, and keep the status under the
        // gRPC cap. Threaded into the streaming loop and reused for the
        // terminal persists below so the guard is never skipped.
        const statusOffload: ToolOutputOffloadContext = {
          artifactStorage: setup.artifactStorage,
          executionId,
        };

        // Read the graph checkpoint once, to resolve how a pending approval
        // interrupt continues (Command(resume) vs a fresh replay). Reading once
        // avoids a redundant round-trip on the durable (http) saver.
        const graphState: GraphStateSnapshot = await setup.agentGraph.getState(setup.langgraphConfig);

        // Seed from the persisted transcript whenever the execution already has
        // committed history, so streamed deltas append onto it instead of
        // replacing it. This holds for every re-invocation — durable resume and
        // memory-checkpointer replay alike — and is a no-op on a first run.
        const initialStatus = shouldSeedFromPersistedTranscript(setup.execution)
          ? seedStatusFromExecution(setup.execution)
          : create(AgentExecutionStatusSchema, {});
        const statusBuilder = new StatusBuilder(executionId, initialStatus);

        statusBuilder.setApprovalProvider({
          policies: setup.approvalPolicies,
          toolServerMap: setup.toolServerMap,
          leasedCategories: setup.leasedCategories,
          globalBypass: setup.globalBypass,
        });

        const resume = resolveResumeInput(
          setup.execution,
          graphState,
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
          await persistStatus(client, executionId, failedStatus, { offload: statusOffload });
          return slimStatus(failedStatus);
        }

        const effectiveInput = resume.isResumeFromApproval
          ? resume.graphInput
          : setup.langgraphInput;

        const inlinePublisher = new InlinePublisher({
          workspaceBackend: setup.workspaceBackend,
          artifactStorage: setup.artifactStorage,
          statusWriter: statusBuilder,
          executionId,
        });

        const workspaceEntries = setup.session.spec?.workspaceEntries ?? [];
        const writebackCoordinator = setup.provisionResults.length > 0
          ? new WriteBackCoordinator({
              statusWriter: statusBuilder,
              executionId,
              provisionResults: setup.provisionResults,
              workspaceEntries: workspaceEntries as any,
              workspaceBackend: setup.workspaceBackend,
            })
          : null;

        const fileChangeCoordinator = new FileChangeCoordinator({
          statusWriter: statusBuilder,
          buffer: setup.fileChangeBuffer,
          workspaceBackend: setup.workspaceBackend,
        });

        const cancellationSignal = Context.current().cancellationSignal;

        const result: StreamResult = await streamExecution({
          agentGraph: setup.agentGraph,
          langgraphInput: effectiveInput as Record<string, unknown>,
          langgraphConfig: setup.langgraphConfig,
          executionId,
          client,
          initialStatus,
          streamingConfig,
          offload: statusOffload,
          gracefulStop: setup.gracefulStop,
          inlinePublisher,
          writebackCoordinator: writebackCoordinator ?? undefined,
          fileChangeCoordinator,
          heartbeatFn: (details) => Context.current().heartbeat(details),
          isCancelledFn: () => cancellationSignal.aborted,
          approvalProvider: {
            policies: setup.approvalPolicies,
            toolServerMap: setup.toolServerMap,
            leasedCategories: setup.leasedCategories,
            globalBypass: setup.globalBypass,
          },
          streamVersion: setup.streamVersion,
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
            await persistStatus(client, executionId, initialStatus, { offload: statusOffload });
            console.log(`[ExecuteDeepAgent] Paused for execution ${executionId}: events=${result.eventsProcessed}`);
            throw new CancelledFailure("Activity paused by orchestrator");
          }
          return result.terminalStatus;
        }

        if (!setup.globalBypass) {
          const graphState = await setup.agentGraph.getState(setup.langgraphConfig);
          const graphMessages = (graphState.values as { messages?: unknown }).messages;
          const aiMessages = Array.isArray(graphMessages) ? graphMessages : [];
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
                    // Provenance verdict carried through the gate's interrupt
                    // (approval-gate.ts). Absent on interrupts seeded before this
                    // field existed → undefined → UNSPECIFIED, like an unset tool_kind.
                    policySource: (val?.policy_source as PolicySource) || undefined,
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
              const toolCall = create(ToolCallSchema, {
                id: intr.toolCallId,
                name: intr.toolName,
                status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
                requiresApproval: true,
                approvalMessage: intr.message,
                approvalRequestedAt: utcTimestamp(),
                mcpServerSlug: intr.mcpServerSlug,
                startedAt: utcTimestamp(),
                toolKind: classifyTool(intr.toolName, intr.mcpServerSlug),
                approvalPolicySource: toProtoPolicySource(intr.policySource),
                policyEngineVersion: intr.policySource ? POLICY_ENGINE_VERSION : "",
              });

              // Capture the proposed edit (and a sanitized args preview) while the
              // graph is paused, so the approval UI renders a real before/after
              // diff before the tool runs. Args are correlated from the AI-message
              // tool call in graph state (the single source of truth); oversized
              // before/after bodies are offloaded by persistStatus below.
              const { argsPreview, fileChange } = await captureApprovalArtifacts({
                toolName: intr.toolName,
                toolCallId: intr.toolCallId,
                messages: aiMessages,
                workspaceBackend: setup.workspaceBackend,
              });
              if (argsPreview) toolCall.argsPreview = argsPreview;
              if (fileChange) toolCall.fileChanges = [fileChange];

              aiMsg.toolCalls.push(toolCall);
            }
            initialStatus.messages.push(aiMsg);

            await persistStatus(client, executionId, initialStatus, { offload: statusOffload });
            return slimStatus(initialStatus);
          }
        }

        initialStatus.phase = ExecutionPhase.EXECUTION_COMPLETED;
        initialStatus.completedAt = utcTimestamp();

        let structuredOutput: JsonObject | undefined;
        let finalText: string | undefined;

        const lastAiMsg = [...initialStatus.messages]
          .reverse()
          .find(m => m.type === MessageType.MESSAGE_AI);
        if (lastAiMsg) {
          finalText = lastAiMsg.content;
        }

        if (setup.hasStructuredOutput) {
          // Primary source: deepagents' structuredResponse surfaced via the v3
          // run.output. This is the reliable path when the graph populates it.
          const sr = result.runOutput?.structuredResponse;
          if (sr != null && typeof sr === "object" && !Array.isArray(sr)) {
            structuredOutput = sr as JsonObject;
          } else if (sr !== undefined) {
            console.warn(
              `[ExecuteDeepAgent] structuredResponse is not a plain object ` +
              `for execution ${executionId}: type=${typeof sr}`,
            );
          }

          // Fallback: extract JSON from the agent's final text message. The v3
          // streaming path does not surface deepagents' structuredResponse
          // (hasStructuredResponse=false), so we recover structured output by
          // parsing the agent's final response (JSON / code-fence / last-brace).
          if (structuredOutput === undefined && finalText) {
            const { extractJsonFromText } = await import("../../shared/extract-json.js");
            const extracted = extractJsonFromText(finalText);
            if (extracted != null && typeof extracted === "object" && !Array.isArray(extracted)) {
              structuredOutput = extracted as JsonObject;
              console.log(
                `[ExecuteDeepAgent] structured output extracted from final text ` +
                `for execution ${executionId}: finalTextLength=${finalText.length}`,
              );
            }
          }

          if (structuredOutput !== undefined) {
            initialStatus.structuredOutput = structuredOutput;
          }
        }

        // Plan mode: the agent's final message is the plan. Publish it as a
        // first-class plan.md artifact so the UI can render a reviewable Plan
        // card and a follow-up Implement run can reference it. Read-only mode
        // produces no file to auto-publish, so this is the only artifact path.
        if (
          setup.execution.spec?.executionConfig?.interactionMode === InteractionMode.PLAN &&
          finalText
        ) {
          await publishPlanArtifact({
            status: initialStatus,
            executionId,
            planText: finalText,
            artifactStorage: setup.artifactStorage,
          });
        }

        await persistStatus(client, executionId, initialStatus, { offload: statusOffload });

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

/**
 * Whether to seed the initial status from the persisted execution transcript.
 *
 * The Temporal workflow re-invokes ExecuteDeepAgent with the same thread_id on
 * every continuation — HITL approval, pause/resume, and transient recovery. The
 * runner owns the transcript and the server enforces it as append-only at
 * identity, so any continuation must build ON the committed history rather than
 * rebuilding from an empty proto and replacing it.
 *
 * The decision is therefore driven solely by whether the server already holds
 * committed history for this execution — NOT by the live graph checkpoint, which
 * the two checkpointers leave in different states for the same continuation:
 *   - durable (http): the checkpoint survives, the graph resumes via
 *     Command(resume), and streamEvents re-emits only post-checkpoint events;
 *   - memory (the OSS local / desktop default): the checkpoint is recreated
 *     empty every invocation, so the graph REPLAYS from scratch and the blind
 *     FIFO turns advance one gate at a time.
 * Keying on the live checkpoint skipped seeding on that memory-replay path, so a
 * second sequential gate emitted a transcript holding only the new gate, dropped
 * the first gate's committed tool-call id, and tripped the server's append-only
 * guard — the silent sequential-gate skip. Seeding whenever persisted history
 * exists covers both paths; a re-emitted prior turn reconciles in place by
 * tool-call id (StatusBuilder.rebuildToolCallIndex), so seeding never
 * duplicates. False on a first run (no persisted messages), preserving the
 * original start-from-empty behavior.
 */
function shouldSeedFromPersistedTranscript(execution: AgentExecution): boolean {
  return (execution.status?.messages.length ?? 0) > 0;
}

/**
 * Seed a fresh status from the persisted execution transcript so streamed
 * deltas append onto existing history rather than replacing it. The clone keeps
 * the persisted proto immutable. Terminal fields are cleared because the resumed
 * run is in progress again; the StatusBuilder constructor re-sets the phase.
 */
function seedStatusFromExecution(execution: AgentExecution): AgentExecutionStatus {
  const seeded = clone(AgentExecutionStatusSchema, execution.status!);
  seeded.completedAt = "";
  seeded.error = "";
  return seeded;
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

