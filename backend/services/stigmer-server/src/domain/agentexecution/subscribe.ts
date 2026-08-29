/**
 * Subscribe — ports controller/subscribe.go: the real-time execution
 * stream (ADR 011 read path). The first DOMAIN server-streaming RPC on
 * the TS server; the generator shape follows transport/health.ts watch,
 * the transport's proven streaming idiom.
 *
 * Go drives the stream from inside a two-step pipeline by smuggling the
 * gRPC stream object through the request context; ConnectRPC models
 * server streams as async generators, which cannot yield from inside the
 * pipeline executor — so the validate step collapses to the same guard
 * inline and the StreamExecution step's body IS this generator. Every
 * delivery rule ports verbatim:
 *
 *   - REGISTER-BEFORE-SNAPSHOT (the gap fix): the broker registration
 *     happens before the snapshot read. Store writes serialize under the
 *     per-resource write lock and UpdateStatus broadcasts only after its
 *     persist commits, so any commit the snapshot missed broadcasts after
 *     our registration — nothing lands in the old lossy window.
 *   - The overlap frame (a commit the snapshot DID observe) arrives
 *     value-equal to the snapshot; the consecutive-duplicate guard drops
 *     it (Go sameFrame/proto.Equal) so clients never re-render an
 *     identical state.
 *   - The stream ends on a terminal BROADCAST frame; a terminal SNAPSHOT
 *     leaves the stream open (Go sends the snapshot and parks in the
 *     loop). Faithful port.
 *   - Subscribe's terminal set is COMPLETED/FAILED/CANCELLED — it OMITS
 *     TERMINATED, so a stream over a terminated execution never
 *     self-closes. Known Go quirk, ported byte-faithfully; disclosed as a
 *     both-editions issue candidate at the sub-project wrap-up.
 *   - Registration and the loop share one owner so the unsubscribe fires
 *     on every exit path (Go's defer → the generator's finally, which
 *     ConnectRPC runs on client disconnect too).
 */
import { equals } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecutionId } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import {
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import type { Store } from "../../store/interface.js";

import { isTranscriptTerminalPhase } from "./phases.js";
import type { StreamBroker } from "./stream-broker.js";

export interface SubscribeDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly broker: StreamBroker;
  /** The composed authorization seam — the pre-stream check below (C2 Stage 4). */
  readonly authorizer: Authorizer;
}

export async function* subscribeExecution(
  deps: SubscribeDeps,
  executionId: AgentExecutionId,
  context: HandlerContext,
): AsyncGenerator<AgentExecution> {
  // Go ValidateSubscribeInputStep.
  if (executionId.value === "") {
    throw invalidArgumentError("execution id is required");
  }
  // The annotation's can_view check, once at subscription start — the
  // Java AgentExecutionSubscribeHandler order (validate → authorize).
  // The composed authorizer's guest-isolation arm rides this same check
  // (the G2 per-visitor cookie match), matching Java's GuestVisitorScope
  // filter on this stream. C2 Stage 4.
  await authorizeDirect(
    AgentExecutionQueryController.method.subscribe,
    deps.authorizer,
    callerIdentityOf(context),
    executionId,
  );
  const id = executionId.value;
  deps.logger.info("Starting execution subscription", { executionId: id });

  // Register FIRST so no broadcast can slip through the window before the
  // snapshot read (the happens-before argument in the module header).
  const subscription = deps.broker.subscribe(id);
  try {
    let snapshot: AgentExecution;
    try {
      snapshot = await deps.store.getResource(
        ApiResourceKind.agent_execution,
        id,
        AgentExecutionSchema,
      );
    } catch {
      // Go converts every load failure here to the same NotFound.
      throw notFoundError("AgentExecution", id);
    }

    yield snapshot;
    deps.logger.debug("Sent initial execution state, streaming live updates", {
      executionId: id,
    });

    // The consecutive-duplicate anchor (Go lastSent).
    let lastSent = snapshot;

    const abort = new Promise<void>((resolve) => {
      context.signal.addEventListener("abort", () => resolve(), {
        once: true,
      });
    });

    while (!context.signal.aborted) {
      if (subscription.closed) {
        // Go's closed-channel arm: end quietly.
        deps.logger.warn("Updates channel closed unexpectedly", {
          executionId: id,
        });
        return;
      }
      if (subscription.queue.length === 0) {
        await Promise.race([
          abort,
          new Promise<void>((resolve) => (subscription.notify = resolve)),
        ]);
        subscription.notify = undefined;
        continue;
      }

      const updated = subscription.queue.shift();
      if (updated === undefined) {
        continue;
      }
      // Suppress the at-or-before-snapshot overlap frame (and any other
      // exact repeat) so the client never re-renders an identical state.
      if (equals(AgentExecutionSchema, updated, lastSent)) {
        continue;
      }

      yield updated;
      lastSent = updated;

      // Subscribe's close set is the NARROW transcript-terminal set
      // (phases.ts) — TERMINATED absent, the disclosed quirk.
      const phase =
        updated.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      if (isTranscriptTerminalPhase(phase)) {
        deps.logger.info(
          "Execution reached terminal state, ending subscription",
          { executionId: id, phase: ExecutionPhase[phase] },
        );
        return;
      }
    }
    deps.logger.info("Subscription cancelled by client", { executionId: id });
  } finally {
    deps.broker.unsubscribe(id, subscription);
  }
}
