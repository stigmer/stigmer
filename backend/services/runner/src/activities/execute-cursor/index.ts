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
 * When Agent.resume() fails (agent expired or evicted), resolveAgent()
 * gracefully creates a fresh agent. The prompt selection logic detects
 * the resolution reason and injects a continuation prompt built from
 * persisted SessionMemory, making the conversation durable across
 * agent evictions. Local mode always uses continuation prompts on
 * subsequent executions because local SDK context loading is unreliable.
 */

import { heartbeat } from "@temporalio/activity";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionControlSignal, ExecutionPhase, InteractionMode, MessageType, ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";

import type { Config } from "../../config.js";
import { StigmerClient } from "../../client/stigmer-client.js";
import { resolveAgent } from "./session-lifecycle.js";
import type { AgentResolution, CreateAgentOptions, CreateCloudAgentOptions } from "./session-lifecycle.js";
import { CursorMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { determineCursorMode, isCloudMode } from "./cursor-mode.js";
import { MessageAccumulator, extractDeniedToolCalls } from "./message-translator.js";
import { utcTimestamp, persistStatus, reportSetupProgress, slimStatus } from "../../shared/status.js";
import { DeltaEnricher } from "./delta-enricher.js";
import { TodoTracker } from "./todo-tracker.js";
import { resolveMcpServers } from "./mcp-resolver.js";
import { mergeApprovalPolicies } from "./approval-policy.js";
import { backfillMcpServersIfNeeded } from "./connect-backfill.js";
import { resolveExecutionEnv } from "./env-resolver.js";
import { resolveBlueprint } from "./blueprint-resolver.js";
import { resolveSkills } from "./skill-resolver.js";
import { resolveAttachments } from "./attachment-resolver.js";
import { buildEnhancedPrompt, buildReinvocationPrompt } from "./prompt-builder.js";
import { buildContinuationPrompt, buildHitlContinuationPrompt } from "./continuation-prompt.js";
import { extractAgentRationale, getGitBranch, getGitHeadSha } from "./continuation-prompt.js";
import { writeHooksToWorkspace } from "./workspace-setup.js";
import { buildApprovalState } from "./approval-state.js";
import { setInterceptorExecutionId } from "./fetch-interceptor.js";
import { resolveModelId, ensureLoaded as ensurePricingLoaded } from "./model-pricing.js";
import { UsageAccumulator } from "./usage-accumulator.js";
import type { TurnRecord } from "./usage-accumulator.js";
import { ContextTracker } from "./context-tracker.js";
import { RecordLlmCallUsageInputSchema } from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import { TokenUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { UsageCompletionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { StreamingUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { buildSessionMemory, persistSessionMemory, estimateTokens } from "./session-memory.js";
import { activityStarted, activityFinished } from "../../idle-watchdog.js";

/**
 * Creates the activity functions bound to the runner config.
 * Returned object is passed to Temporal Worker.create({ activities }).
 */
export function createCursorActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
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

  setInterceptorExecutionId(executionId);

  const status = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    startedAt: utcTimestamp(),
  });

  let sessionId: string | undefined;
  let session: import("@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb").Session | undefined;
  let userMessage: string | undefined;

  try {
    // Phase 1: Hydrate execution from DB
    await reportSetupProgress(client, executionId, "Fetching execution");
    const execution = await client.getExecution(executionId);
    const spec = execution.spec!;
    sessionId = spec.sessionId;
    userMessage = spec.message;

    // Phase 2: Load session and resolve full agent blueprint
    await reportSetupProgress(client, executionId, "Resolving agent blueprint");
    session = await client.getSession(sessionId);
    const blueprint = await resolveBlueprint(client, session, config.workspaceRootDir);

    // Phase 2b: Resolve execution environment (MCP server credentials)
    await reportSetupProgress(client, executionId, "Resolving environment");
    const { envVars } = await resolveExecutionEnv(client, executionId);
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

    // Determine cursor mode: use persisted value on subsequent executions,
    // compute from workspace entries on first execution.
    const cursorMode = blueprint.sessionSpec.cursorMode !== CursorMode.UNSPECIFIED
      ? blueprint.sessionSpec.cursorMode
      : determineCursorMode(
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
      heartbeat,
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

    const createOptions: CreateAgentOptions | CreateCloudAgentOptions = agentMode === "cloud"
      ? {
          apiKey: config.cursorApiKey,
          model: validatedModel || undefined,
          repos: blueprint.cloudRepos,
          sessionId,
          mcpServers: mcpConfig,
        }
      : {
          apiKey: config.cursorApiKey,
          model: validatedModel,
          workspaceDirs: blueprint.workspaceDirs,
          sessionId,
          mcpServers: mcpConfig,
        };

    const resolution: AgentResolution = await resolveAgent(
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
        await client.updateSession(blueprint.session);
        console.log(
          `Stored Cursor agentId=${resolution.agentId} as harness_state_id, ` +
          `cursorMode=${CursorMode[cursorMode]} on session ${sessionId}`,
        );
      } catch (err) {
        console.warn("Failed to persist harness_state_id/cursorMode on session (non-fatal):", err);
      }
    }

    // Phase 10: Build the prompt
    const sessionMemory = session?.status?.sessionMemory;
    const interactionMode = spec.executionConfig?.interactionMode
      ?? InteractionMode.UNSPECIFIED;

    const prompt = buildPrompt({
      resolution,
      approvalDecisions,
      sessionMemory,
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

    // Phase 10a: Log Stigmer preamble size for context trimming diagnostics
    const promptChars = prompt.length;
    const promptEstimatedTokens = estimateTokens(prompt);
    console.log(
      `ExecuteCursor prompt built: execution=${executionId}, ` +
      `chars=${promptChars}, estimatedTokens=${promptEstimatedTokens}, ` +
      `resolution=${resolution.reason}, mode=${resolution.mode}`,
    );

    // Phase 10b: Initialize usage accumulator for runner-side token tracking
    await ensurePricingLoaded();
    const usageAccumulator = new UsageAccumulator(validatedModel);

    const contextTracker = new ContextTracker(validatedModel);
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

    let platformStopSignaled = false;
    let firstTurnAttributionLogged = false;

    const run = await resolution.agent.send(prompt, {
      onDelta: ({ update }) => {
        if (update.type === "turn-ended" && update.usage) {
          usageAccumulator.addTurn(update.usage);
          contextTracker.recordTurn(update.usage.inputTokens ?? 0);

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
        heartbeat();
      },
    });

    const accumulator = new MessageAccumulator(status.messages, { mergedPolicies });
    let eventCount = 0;

    for await (const event of run.stream()) {
      collectedEvents.push(event);
      accumulator.processEvent(event);
      todoTracker.processEvent(event);
      deltaEnricher.applyEnrichments(status.messages);
      eventCount++;

      if (event.type === "status") {
        console.log(
          `ExecuteCursor stream status: execution=${executionId}, status=${JSON.stringify(event)}`,
        );
      }

      const shouldPersist = eventCount % 20 === 0 || deltaEnricher.isDirty || todoTracker.isDirty;
      if (usageAccumulator.hasTurns) {
        status.streamingUsage = create(StreamingUsageSummarySchema, usageAccumulator.snapshot());
      }
      if (contextTracker.hasData) {
        status.contextInfo = contextTracker.snapshot();
      }
      if (shouldPersist) {
        const signal = await persistStatus(client, executionId, status);
        deltaEnricher.markPersisted();
        todoTracker.markPersisted();
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

    accumulator.finalize();
    deltaEnricher.finalize(status.messages);
    status.subAgentExecutions = accumulator.subAgentExecutions;
    if (usageAccumulator.hasTurns) {
      status.streamingUsage = create(StreamingUsageSummarySchema, usageAccumulator.snapshot());
    }
    if (contextTracker.hasData) {
      status.contextInfo = contextTracker.snapshot();
    }
    console.log(
      `ExecuteCursor stream ended: execution=${executionId}, events=${eventCount}, messages=${status.messages.length}, subAgents=${status.subAgentExecutions.length}`,
    );

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


    // Phase 11b: Handle platform stop signal early exit
    if (platformStopSignaled) {
      status.phase = ExecutionPhase.EXECUTION_COMPLETED;
      status.completedAt = utcTimestamp();
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Execution stopped by the platform.",
        timestamp: utcTimestamp(),
      }));
      await persistStatus(client, executionId, status);
      await emitBillingRecords(client, executionId, usageAccumulator);
      await maybePeristSessionMemory(client, sessionId, session, status, userMessage);
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
      case "error":
        status.phase = ExecutionPhase.EXECUTION_FAILED;
        status.error = result.result ?? "Cursor run failed";
        console.error(
          `ExecuteCursor agent error: execution=${executionId}, error=${status.error}`,
        );
        break;
      case "cancelled":
        status.phase = ExecutionPhase.EXECUTION_CANCELLED;
        break;
      default:
        status.phase = ExecutionPhase.EXECUTION_COMPLETED;
    }

    await persistStatus(client, executionId, status);

    // Phase 13b: Emit billing records for cursor usage
    await emitBillingRecords(client, executionId, usageAccumulator, sdkResolvedModel);

    // Phase 14: Build and persist session memory
    await maybePeristSessionMemory(client, sessionId, session, status, userMessage);

    console.log(
      `ExecuteCursor completed: execution=${executionId}, phase=${ExecutionPhase[status.phase]}` +
        (status.error ? `, error=${status.error}` : ""),
    );

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

    await maybePeristSessionMemory(client, sessionId, session, status, userMessage);

    return slimStatus(status);
  }
}

// ---------------------------------------------------------------------------
// Prompt selection
// ---------------------------------------------------------------------------

export interface BuildPromptInput {
  resolution: AgentResolution;
  approvalDecisions: Map<string, ApprovalAction> | undefined;
  sessionMemory: import("@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb").SessionMemory | undefined;
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
 * Select and build the appropriate prompt based on resolution mode,
 * resolution reason, HITL state, and available session memory.
 *
 * Decision matrix:
 *
 * HITL reinvocations (both modes):
 * 1. HITL + session memory -> buildHitlContinuationPrompt
 * 2. HITL + no memory     -> buildReinvocationPrompt (legacy)
 *
 * Cloud mode:
 * 3. Cloud + resumed / first execution -> raw userMessage (trust native context)
 * 4. Cloud + resume failure + memory   -> buildContinuationPrompt (agent expired)
 * 5. Cloud + resume failure, no memory -> raw userMessage (best effort)
 *
 * Local mode:
 * 6. Local + first execution           -> buildEnhancedPrompt
 * 7. Local + subsequent + memory       -> buildContinuationPrompt
 * 8. Local + subsequent, no memory     -> buildEnhancedPrompt (fallback)
 */
export function buildPrompt(input: BuildPromptInput): string {
  const {
    resolution,
    approvalDecisions,
    sessionMemory,
    instructions,
    userMessage,
    skills,
    subAgents,
    workspaceDirs,
    workspaceFileRefs,
    attachmentPaths,
    pendingApprovals,
    interactionMode,
  } = input;

  const isHitlReinvocation = approvalDecisions !== undefined && approvalDecisions.size > 0;

  // HITL takes precedence regardless of mode
  if (isHitlReinvocation && sessionMemory) {
    return buildHitlContinuationPrompt({
      instructions,
      skills,
      subAgents,
      workspaceDirs,
      sessionMemory,
      pendingApprovals,
      approvalDecisions,
    });
  }

  if (isHitlReinvocation) {
    return buildReinvocationPrompt(approvalDecisions);
  }

  // Cloud mode: trust native Cursor context for live agents.
  // Only inject continuation prompt when the agent expired (fallback).
  if (resolution.mode === "cloud") {
    if (resolution.reason === "created_after_resume_failure" && sessionMemory) {
      return buildContinuationPrompt({
        instructions,
        skills,
        subAgents,
        workspaceDirs,
        workspaceFileRefs,
        attachmentPaths,
        sessionMemory,
        userMessage,
        interactionMode,
      });
    }
    return userMessage;
  }

  // Local mode: always use continuation prompt on subsequent executions
  // because local SDK context loading is unreliable.
  if (resolution.reason !== "created_first_execution" && sessionMemory) {
    return buildContinuationPrompt({
      instructions,
      skills,
      subAgents,
      workspaceDirs,
      workspaceFileRefs,
      attachmentPaths,
      sessionMemory,
      userMessage,
      interactionMode,
    });
  }

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
 * Build and persist session memory if the execution is in a terminal phase.
 *
 * Skips WAITING_FOR_APPROVAL (that is a pause, not a completion) and
 * cases where session/spec are not yet available (very early failures).
 * Best-effort: errors are logged and swallowed.
 */
async function maybePeristSessionMemory(
  client: StigmerClient,
  sessionId: string | undefined,
  session: import("@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb").Session | undefined,
  status: AgentExecutionStatus,
  userMessage: string | undefined,
): Promise<void> {
  if (!sessionId) return;
  if (status.phase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL) return;

  try {
    const previousMemory = session?.status?.sessionMemory;
    const memory = buildSessionMemory({
      previousMemory,
      messages: status.messages,
      todos: status.todos,
      userMessage: userMessage ?? "",
    });
    await persistSessionMemory(client, sessionId, memory);
  } catch (err) {
    console.warn(
      "Failed to build/persist session memory (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Emit per-turn billing records via the recordLlmCallUsage RPC.
 *
 * Each turn produces one billing record with sequence = turn number.
 * The billing handler computes cost server-side from the model registry.
 * Best-effort: failures are logged and swallowed — billing gaps are
 * preferable to failing the execution.
 */
export interface BillingRecordParams {
  executionId: string;
  turn: TurnRecord;
  requestedModel: string;
  sdkResolvedModel?: string;
}

export function buildTurnBillingInput(params: BillingRecordParams) {
  const { executionId, turn, requestedModel, sdkResolvedModel } = params;
  const resolvedModel = sdkResolvedModel || requestedModel;
  return create(RecordLlmCallUsageInputSchema, {
    executionId,
    sequence: turn.sequence,
    provider: "cursor",
    resolvedModel,
    requestedModel,
    tokens: create(TokenUsageSchema, {
      inputTokens: BigInt(turn.inputTokens),
      outputTokens: BigInt(turn.outputTokens),
      cacheCreationInputTokens: BigInt(turn.cacheWriteTokens),
      cacheReadInputTokens: BigInt(turn.cacheReadTokens),
    }),
    usageStatus: UsageCompletionStatus.COMPLETE,
    streaming: true,
    harness: "cursor",
  });
}

async function emitBillingRecords(
  client: StigmerClient,
  executionId: string,
  usage: UsageAccumulator,
  sdkResolvedModel?: string,
): Promise<void> {
  const turns = usage.turns();
  if (turns.length === 0) return;

  const requestedModel = usage.modelName;
  const resolvedModel = sdkResolvedModel || requestedModel;
  let emitted = 0;

  for (const turn of turns) {
    try {
      const input = buildTurnBillingInput({
        executionId,
        turn,
        requestedModel,
        sdkResolvedModel,
      });
      await client.recordLlmCallUsage(input);
      emitted++;
    } catch (err) {
      console.warn(
        `Failed to emit billing record (non-fatal): execution=${executionId}, seq=${turn.sequence}`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (emitted > 0) {
    const modelInfo = resolvedModel !== requestedModel
      ? `requested=${requestedModel}, resolved=${resolvedModel}`
      : `model=${requestedModel}`;
    console.log(
      `Emitted ${emitted}/${turns.length} billing records: execution=${executionId}, ${modelInfo}`,
    );
  }
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
