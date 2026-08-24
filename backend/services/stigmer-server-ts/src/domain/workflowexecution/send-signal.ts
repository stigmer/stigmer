/**
 * SendSignal — ports send_signal.go: signal delivery to a LISTEN task via
 * SignalWithStart (race-proof for PENDING executions), with the two-phase
 * idempotency-key dedupe (oss#442, shared contract with the cloud
 * edition).
 *
 * The signal channels for signal-receiving tasks live in the TS child
 * workflow, not the orchestrator; the orchestrator exposes one generic
 * relaySignal handler, so the user's signal is wrapped in the relay
 * envelope and sent on the relaySignal channel (mirroring
 * SubmitWorkflowTaskApproval, the other relay-based sender).
 *
 * Codes (pinned): InvalidArgument (missing fields), NotFound (unknown
 * execution), FailedPrecondition (terminal phase, or no engine),
 * AlreadyExists (DELIVERED duplicate — stop retrying), Aborted (live
 * in-flight claim — retry shortly). Dedupe-store errors degrade to
 * no-dedupe rather than failing the send; a failed send RELEASES the
 * claim (status-guarded) so the retry claims freshly instead of waiting
 * out the in-flight hold.
 */
import type { JsonValue } from "@bufbuild/protobuf";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { SendSignalInput } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  abortedError,
  alreadyExistsError,
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { IN_FLIGHT_CLAIM_TTL_MS } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

import {
  RELAY_SIGNAL_CHANNEL_NAME,
  WORKFLOW_CREATOR_UNAVAILABLE_MESSAGE,
} from "./constants.js";
import type { WorkflowExecutionEngineStateProvider } from "./engine.js";

export interface SendSignalDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly engineState: WorkflowExecutionEngineStateProvider;
}

type SendSignalDesc =
  typeof WorkflowExecutionCommandController.method.sendSignal.input;

// Context keys (send_signal.go).
const LOADED_EXECUTION_KEY = "loadedExecution";
const DEDUPE_CLAIMED_KEY = "dedupe_claimed";
const DEDUPE_SKIPPED_KEY = "dedupe_skipped";

export async function sendSignal(
  deps: SendSignalDeps,
  input: SendSignalInput,
): Promise<WorkflowExecution> {
  const reqCtx = new RequestContext(
    WorkflowExecutionCommandController.method.sendSignal.input,
    input,
    ApiResourceKind.workflow_execution,
  );

  const pipeline = newPipeline<SendSignalDesc>(
    "workflowexecution-send-signal",
    deps.logger,
  )
    .addStep({
      name: "ValidateSignalInput",
      execute(ctx) {
        if (ctx.input.executionId === "") {
          throw invalidArgumentError("execution_id is required");
        }
        if (ctx.input.signalName === "") {
          throw invalidArgumentError("signal_name is required");
        }
      },
    })
    .addStep({
      name: "LoadExecutionByExecutionId",
      async execute(ctx) {
        let execution: WorkflowExecution;
        try {
          execution = await deps.store.getResource(
            ApiResourceKind.workflow_execution,
            ctx.input.executionId,
            WorkflowExecutionSchema,
          );
        } catch {
          throw notFoundError("workflow_execution", ctx.input.executionId);
        }
        ctx.set(LOADED_EXECUTION_KEY, execution);
      },
    })
    .addStep({
      name: "ValidateSignalable",
      execute(ctx) {
        const execution = ctx.get(LOADED_EXECUTION_KEY) as WorkflowExecution;
        const phase =
          execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
        // PENDING is signalable — SignalWithStart starts the workflow
        // first when it has not begun yet.
        if (
          phase !== ExecutionPhase.EXECUTION_PENDING &&
          phase !== ExecutionPhase.EXECUTION_IN_PROGRESS
        ) {
          throw failedPreconditionError(
            `cannot send signal to execution in phase ${ExecutionPhase[phase]}; only PENDING or IN_PROGRESS executions can receive signals`,
          );
        }
      },
    })
    .addStep({
      name: "DedupeClaimStep",
      async execute(ctx) {
        const idempotencyKey = ctx.input.idempotencyKey;
        // No key → no dedupe (backward compatible).
        if (idempotencyKey === "") {
          ctx.set(DEDUPE_SKIPPED_KEY, true);
          return;
        }
        const execution = ctx.get(LOADED_EXECUTION_KEY) as WorkflowExecution;
        const org = execution.metadata?.org ?? "";
        const executionId = execution.metadata?.id ?? "";

        let result;
        try {
          result = await deps.store.signalDedupe.claim(
            org,
            idempotencyKey,
            executionId,
            ctx.input.signalName,
            IN_FLIGHT_CLAIM_TTL_MS,
          );
        } catch (error) {
          // A claim-store error degrades to no-dedupe rather than failing
          // the request (Go's graceful-degradation arm).
          deps.logger.error("Failed to claim idempotency key", {
            executionId,
            idempotencyKey,
            error: error instanceof Error ? error.message : String(error),
          });
          ctx.set(DEDUPE_SKIPPED_KEY, true);
          return;
        }

        if (result.status === "DUPLICATE") {
          if (result.record?.status === "DELIVERED") {
            // True duplicate: the signal already landed — stop retrying.
            throw alreadyExistsError(
              "signal_with_idempotency_key",
              idempotencyKey,
            );
          }
          // Live in-flight claim: retryable conflict; it resolves when
          // that delivery settles or its short hold lapses.
          throw abortedError(
            `signal with idempotency_key "${idempotencyKey}" is currently being delivered; retry shortly`,
          );
        }
        ctx.set(DEDUPE_CLAIMED_KEY, true);
      },
    })
    .addStep({
      name: "SendSignalToWorkflow",
      async execute(ctx) {
        const engineState = deps.engineState();
        if (!engineState.connected) {
          throw failedPreconditionError(WORKFLOW_CREATOR_UNAVAILABLE_MESSAGE);
        }
        const execution = ctx.get(LOADED_EXECUTION_KEY) as WorkflowExecution;
        const executionId = execution.metadata?.id ?? "";

        // The relay envelope (Go workflows.RelaySignalPayload JSON shape).
        const relayPayload: JsonValue = {
          signalName: ctx.input.signalName,
          payload: (ctx.input.payload as JsonValue | undefined) ?? null,
        };

        try {
          await engineState.engine.signalWithStart(
            {
              executionId,
              workflowInstanceId: execution.spec?.workflowInstanceId ?? "",
              workflowId: execution.spec?.workflowId ?? "",
              orgId: execution.metadata?.org ?? "",
              recoveryMode: false,
              executionTarget: execution.spec?.executionTarget ?? 0,
            },
            RELAY_SIGNAL_CHANNEL_NAME,
            relayPayload,
          );
        } catch (error) {
          throw internalError(error, "failed to send signal to workflow");
        }
      },
    })
    .addStep({
      name: "DedupeMarkDeliveredStep",
      async execute(ctx) {
        if (ctx.get(DEDUPE_SKIPPED_KEY) === true) {
          return;
        }
        if (ctx.get(DEDUPE_CLAIMED_KEY) !== true) {
          return;
        }
        const execution = ctx.get(LOADED_EXECUTION_KEY) as WorkflowExecution;
        const org = execution.metadata?.org ?? "";
        try {
          // Delivery earns the 24h window (oss#442).
          await deps.store.signalDedupe.markDelivered(
            org,
            ctx.input.idempotencyKey,
          );
        } catch (error) {
          // The signal already landed — never fail the request here.
          deps.logger.warn(
            "Failed to mark idempotency key as delivered (signal was sent)",
            {
              executionId: execution.metadata?.id ?? "",
              idempotencyKey: ctx.input.idempotencyKey,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      },
    })
    .build();

  try {
    await pipeline.execute(reqCtx);
  } catch (error) {
    // The only step that can fail after the claim landed is the send
    // itself — release the claim so the caller's retry with the same key
    // claims freshly instead of being rejected (oss#442). Best-effort: a
    // release failure is logged and swallowed; the stranded claim
    // self-heals when its in-flight hold lapses.
    await releaseDedupeClaimAfterFailure(deps, reqCtx, input);
    throw error;
  }

  const execution = reqCtx.get(LOADED_EXECUTION_KEY);
  if (execution === undefined) {
    throw internalError(
      new Error("execution not found in context after send signal pipeline"),
      "execution not found in context after send signal pipeline",
    );
  }
  return execution as WorkflowExecution;
}

async function releaseDedupeClaimAfterFailure(
  deps: SendSignalDeps,
  reqCtx: RequestContext<SendSignalDesc>,
  input: SendSignalInput,
): Promise<void> {
  if (reqCtx.get(DEDUPE_CLAIMED_KEY) !== true) {
    return;
  }
  const execution = reqCtx.get(LOADED_EXECUTION_KEY) as
    | WorkflowExecution
    | undefined;
  if (execution === undefined) {
    // The claim step runs after the load step, so a claimed key implies a
    // loaded execution; unreachable in practice.
    return;
  }
  try {
    await deps.store.signalDedupe.release(
      execution.metadata?.org ?? "",
      input.idempotencyKey,
    );
  } catch (error) {
    deps.logger.warn(
      "Failed to release idempotency key after failed delivery (claim self-heals when its hold lapses)",
      {
        executionId: input.executionId,
        idempotencyKey: input.idempotencyKey,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
