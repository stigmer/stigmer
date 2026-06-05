/**
 * ExecuteCursor Temporal activity — the core of the cursor-runner service.
 *
 * Implements the same Slim-Payload Pattern as ExecuteGraphton:
 * - Receives only executionId + harnessStateId (Cursor agentId)
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
 *
 * Durable Continuation Model:
 * Conversation continuity is carried by the Cursor SDK's native local agent
 * state, whose SQLite store is persisted on the durable workspace volume
 * (see resolvePlatformOptions) so Agent.resume() survives pod restart,
 * reschedule, and snapshot restore. When resume fails (store lost/corrupted
 * or agent unknown), resolveAgent() creates a fresh agent and the next turn
 * starts from the user message plus re-injected instructions.
 */

import { heartbeat, Context, CancelledFailure } from "@temporalio/activity";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionControlSignal, ExecutionPhase, InteractionMode, MessageType, ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage, Run, ConversationTurn } from "@cursor/sdk";

import type { Config } from "../../config.js";
import { StigmerClient } from "../../client/stigmer-client.js";
import { resolveAgent } from "./session-lifecycle.js";
import type { AgentResolution, CreateAgentOptions, CreateCloudAgentOptions } from "./session-lifecycle.js";
import { CursorMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { determineCursorMode, isCloudMode } from "./cursor-mode.js";
import { MessageAccumulator, extractDeniedToolCalls, cancelInProgressSubAgentProtos } from "./message-translator.js";
import { utcTimestamp, persistStatus, reportSetupProgress, slimStatus } from "../../shared/status.js";
import { DeltaEnricher } from "./delta-enricher.js";
import { TodoTracker } from "./todo-tracker.js";
import { createCursorEventRecorder } from "./cursor-event-recorder.js";
import { resolveMcpServers, validateMcpServerEnv } from "./mcp-resolver.js";
import { mergeApprovalPolicies } from "./approval-policy.js";
import { backfillMcpServersIfNeeded } from "./connect-backfill.js";
import { resolveExecutionEnv } from "./env-resolver.js";
import { resolveBlueprint } from "./blueprint-resolver.js";
import { buildCursorSubAgentDefinitions } from "./subagent-config.js";
import { resolveSkills } from "./skill-resolver.js";
import { resolveAttachments } from "./attachment-resolver.js";
import { buildEnhancedPrompt, buildReinvocationPrompt } from "./prompt-builder.js";
import { extractAgentRationale, getGitBranch, getGitHeadSha } from "./hitl-diagnostics.js";
import { writeHooksToWorkspace } from "./workspace-setup.js";
import { buildApprovalState } from "./approval-state.js";
import { provisionCursorWorkspace } from "./workspace-provision.js";
import { setInterceptorExecutionId, runWithExecutionContext } from "./fetch-interceptor.js";
import { closeProxySessions } from "./http2-interceptor.js";
import { resolveModelId, ensureLoaded as ensurePricingLoaded } from "./model-pricing.js";
import { UsageAccumulator } from "./usage-accumulator.js";
import { StreamingUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { activityStarted, activityFinished } from "../../idle-watchdog.js";
import { getCapturedRejection, clearCapturedRejection } from "./rejection-capture.js";
import { synthesizeError, formatClassifiedError, shouldRetryWithFreshAgent } from "./error-classifier.js";
import type { ClassifiedError } from "./error-classifier.js";
import { createAgent, createCloudAgent } from "./session-lifecycle.js";
import { setMaxListeners } from "node:events";
import { startHeartbeat } from "../../shared/heartbeat.js";
import { getShutdownSignalForQueue } from "../../runner-manager.js";

/**
 * Creates the activity functions bound to the runner config.
 * Returned object is passed to Temporal Worker.create({ activities }).
 */
export function createCursorActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
    tokenRef: config.stigmerTokenRef,
  });

  return {
    ExecuteCursor: async (executionId: string, threadId: string): Promise<unknown> => {
      activityStarted();
      try {
        return await executeCursor(config, client, executionId, threadId);
      } finally {
        activityFinished();
      }
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

  // Ensure fresh HTTP/2 transport — prevents a degraded session from a
  // prior workflow task from poisoning this execution's agent stream.
  closeProxySessions();

  setInterceptorExecutionId(executionId);
  return runWithExecutionContext(executionId, () => executeCursorInner(config, client, executionId, threadId));
}

async function executeCursorInner(
  config: Config,
  client: StigmerClient,
  executionId: string,
  threadId: string,
): Promise<unknown> {

  const status = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    startedAt: utcTimestamp(),
  });

  let sessionId: string | undefined;
  let session: import("@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb").Session | undefined;
  let pauseDetected = false;
  let workerShutdownDetected = false;
  let periodicHeartbeat: ReturnType<typeof startHeartbeat> | undefined;
  // Carries model/mode/agentId out to the outer catch so a thrown CursorSdkError
  // can be classified with the same context as the run.wait() error path.
  let errorContext = { model: "default", mode: "local", agentId: "" };

  try {
    // Phase 1: Hydrate execution from DB
    await reportSetupProgress(client, executionId, "Fetching execution");
    const execution = await client.getExecution(executionId);
    const spec = execution.spec!;
    sessionId = spec.sessionId;

    // Phase 2: Load session and resolve full agent blueprint
    await reportSetupProgress(client, executionId, "Resolving agent blueprint");
    session = await client.getSession(sessionId);
    const blueprint = await resolveBlueprint(client, session, config.workspaceRootDir);

    // Phase 2b: Resolve execution environment (MCP server credentials)
    await reportSetupProgress(client, executionId, "Resolving environment");
    const { envVars, secretKeys } = await resolveExecutionEnv(client, executionId);
    heartbeat();

    // Phase 2c: Provision the workspace (clone git repos / mount local paths)
    // so the LOCAL Cursor agent operates on the actual repo. Cursor previously
    // relied on cloud agents to clone git-repo workspace entries; with cloud
    // disabled the runner must provision the workspace itself, mirroring the
    // native harness. Git provisioning is idempotent across multi-turn and
    // HITL reinvocations.
    await reportSetupProgress(client, executionId, "Provisioning workspace");
    blueprint.workspaceDirs = await provisionCursorWorkspace(
      config, session, envVars, sessionId ?? "",
    );
    heartbeat();

    // Set OTel baggage so downstream calls carry execution context.
    try {
      const { setBaggage, BAGGAGE_EXECUTION_ID, BAGGAGE_SESSION_ID, BAGGAGE_ORG_ID } = await import("../../otel.js");
      await setBaggage({
        [BAGGAGE_EXECUTION_ID]: executionId,
        [BAGGAGE_SESSION_ID]: sessionId ?? "",
        [BAGGAGE_ORG_ID]: session?.metadata?.org ?? "",
      });
    } catch {
      // Tracing not initialized — silently skip.
    }

    // Cloud Cursor agents are disabled platform-wide (see determineCursorMode),
    // so every session runs LOCAL. We intentionally ignore any persisted
    // cursor_mode here so a session can never route to the cloud path while
    // it is disabled — even one that was created when cloud was enabled.
    const cursorMode = determineCursorMode(
      blueprint.sessionSpec.workspaceEntries,
      config.cloudModeEnabled,
    );
    const agentMode = isCloudMode(cursorMode) ? "cloud" as const : "local" as const;

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

    // Phase 4: Resolve MCP servers with approval policies
    await reportSetupProgress(client, executionId, "Resolving MCP servers");
    let mcpResolution = await resolveMcpServers(
      client, blueprint.mergedMcpServerUsages, envVars,
    );

    // Phase 4a: Connect backfill for undiscovered MCP servers
    const sessionOrg = session.metadata?.org ?? "";
    mcpResolution = await backfillMcpServersIfNeeded(
      client, mcpResolution, blueprint.mergedMcpServerUsages, envVars, sessionOrg,
      heartbeat, secretKeys,
    );
    const mcpConfig = mcpResolution.cursorConfig;

    // Phase 4b: Merge approval policies from all layers
    const agentOverrides = blueprint.mergedMcpServerUsages
      .flatMap((u) => u.toolApprovalOverrides ?? []);
    const mergedPolicies = mergeApprovalPolicies(
      mcpResolution.resolvedServers,
      agentOverrides,
      execution.spec?.autoApproveAll ?? false,
    );
    heartbeat();

    // Phase 4c: Validate MCP server env health (diagnostic, non-blocking)
    const mcpWarnings = validateMcpServerEnv(
      mcpResolution.resolvedServers,
      blueprint.mergedMcpServerUsages,
      envVars,
    );
    if (mcpWarnings.length > 0) {
      console.warn(
        `ExecuteCursor MCP pre-flight warnings: execution=${executionId}\n` +
        mcpWarnings.map((w) => `  - ${w}`).join("\n"),
      );
    }

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

    // Phase 5c: Ensure model pricing registry is populated before validation
    await ensurePricingLoaded();

    // Phase 6: Validate model selection
    const requestedModel = spec.executionConfig?.modelName || "default";
    const validatedModel = resolveModelId(requestedModel);
    if (validatedModel !== requestedModel) {
      console.log(
        `ExecuteCursor model resolved: execution=${executionId}, requested="${requestedModel}", using="${validatedModel}"`,
      );
    }

    heartbeat();

    // Phase 7: Resolve Cursor Agent (create, resume, or graceful fallback)
    await reportSetupProgress(client, executionId, "Initializing Cursor agent");

    // In proxy mode, use the stigmer token as the API key — the proxy
    // validates it and injects the real Cursor API key server-side.
    // In direct mode, use the user's own CURSOR_API_KEY.
    const effectiveApiKey = config.proxyEndpoint
      ? (config.stigmerTokenRef?.current ?? config.stigmerToken ?? config.cursorApiKey)
      : config.cursorApiKey;

    if (!effectiveApiKey || effectiveApiKey === "proxy-managed") {
      const source = config.proxyEndpoint ? "proxy (STIGMER_TOKEN)" : "direct (CURSOR_API_KEY)";
      throw new Error(
        `No Cursor API credential available. Mode=${source}, ` +
        `proxyEndpoint=${config.proxyEndpoint ?? "unset"}, ` +
        `hasStigmerToken=${!!config.stigmerToken}, ` +
        `hasTokenRef=${!!config.stigmerTokenRef?.current}`,
      );
    }

    // Register blueprint sub-agents with the Cursor SDK so the parent can
    // delegate to them by name via the Task tool. Re-supplied on every
    // create/resume (the SDK does not persist agent config across resume).
    const cursorSubAgents = buildCursorSubAgentDefinitions(blueprint.subAgents);
    if (cursorSubAgents) {
      console.log(
        `ExecuteCursor registering ${Object.keys(cursorSubAgents).length} custom sub-agent(s): ` +
        `execution=${executionId}, names=${Object.keys(cursorSubAgents).join(", ")}`,
      );
    }

    const createOptions: CreateAgentOptions | CreateCloudAgentOptions = agentMode === "cloud"
      ? {
          apiKey: effectiveApiKey,
          model: validatedModel || undefined,
          repos: blueprint.cloudRepos,
          sessionId,
          mcpServers: mcpConfig,
          agents: cursorSubAgents,
        }
      : {
          apiKey: effectiveApiKey,
          model: validatedModel,
          workspaceDirs: blueprint.workspaceDirs,
          sessionId,
          workspaceRootDir: config.workspaceRootDir,
          mcpServers: mcpConfig,
          agents: cursorSubAgents,
        };

    let resolution: AgentResolution = await resolveAgent(
      threadId,
      createOptions,
      agentMode,
    );

    console.log(
      `ExecuteCursor agent resolved: execution=${executionId}, ` +
      `reason=${resolution.reason}, mode=${resolution.mode}, ` +
      `agentId=${resolution.agentId}, resumed=${resolution.resumed}` +
      (resolution.resumeFailureDetail ? `, failureDetail=${resolution.resumeFailureDetail}` : ""),
    );

    errorContext = { model: validatedModel, mode: agentMode, agentId: resolution.agentId };

    // Phase 8: Write hooks for HITL with policy-aware state
    const approvalState = buildApprovalState(
      mergedPolicies,
      execution.spec?.autoApproveAll ?? false,
      approvalDecisions,
    );
    await writeHooksToWorkspace(primaryWorkspaceDir, approvalState);

    // Phase 9: Store new agentId as harness_state_id and persist cursor_mode
    if (resolution.isNew && resolution.agentId) {
      try {
        blueprint.sessionSpec.harnessStateId = resolution.agentId;
        if (blueprint.sessionSpec.cursorMode === CursorMode.UNSPECIFIED) {
          blueprint.sessionSpec.cursorMode = cursorMode;
        }
        // Clear slug to avoid re-validation of potentially invalid
        // server-generated slugs. BuildUpdateStateStep preserves the
        // existing slug from the database record.
        if (blueprint.session.metadata) {
          blueprint.session.metadata.slug = "";
        }
        await client.updateSession(blueprint.session);
        console.log(
          `Stored Cursor agentId=${resolution.agentId} as harness_state_id, ` +
          `cursorMode=${CursorMode[cursorMode]} on session ${sessionId}`,
        );
      } catch (err) {
        console.warn("Failed to persist harness_state_id/cursorMode on session (non-fatal):", err);
      }
    }

    // Phase 9b: Detect structured output schema from execution config
    const structuredOutputSchema = spec.executionConfig?.structuredOutputSchema as
      Record<string, unknown> | undefined;

    // Phase 10: Build the prompt
    const interactionMode = spec.executionConfig?.interactionMode
      ?? InteractionMode.UNSPECIFIED;

    const prompt = buildPrompt({
      resolution,
      approvalDecisions,
      instructions: blueprint.instructions,
      userMessage: spec.message,
      skills: skillMetadata,
      subAgents: blueprint.subAgents,
      workspaceDirs: blueprint.workspaceDirs,
      workspaceFileRefs: spec.workspaceFileRefs ?? [],
      attachmentPaths,
      pendingApprovals: status.pendingApprovals.length > 0
        ? status.pendingApprovals
        : (execution.status?.pendingApprovals ?? []),
      interactionMode,
    });

    // Phase 10a: Inject structured output instruction for Cursor harness
    let effectivePrompt = prompt;
    if (structuredOutputSchema) {
      const schemaStr = JSON.stringify(structuredOutputSchema, null, 2);
      effectivePrompt += `\n\n---\nCRITICAL OUTPUT REQUIREMENT:\nYour final response MUST be a single valid JSON object (no markdown, no commentary, no code fences) that matches this schema:\n${schemaStr}\n\nRespond with ONLY the JSON object. Nothing else.`;
    }

    // Phase 10a2: Log Stigmer preamble size for context trimming diagnostics
    const promptChars = effectivePrompt.length;
    const promptEstimatedTokens = Math.ceil(promptChars / 4);
    console.log(
      `ExecuteCursor prompt built: execution=${executionId}, ` +
      `chars=${promptChars}, estimatedTokens=${promptEstimatedTokens}, ` +
      `resolution=${resolution.reason}, mode=${resolution.mode}`,
    );

    // Phase 10b: Initialize usage accumulator for runner-side token tracking
    await ensurePricingLoaded();
    const usageAccumulator = new UsageAccumulator(validatedModel);

    // Phase 10c: Start OTel turn span (coarse-grained — wraps entire agent.send + stream)
    const { startCursorTurnSpan } = await import("../../otel.js");
    const turnSpan = await startCursorTurnSpan({
      model: validatedModel,
      mode: agentMode,
      sessionId: sessionId ?? "",
    });

    // Phase 11: Send message and stream events
    status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;
    const collectedEvents: SDKMessage[] = [];

    const deltaEnricher = new DeltaEnricher();
    const todoTracker = new TodoTracker(status.todos);
    const eventRecorder = createCursorEventRecorder(executionId);

    let platformStopSignaled = false;
    let firstTurnAttributionLogged = false;
    let streamErrorMessage: string | undefined;
    let alreadyRetriedWithFreshAgent = false;

    // Periodic heartbeat keeps Temporal informed during silent SDK operations
    // (e.g. long tool calls, MCP requests, model thinking). Without this,
    // the 2-minute heartbeat timeout can cancel the activity and mislabel
    // the execution as "paused by user".
    const taskQueue = Context.current().info.taskQueue;
    const shutdownSignal = getShutdownSignalForQueue(taskQueue);
    periodicHeartbeat = startHeartbeat(30_000, () => ({
      phase: "cursor_streaming",
      execution: executionId,
    }), { shutdownSignal });

    // The Cursor SDK registers abort listeners on the cancellation signal for
    // each concurrent tool call (fetch, MCP, shell). With 10+ parallel tools,
    // Node's default limit of 10 triggers MaxListenersExceededWarning. This is
    // a diagnostic warning, not a functional error — reproduction tests confirm
    // zero tool call loss — but it pollutes logs and creates false alarm fatigue.
    // Raise the limit on the Temporal cancellation signal used throughout this
    // activity. 25 covers observed peaks (~12 concurrent tools + heartbeat +
    // shutdown signal + SDK internals) with headroom.
    try {
      setMaxListeners(25, Context.current().cancellationSignal);
    } catch {
      // Fallback: if the Temporal signal doesn't support setMaxListeners
      // (e.g. older SDK), the warning is harmless — ignore.
    }

    const run = await resolution.agent.send(effectivePrompt, {
      onDelta: ({ update }) => {
        if (update.type === "turn-ended" && update.usage) {
          usageAccumulator.addTurn(update.usage);

          if (!firstTurnAttributionLogged) {
            firstTurnAttributionLogged = true;
            const sdkInputTokens = update.usage.inputTokens ?? 0;
            const cursorOverhead = Math.max(0, sdkInputTokens - promptEstimatedTokens);
            console.log(
              `ExecuteCursor context attribution (first turn): execution=${executionId}, ` +
              `sdkInputTokens=${sdkInputTokens}, stigmerPreamble=${promptEstimatedTokens}, ` +
              `cursorOverhead=${cursorOverhead} (estimated)`,
            );
          }
        }
        deltaEnricher.processDelta(update);
        try {
          heartbeat();
        } catch (hbErr) {
          if (hbErr instanceof CancelledFailure) {
            pauseDetected = true;
            return;
          }
          throw hbErr;
        }
      },
    });

    const accumulator = new MessageAccumulator(status.messages, { mergedPolicies });
    let eventCount = 0;

    for await (const event of run.stream()) {
      if (pauseDetected || Context.current().cancellationSignal.aborted) {
        pauseDetected = true;
        break;
      }

      collectedEvents.push(event);
      eventRecorder?.record(event, eventCount);

      accumulator.processEvent(event);
      todoTracker.processEvent(event);

      if (event.type === "tool_call" && event.name === "task") {
        accumulator.trackSubAgentExecution(
          event as Extract<SDKMessage, { type: "tool_call" }>,
        );
      }

      deltaEnricher.applyEnrichments(status.messages);
      eventCount++;

      if (event.type === "status") {
        console.log(
          `ExecuteCursor stream status: execution=${executionId}, status=${JSON.stringify(event)}`,
        );
        const statusEvent = event as { status?: string; message?: string };
        if (statusEvent.status === "ERROR" && statusEvent.message) {
          streamErrorMessage = statusEvent.message;
        }
      }

      const shouldPersist = eventCount % 20 === 0 || deltaEnricher.isDirty ||
        todoTracker.isDirty || accumulator.subAgentDirty;
      if (usageAccumulator.hasTurns) {
        status.streamingUsage = create(StreamingUsageSummarySchema, usageAccumulator.snapshot());
      }
      if (shouldPersist) {
        // Sync sub-agent executions into status before every persist so the
        // live UI reflects delegation (including the IN_PROGRESS state) while
        // the parent is still running — matching the native harness, which
        // calls syncSubAgentExecutions() on each persist. Without this, the
        // accumulator tracked sub-agents in memory but they only reached the
        // status (and the subscriber stream) after the loop ended.
        status.subAgentExecutions = accumulator.subAgentExecutions;
        const signal = await persistStatus(client, executionId, status);
        deltaEnricher.markPersisted();
        todoTracker.markPersisted();
        accumulator.markSubAgentPersisted();
        heartbeat();
        if (signal === ExecutionControlSignal.STOP) {
          platformStopSignaled = true;
          console.warn(
            `ExecuteCursor platform stop signal received: execution=${executionId}`,
          );
        }
      }

      if (platformStopSignaled) {
        console.log(`ExecuteCursor stopping stream due to platform stop signal: execution=${executionId}`);
        break;
      }
    }

    periodicHeartbeat.stop();
    // Check both the heartbeat flag AND the shutdown signal directly.
    // Race condition: the heartbeat timer may detect Temporal's CancelledFailure
    // (from worker.shutdown()) before the AbortSignal microtask propagates,
    // causing it to set `cancelled` instead of `workerShutdown`. The direct
    // signal check catches this case.
    const isShutdown = periodicHeartbeat.workerShutdown || (shutdownSignal?.aborted ?? false);
    if (isShutdown) {
      pauseDetected = false;
    } else if (periodicHeartbeat.cancelled) {
      pauseDetected = true;
    }

    workerShutdownDetected = isShutdown;

    accumulator.finalize();
    deltaEnricher.finalize(status.messages);
    // A pause / cancel / worker shutdown aborts the Cursor SDK run, so any
    // sub-agent the parent had delegated is no longer executing. Mark it
    // CANCELLED rather than leaving a permanent IN_PROGRESS "zombie" in the
    // final snapshot (parity with the native harness's cancelSubAgents()).
    if (pauseDetected || workerShutdownDetected || Context.current().cancellationSignal.aborted) {
      accumulator.cancelInProgressSubAgents();
    }
    status.subAgentExecutions = accumulator.subAgentExecutions;
    await eventRecorder?.flush();
    if (usageAccumulator.hasTurns) {
      status.streamingUsage = create(StreamingUsageSummarySchema, usageAccumulator.snapshot());
    }
    console.log(
      `ExecuteCursor stream ended: execution=${executionId}, events=${eventCount}, messages=${status.messages.length}, subAgents=${status.subAgentExecutions.length}`,
    );

    // Persist immediately after finalize so the UI sees correct tool
    // call statuses before run.wait() / structured output extraction.
    // This is unconditional (not throttled) because finalize is a
    // once-per-execution correctness boundary.
    await persistStatus(client, executionId, status);
    heartbeat();

    // End OTel turn span with accumulated token usage
    const usageSnapshot = usageAccumulator.snapshot();
    turnSpan.setTokens(Number(usageSnapshot.inputTokens), Number(usageSnapshot.outputTokens));
    turnSpan.end();

    // Record cursor turn metrics (duration, tokens)
    try {
      const { recordTurnMetrics } = await import("../../otel.js");
      const turnDurationMs = Date.now() - (status.startedAt ? new Date(status.startedAt).getTime() : Date.now());
      await recordTurnMetrics({
        durationMs: turnDurationMs,
        inputTokens: Number(usageSnapshot.inputTokens),
        outputTokens: Number(usageSnapshot.outputTokens),
        model: validatedModel,
        mode: agentMode,
      });
    } catch {
      // Metrics not initialized — silently skip.
    }


    // Phase 11a: Handle worker shutdown, pause, or infrastructure cancellation.

    // Worker shutdown: the runner-manager aborted the shutdown signal before
    // calling worker.shutdown(). This is NOT a user-initiated pause — it's
    // an infrastructure event (e.g., premature removal from UI race).
    if (workerShutdownDetected) {
      status.phase = ExecutionPhase.EXECUTION_FAILED;
      status.error = "Execution interrupted: runner worker was shut down. Retry or resume.";
      status.completedAt = utcTimestamp();
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Execution interrupted: the runner worker was shut down while the agent was still running. You can retry or resume.",
        timestamp: utcTimestamp(),
      }));
      await persistStatus(client, executionId, status);      console.log(`ExecuteCursor interrupted (worker shutdown): execution=${executionId}, events=${eventCount}`);
      throw new CancelledFailure("Activity cancelled (worker shutdown, not user pause)");
    }

    // pauseDetected is only true if a heartbeat() call threw CancelledFailure,
    // confirming the orchestrator explicitly requested a pause.
    if (pauseDetected) {
      status.phase = ExecutionPhase.EXECUTION_PAUSED;
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Execution paused by user. Use resume to continue.",
        timestamp: utcTimestamp(),
      }));
      await persistStatus(client, executionId, status);      console.log(`ExecuteCursor paused: execution=${executionId}, events=${eventCount}`);
      throw new CancelledFailure("Activity paused by orchestrator");
    }

    // If cancellation arrived without pauseDetected (e.g. heartbeat timeout
    // that slipped past the periodic heartbeat, or worker shutdown), report
    // as failed rather than misleadingly labeling it as user-paused.
    if (Context.current().cancellationSignal.aborted) {
      status.phase = ExecutionPhase.EXECUTION_FAILED;
      status.error = "Execution interrupted: agent was unresponsive (heartbeat timeout). Retry or resume.";
      status.completedAt = utcTimestamp();
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Execution interrupted: the agent was unresponsive for too long. You can retry or resume.",
        timestamp: utcTimestamp(),
      }));
      await persistStatus(client, executionId, status);      console.log(`ExecuteCursor interrupted (infrastructure cancel): execution=${executionId}, events=${eventCount}`);
      throw new CancelledFailure("Activity cancelled (heartbeat timeout, not user pause)");
    }

    // Phase 11b: Handle platform stop signal early exit
    if (platformStopSignaled) {
      status.phase = ExecutionPhase.EXECUTION_COMPLETED;
      status.completedAt = utcTimestamp();
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Execution stopped by the platform.",
        timestamp: utcTimestamp(),
      }));
      await persistStatus(client, executionId, status);      try { resolution.agent.close(); } catch { /* best effort */ }
      console.log(`ExecuteCursor completed (platform stop): execution=${executionId}`);
      return slimStatus(status);
    }

    // Phase 12: Check for denied tool calls (HITL)
    const deniedCalls = extractDeniedToolCalls(collectedEvents, mergedPolicies);
    if (deniedCalls.length > 0) {
      status.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;

      // Capture HITL diagnostics at deny-time for intelligent reinvocation
      const [gitBranch, gitHead] = await Promise.all([
        getGitBranch(primaryWorkspaceDir),
        getGitHeadSha(primaryWorkspaceDir),
      ]);

      status.pendingApprovals = deniedCalls.map((dc) =>
        create(PendingApprovalSchema, {
          toolCallId: dc.callId,
          toolName: dc.name,
          argsPreview: dc.argsPreview,
          message: dc.approvalMessage,
          agentRationale: extractAgentRationale(status.messages, dc.callId),
          branchAtDeny: gitBranch,
          headShaAtDeny: gitHead,
        }),
      );
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: `Tool approval required for: ${deniedCalls.map((d) => d.mcpServerSlug ? d.mcpServerSlug + "/" + d.name : d.name).join(", ")}`,
        timestamp: utcTimestamp(),
      }));
      await persistStatus(client, executionId, status);
      console.log(`ExecuteCursor returning WAITING_FOR_APPROVAL: ${deniedCalls.length} tools pending`);
      return slimStatus(status);
    }

    // Phase 13: Map final result
    const result = await run.wait();
    const sdkResolvedModel = result.model?.id || undefined;
    console.log(
      `ExecuteCursor run.wait() result: execution=${executionId}, result=${JSON.stringify(result)}`,
    );
    if (sdkResolvedModel && sdkResolvedModel !== validatedModel) {
      console.log(
        `ExecuteCursor model divergence: execution=${executionId}, requested=${validatedModel}, sdkResolved=${sdkResolvedModel}`,
      );
    }
    status.completedAt = utcTimestamp();

    switch (result.status) {
      case "finished":
        status.phase = ExecutionPhase.EXECUTION_COMPLETED;
        break;
      case "error": {
        const resultAny = result as unknown as Record<string, unknown>;
        const sdkError = result.result
          ?? resultAny.error
          ?? resultAny.message
          ?? resultAny.reason;
        const sdkErrorStr = sdkError ? String(sdkError) : undefined;

        // The SDK frequently resolves run.wait() to a bare { status: "error" }
        // while the real reason (e.g. the original grpc-status 12 routing
        // failure) lives on the failing conversation turn. Capture it here so
        // the classified error is actionable instead of "no detail from SDK".
        const conversationErrorText = await introspectConversation(run, executionId);

        const capturedRejection = getCapturedRejection(executionId);
        if (capturedRejection) clearCapturedRejection(executionId);

        const classified = synthesizeError({
          sdkResultFields: sdkErrorStr,
          streamErrorMessage,
          capturedRejection,
          conversationErrorText,
          isResumedHandle: resolution.reason === "resumed_successfully",
          fallbackContext: { model: validatedModel, mode: agentMode, agentId: resolution.agentId },
          durationMs: (result as unknown as Record<string, unknown>).durationMs as number | undefined,
          messageCount: status.messages.length,
        });

        console.error(
          `ExecuteCursor agent error: execution=${executionId}, ` +
          `classified=${JSON.stringify(classified)}, rawResult=${JSON.stringify(result)}`,
        );

        if (
          shouldRetryWithFreshAgent(classified)
          && resolution.reason === "resumed_successfully"
          && !alreadyRetriedWithFreshAgent
        ) {
          alreadyRetriedWithFreshAgent = true;
          console.warn(
            `ExecuteCursor poisoned-handle recovery: execution=${executionId}, ` +
            `disposing agent ${resolution.agentId} and creating fresh agent`,
          );

          try { resolution.agent.close(); } catch { /* best effort */ }

          const freshAgent = agentMode === "cloud"
            ? await createCloudAgent(createOptions as CreateCloudAgentOptions)
            : await createAgent(createOptions as CreateAgentOptions);

          const freshPrompt = buildPrompt({
            resolution: {
              ...resolution,
              agent: freshAgent,
              agentId: freshAgent.agentId,
              isNew: true,
              resumed: false,
              reason: "created_after_resume_failure",
              resumeFailureDetail: `poisoned-handle recovery: ${classified.message}`,
            },
            approvalDecisions,
            instructions: blueprint.instructions,
            userMessage: spec.message,
            skills: skillMetadata,
            subAgents: blueprint.subAgents,
            workspaceDirs: blueprint.workspaceDirs,
            workspaceFileRefs: spec.workspaceFileRefs ?? [],
            attachmentPaths,
            pendingApprovals: status.pendingApprovals.length > 0
              ? status.pendingApprovals
              : (execution.status?.pendingApprovals ?? []),
            interactionMode,
          });

          console.log(
            `ExecuteCursor retry with fresh agent: execution=${executionId}, ` +
            `newAgentId=${freshAgent.agentId}`,
          );

          try {
            blueprint.sessionSpec.harnessStateId = freshAgent.agentId;
            if (blueprint.session.metadata) blueprint.session.metadata.slug = "";
            await client.updateSession(blueprint.session);
          } catch (updateErr) {
            console.warn("Failed to update session with fresh agentId (non-fatal):", updateErr);
          }

          const retryRun = await freshAgent.send(freshPrompt, {
            onDelta: ({ update }) => {
              if (update.type === "turn-ended" && update.usage) {
                usageAccumulator.addTurn(update.usage);
              }
              deltaEnricher.processDelta(update);
              try { heartbeat(); } catch { /* swallow during retry */ }
            },
          });

          streamErrorMessage = undefined;

          for await (const retryEvent of retryRun.stream()) {
            if (Context.current().cancellationSignal.aborted) break;
            collectedEvents.push(retryEvent);
            accumulator.processEvent(retryEvent);
            if (retryEvent.type === "status") {
              const retryStatusEvent = retryEvent as { status?: string; message?: string };
              if (retryStatusEvent.status === "ERROR" && retryStatusEvent.message) {
                streamErrorMessage = retryStatusEvent.message;
              }
            }
            heartbeat();
          }

          const retryResult = await retryRun.wait();
          console.log(
            `ExecuteCursor retry run.wait(): execution=${executionId}, ` +
            `retryResult=${JSON.stringify(retryResult)}`,
          );

          if (retryResult.status === "finished") {
            status.phase = ExecutionPhase.EXECUTION_COMPLETED;
            console.log(
              `ExecuteCursor poisoned-handle recovery SUCCEEDED: execution=${executionId}`,
            );
            break;
          }

          if (retryResult.status === "cancelled") {
            status.phase = ExecutionPhase.EXECUTION_CANCELLED;
            break;
          }

          const retryRejection = getCapturedRejection(executionId);
          if (retryRejection) clearCapturedRejection(executionId);

          const retryConversationErrorText = await introspectConversation(retryRun, executionId);

          const retryClassified = synthesizeError({
            sdkResultFields: retryResult.result ? String(retryResult.result) : undefined,
            streamErrorMessage,
            capturedRejection: retryRejection,
            conversationErrorText: retryConversationErrorText,
            isResumedHandle: false,
            fallbackContext: { model: validatedModel, mode: agentMode, agentId: freshAgent.agentId },
          });

          status.phase = ExecutionPhase.EXECUTION_FAILED;
          status.error = formatClassifiedError(retryClassified);
          console.error(
            `ExecuteCursor poisoned-handle recovery FAILED: execution=${executionId}, ` +
            `retryError=${status.error}`,
          );
          break;
        }

        // Transport-timeout retry: fresh agent got 0 messages (degraded h2 session).
        // Reset proxy sessions and try once with a new connection.
        if (
          classified.category === "network"
          && classified.retryable
          && resolution.reason !== "resumed_successfully"
          && !alreadyRetriedWithFreshAgent
        ) {
          alreadyRetriedWithFreshAgent = true;
          console.warn(
            `ExecuteCursor transport-timeout recovery: execution=${executionId}, ` +
            `resetting proxy sessions and retrying with fresh agent`,
          );

          try { resolution.agent.close(); } catch { /* best effort */ }
          closeProxySessions();

          const freshAgent = agentMode === "cloud"
            ? await createCloudAgent(createOptions as CreateCloudAgentOptions)
            : await createAgent(createOptions as CreateAgentOptions);

          try {
            blueprint.sessionSpec.harnessStateId = freshAgent.agentId;
            if (blueprint.session.metadata) blueprint.session.metadata.slug = "";
            await client.updateSession(blueprint.session);
          } catch (updateErr) {
            console.warn("Failed to update session with fresh agentId (non-fatal):", updateErr);
          }

          const retryRun = await freshAgent.send(effectivePrompt, {
            onDelta: ({ update }) => {
              if (update.type === "turn-ended" && update.usage) {
                usageAccumulator.addTurn(update.usage);
              }
              deltaEnricher.processDelta(update);
              try { heartbeat(); } catch { /* swallow during retry */ }
            },
          });

          streamErrorMessage = undefined;

          for await (const retryEvent of retryRun.stream()) {
            if (Context.current().cancellationSignal.aborted) break;
            collectedEvents.push(retryEvent);
            accumulator.processEvent(retryEvent);
            if (retryEvent.type === "status") {
              const retryStatusEvent = retryEvent as { status?: string; message?: string };
              if (retryStatusEvent.status === "ERROR" && retryStatusEvent.message) {
                streamErrorMessage = retryStatusEvent.message;
              }
            }
            heartbeat();
          }

          const retryResult = await retryRun.wait();
          if (retryResult.status === "finished") {
            status.phase = ExecutionPhase.EXECUTION_COMPLETED;
            resolution = { ...resolution, agent: freshAgent, agentId: freshAgent.agentId, isNew: true };
            break;
          }

          status.phase = ExecutionPhase.EXECUTION_FAILED;
          status.error = `Transport recovery failed: ${formatClassifiedError(classified)}`;
          break;
        }

        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = formatClassifiedError(classified);
        break;
      }
      case "cancelled":
        status.phase = ExecutionPhase.EXECUTION_CANCELLED;
        break;
      default:
        status.phase = ExecutionPhase.EXECUTION_COMPLETED;
    }

    // Extract structured output BEFORE persisting, so the subscriber sees
    // COMPLETED + structured_output atomically.
    let structuredOutput: unknown = undefined;
    let finalText: string | undefined;

    if (status.phase === ExecutionPhase.EXECUTION_COMPLETED) {
      const lastAiMsg = [...status.messages]
        .reverse()
        .find(m => m.type === MessageType.MESSAGE_AI);
      finalText = lastAiMsg?.content;

      if (structuredOutputSchema && finalText) {
        const { extractJsonFromText } = await import("../../shared/extract-json.js");

        // Tier 1 + 1.5: JSON.parse, code-fence extraction, heuristic brace match
        structuredOutput = extractJsonFromText(finalText);
        if (structuredOutput !== undefined) {
          console.log(
            `ExecuteCursor structured output extracted (text): execution=${executionId}, ` +
            `finalTextLength=${finalText.length}`,
          );
        }

        if (structuredOutput === undefined) {
          // Tier 2: LLM extraction with withStructuredOutput — deterministic,
          // uses function-calling to guarantee schema-conformant output
          console.log(
            `ExecuteCursor text extraction failed, trying LLM extraction: execution=${executionId}, ` +
            `finalTextLength=${finalText.length}`,
          );
          try {
            structuredOutput = await extractStructuredOutput(
              finalText, structuredOutputSchema, config, requestedModel,
            );
            if (structuredOutput !== undefined) {
              console.log(
                `ExecuteCursor structured output extracted (LLM): execution=${executionId}`,
              );
            }
          } catch (extractErr) {
            const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
            console.error(
              `ExecuteCursor structured output extraction FAILED: execution=${executionId}, ` +
              `requestedModel=${requestedModel}, ` +
              `finalTextLength=${finalText.length}, ` +
              `error=${errMsg}`,
            );
          }
        }
      }

      if (structuredOutput !== undefined) {
        status.structuredOutput = structuredOutput as JsonObject;
      }
    }

    // NOW persist — subscriber sees COMPLETED + structured_output atomically
    await persistStatus(client, executionId, status);

    console.log(
      `ExecuteCursor completed: execution=${executionId}, phase=${ExecutionPhase[status.phase]}, ` +
      `hasStructuredOutput=${structuredOutput !== undefined}` +
        (status.error ? `, error=${status.error}` : ""),
    );

    // Release SDK executor lease to prevent cache buildup across workflow tasks
    try { resolution.agent.close(); } catch { /* best effort */ }

    const slim = slimStatus(status) as Record<string, unknown>;
    if (finalText !== undefined) {
      slim.final_text = finalText;
    }
    if (structuredOutput !== undefined) {
      slim.structured = structuredOutput;
    }
    return slim;

  } catch (err) {
    periodicHeartbeat?.stop();

    if (err instanceof CancelledFailure) {
      // workerShutdownDetected means the runner-manager signaled shutdown
      // before the worker drained. This is infrastructure failure, not pause.
      if (workerShutdownDetected) {
        console.log(`ExecuteCursor cancelled (worker shutdown) for execution ${executionId}`);
        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = "Execution interrupted: runner worker was shut down. Retry or resume.";
        status.completedAt = utcTimestamp();
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Execution interrupted: the runner worker was shut down while the agent was still running. You can retry or resume.",
          timestamp: utcTimestamp(),
        }));
      } else if (pauseDetected) {
        console.log(`ExecuteCursor cancelled (pause) for execution ${executionId}`);
        status.phase = ExecutionPhase.EXECUTION_PAUSED;
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Execution paused by user. Use resume to continue.",
          timestamp: utcTimestamp(),
        }));
      } else {
        console.log(`ExecuteCursor cancelled (infrastructure) for execution ${executionId}`);
        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = "Execution interrupted: agent was unresponsive (heartbeat timeout). Retry or resume.";
        status.completedAt = utcTimestamp();
        status.messages.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Execution interrupted: the agent was unresponsive for too long. You can retry or resume.",
          timestamp: utcTimestamp(),
        }));
      }
      // The aborted Cursor run leaves no live sub-agent — mark any in-flight
      // delegation CANCELLED so the final snapshot has no zombie sub-agent.
      cancelInProgressSubAgentProtos(status.subAgentExecutions);
      await persistStatus(client, executionId, status).catch(() => {});      throw err;
    }

    // If a non-CancelledFailure error occurs while a pause is in progress,
    // treat the execution as paused rather than failed. The error was likely
    // caused by the cancellation (e.g. SDK stream teardown) and should not
    // overwrite the PAUSED state that the Pause RPC already set in the DB.
    if (pauseDetected) {
      const errDetail = err instanceof Error ? err.message : String(err);
      console.log(
        `ExecuteCursor error during pause (treating as pause): execution=${executionId}, error=${errDetail}`,
      );
      status.phase = ExecutionPhase.EXECUTION_PAUSED;
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Execution paused by user. Use resume to continue.",
        timestamp: utcTimestamp(),
      }));
      cancelInProgressSubAgentProtos(status.subAgentExecutions);
      await persistStatus(client, executionId, status).catch(() => {});      throw new CancelledFailure("Activity paused by orchestrator (error during pause)");
    }

    // Infrastructure cancellation (e.g. heartbeat timeout) with a
    // non-CancelledFailure error — report as failed, not paused.
    if (Context.current().cancellationSignal.aborted) {
      const errDetail = err instanceof Error ? err.message : String(err);
      console.log(
        `ExecuteCursor error during infrastructure cancel: execution=${executionId}, error=${errDetail}`,
      );
      status.phase = ExecutionPhase.EXECUTION_FAILED;
      status.error = `Execution interrupted: ${errDetail}`;
      status.completedAt = utcTimestamp();
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Execution interrupted: the agent was unresponsive for too long. You can retry or resume.",
        timestamp: utcTimestamp(),
      }));
      cancelInProgressSubAgentProtos(status.subAgentExecutions);
      await persistStatus(client, executionId, status).catch(() => {});      throw new CancelledFailure("Activity cancelled (infrastructure, not user pause)");
    }

    // A thrown CursorSdkError carries structured fields (code/status/endpoint/
    // requestId) that the generic format below would flatten to a bare message.
    // Route it through the same classifier as the run.wait() error path so the
    // failure category and full diagnostics are preserved.
    const { CursorSdkError } = await import("@cursor/sdk");
    if (err instanceof CursorSdkError) {
      const sdkErrorJson = err.toJSON();
      console.error(
        `ExecuteCursor SDK error: execution=${executionId}, sdkError=${JSON.stringify(sdkErrorJson)}`,
      );
      const classified = synthesizeError({
        sdkError: { code: err.code, status: err.status, message: err.message },
        sdkResultFields: undefined,
        streamErrorMessage: undefined,
        capturedRejection: getCapturedRejection(executionId),
        isResumedHandle: false,
        fallbackContext: errorContext,
      });
      clearCapturedRejection(executionId);
      status.phase = ExecutionPhase.EXECUTION_FAILED;
      status.error = formatClassifiedError(classified);
      status.completedAt = utcTimestamp();
      status.messages.push(
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Internal system error occurred. Please contact support if this issue persists.",
          timestamp: utcTimestamp(),
        }),
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_SYSTEM,
          content: `Error details: ${status.error}`,
          timestamp: utcTimestamp(),
        }),
      );
      try {
        await persistStatus(client, executionId, status);
      } catch (persistErr) {
        console.error("Failed to persist error status (best-effort):", persistErr);
      }      return slimStatus(status);
    }

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

// ---------------------------------------------------------------------------
// Structured Output Extraction (Cursor Harness Tier 2)
// ---------------------------------------------------------------------------

/**
 * Extract structured data from an agent's free-text response using an
 * economy-tier LLM with withStructuredOutput (function-calling).
 * Guarantees schema-conformant JSON output via the API's tool-use mechanism.
 *
 * Provider-aware: resolves the economy model via the registry, infers its
 * provider (anthropic / openai), and constructs the correct LangChain client
 * with the matching proxy endpoint. Follows the same pattern as
 * call-llm.ts constructModel().
 */
async function extractStructuredOutput(
  agentResponse: string,
  schema: Record<string, unknown>,
  config: Config,
  primaryModel: string,
): Promise<unknown | null> {
  const { ChatOpenAI } = await import("@langchain/openai");
  const { ChatAnthropic } = await import("@langchain/anthropic");
  const { inferProvider, resolveProxyBaseUrl, buildProxyHeaders } = await import("../../shared/llm-proxy.js");
  const { getEconomyModel } = await import("../../shared/model-registry.js");

  const extractionModel = await getEconomyModel(primaryModel);
  const provider = inferProvider(extractionModel);

  const proxyEndpoint = config.proxyEndpoint ?? config.stigmerBackendEndpoint;
  const baseUrl = resolveProxyBaseUrl(proxyEndpoint, provider);
  const headers = config.stigmerToken
    ? buildProxyHeaders(config.stigmerToken, {})
    : {};

  const apiKey = provider === "openai"
    ? (config.stigmerToken ?? process.env.OPENAI_API_KEY ?? "proxy-managed")
    : (config.stigmerToken ?? process.env.ANTHROPIC_API_KEY ?? "proxy-managed");

  const llm = provider === "openai"
    ? new ChatOpenAI({
        model: extractionModel,
        apiKey,
        temperature: 0,
        maxTokens: 4096,
        configuration: { baseURL: baseUrl, defaultHeaders: headers },
      })
    : new ChatAnthropic({
        model: extractionModel,
        apiKey,
        temperature: 0,
        maxTokens: 4096,
        clientOptions: { baseURL: baseUrl, defaultHeaders: headers },
      });

  const zodSchema = jsonSchemaToZod(schema);
  const structured = llm.withStructuredOutput(zodSchema);

  const result = await structured.invoke([
    { role: "system", content: "Extract the structured data from the agent's response. Return only the data that matches the schema." },
    { role: "user", content: agentResponse },
  ]);

  return result ?? null;
}

// Re-export for use within this module; shared implementation eliminates
// the three duplicate converters that previously drifted independently.
import { jsonSchemaToZod } from "../../shared/json-schema-to-zod.js";

// ---------------------------------------------------------------------------
// Prompt selection
// ---------------------------------------------------------------------------

export interface BuildPromptInput {
  resolution: AgentResolution;
  approvalDecisions: Map<string, ApprovalAction> | undefined;
  instructions: string;
  userMessage: string;
  skills: import("./prompt-builder.js").SkillMetadata[];
  subAgents: import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent[];
  workspaceDirs: string[];
  workspaceFileRefs: string[];
  attachmentPaths: string[];
  pendingApprovals: import("@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb").PendingApproval[];
  interactionMode?: InteractionMode;
}

/**
 * Select and build the appropriate prompt based on resolution reason and
 * HITL state.
 *
 * Conversation continuation is carried entirely by the Cursor SDK's native
 * agent state (the local SQLite store persisted on the durable workspace
 * volume, or cloud server-side state) — there is no separate continuation
 * store. The prompt therefore depends only on how the agent was resolved:
 *
 * 1. HITL reinvocation        -> buildReinvocationPrompt (approval decisions;
 *                                 the resumed agent's native context carries
 *                                 the prior conversation)
 * 2. resumed_successfully      -> raw userMessage (native context carries it)
 * 3. first execution / fresh   -> buildEnhancedPrompt (full instructions +
 *    agent after resume failure   skills; no prior conversation to inherit)
 */
export function buildPrompt(input: BuildPromptInput): string {
  const {
    resolution,
    approvalDecisions,
    instructions,
    userMessage,
    skills,
    subAgents,
    workspaceDirs,
    workspaceFileRefs,
    attachmentPaths,
    interactionMode,
  } = input;

  const isHitlReinvocation = approvalDecisions !== undefined && approvalDecisions.size > 0;

  // HITL reinvocation: the agent is resumed, so its native context carries the
  // prior conversation; the reinvocation prompt conveys the approval decisions.
  if (isHitlReinvocation) {
    return buildReinvocationPrompt(approvalDecisions);
  }

  // A successfully resumed agent carries its own conversation context via the
  // SDK's native store — send the raw user message with no preamble.
  if (resolution.reason === "resumed_successfully") {
    return userMessage;
  }

  // First execution, or a fresh agent created after a resume failure: there is
  // no prior conversation to inherit, so start a new turn with full context.
  return buildEnhancedPrompt({
    instructions,
    userMessage,
    skills,
    subAgents,
    workspaceDirs,
    workspaceFileRefs,
    attachmentPaths,
    interactionMode,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort: read the failing run's conversation to recover the real error
 * reason the SDK swallowed in run.wait(). Logs the (bounded) raw turns for deep
 * diagnostics and returns a concise error string for the classifier.
 *
 * Strictly non-fatal — any failure (unsupported operation, transport error)
 * returns undefined and never propagates into the execution's error path.
 */
async function introspectConversation(
  run: Run,
  executionId: string,
): Promise<string | undefined> {
  try {
    if (!run.supports("conversation")) {
      console.log(
        `ExecuteCursor conversation introspection unsupported: execution=${executionId}, ` +
        `reason=${run.unsupportedReason("conversation") ?? "n/a"}`,
      );
      return undefined;
    }
    const turns = await run.conversation();
    const raw = JSON.stringify(turns);
    const bounded = raw.length > 8000 ? `${raw.slice(0, 8000)}…(truncated ${raw.length} chars)` : raw;
    console.error(
      `ExecuteCursor conversation introspection: execution=${executionId}, ` +
      `turns=${turns.length}, raw=${bounded}`,
    );
    return extractConversationErrorText(turns);
  } catch (introspectErr) {
    console.warn(
      `ExecuteCursor conversation introspection failed (non-fatal): execution=${executionId}, ` +
      `error=${introspectErr instanceof Error ? introspectErr.message : String(introspectErr)}`,
    );
    return undefined;
  }
}

/**
 * Walk the last conversation turn and collect human-meaningful error text
 * (error-status payloads and `text`/`message`/`reason` strings). Schema-agnostic
 * by design so it tolerates SDK conversation-shape changes. Returns undefined
 * when nothing useful is found.
 */
function extractConversationErrorText(turns: ConversationTurn[]): string | undefined {
  if (!turns || turns.length === 0) return undefined;
  const collected: string[] = [];

  const visit = (node: unknown, depth: number): void => {
    if (node == null || depth > 6 || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.status === "error" && obj.error != null) {
      collected.push(
        typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error),
      );
    }
    for (const [key, value] of Object.entries(obj)) {
      if (
        (key === "text" || key === "message" || key === "reason")
        && typeof value === "string"
        && value.trim().length > 0
      ) {
        collected.push(value.trim());
      } else if (typeof value === "object" && value != null) {
        visit(value, depth + 1);
      }
    }
  };

  visit(turns[turns.length - 1], 0);
  if (collected.length === 0) return undefined;

  const joined = [...new Set(collected)].join(" | ");
  return joined.length > 600 ? `${joined.slice(0, 600)}…` : joined;
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
