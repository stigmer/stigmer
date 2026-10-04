/**
 * ResolveRunAgent — stamps the agent a turn runs, and the exact version of
 * it, onto the new execution's status (agent_id, agent_version_hash).
 * Every later reader takes the stamp: the run gate's second question
 * (AuthorizeRunAgent), the context build here and on recover, and the
 * runner's blueprint hydration. So an author saving a new version while
 * the turn is queued or running never changes what runs, and a session
 * repointed afterwards never changes which agent the turn records.
 *
 * The agent is the conversation's, always stamped (empty for the built-in
 * assistant), never read from anything a client sent in status
 * (BuildNewState cleared it):
 *   - a turn in an existing session takes the session's pin
 *     (SessionStatus.agent_id, agent_version_hash), from the row
 *     ValidateSessionOrganization read behind the session's own run gate,
 *     so nothing about the session is read for a caller who may not add to
 *     it. A pinned agent since deleted refuses with FAILED_PRECONDITION
 *     naming the session and the agent (one point read).
 *   - a new conversation takes its session_spec.agent_ref, resolved by the
 *     session's own rule (resolveAgentPin) from the id the turn's
 *     reference rule recorded: that rule walked session_spec.agent_ref.
 *     CreateSessionIfNeeded re-takes the stamp from the session it
 *     creates, whose own chain resolved and gated the same reference, so a
 *     version saved between the two resolutions never leaves a turn and its
 *     session disagreeing.
 *
 * A session id that names no row stamps nothing: the loading steps own
 * that refusal, with its own NotFound. A store fault is Internal.
 *
 * The recover chain runs newStampRecoveredRunAgentStep under the same
 * name: a turn created before turns recorded their agent carries no stamp,
 * and recovering it records the session's pin as what the recovery runs,
 * persisted before the context is rebuilt and the workflow starts. Its
 * creation history is never rewritten otherwise, and no reader keeps a
 * route of its own to the agent.
 *
 * Proven by __tests__/resolve-run-agent.test.ts and the agent and session
 * conformance suites' turn arms.
 */
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { LOADED_EXECUTION_KEY } from "../../pipeline/request-context.js";
import { resolvedReferenceTargets } from "../../pipeline/steps/references.js";
import { truncateHash } from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { resolveAgentPin } from "../session/resolve-session-agent.js";
import type { AgentPin } from "../session/resolve-session-agent.js";

import { sessionAgentGoneMessage } from "./constants.js";
import { storedSessionOf } from "./session-binding.js";
import { newSessionSpecOf, sessionIdOf } from "./target.js";

type CreateDesc = typeof AgentExecutionSchema;
type RecoverDesc = typeof AgentExecutionCommandController.method.recover.input;

export function newResolveRunAgentStep(
  store: Store,
  logger: Logger,
): PipelineStep<CreateDesc> {
  return {
    name: "ResolveRunAgent",
    async execute(ctx) {
      const execution = ctx.newState;
      let pin: AgentPin = { agentId: "", versionHash: "" };

      const sessionId = sessionIdOf(execution.spec);
      if (sessionId !== "") {
        const session = storedSessionOf(ctx);
        if (session === undefined) {
          return;
        }
        pin = {
          agentId: session.status?.agentId ?? "",
          versionHash: session.status?.agentVersionHash ?? "",
        };
        if (
          pin.agentId !== "" &&
          (await readRow(
            store,
            ApiResourceKind.agent,
            pin.agentId,
            AgentSchema,
          )) === undefined
        ) {
          throw failedPreconditionError(
            sessionAgentGoneMessage(sessionId, pin.agentId),
          );
        }
      } else {
        const ref = newSessionSpecOf(execution.spec)?.agentRef;
        if (ref !== undefined && ref.slug !== "") {
          pin = await resolveAgentPin(
            store,
            resolvedReferenceTargets(ctx),
            ref,
          );
        }
      }

      stampRunAgent(execution, pin);
      if (pin.agentId !== "") {
        logger.debug("Stamped the agent version this turn runs", {
          agentId: pin.agentId,
          versionHash: truncateHash(pin.versionHash),
        });
      }
    },
  };
}

/** Writes the agent a turn runs onto its status: the one writer of the pair. */
export function stampRunAgent(execution: AgentExecution, pin: AgentPin): void {
  execution.status ??= create(AgentExecutionStatusSchema);
  execution.status.agentId = pin.agentId;
  execution.status.agentVersionHash = pin.versionHash;
}

/**
 * The recover chain's ResolveRunAgent (the module header): after the
 * execution is loaded and before its context is rebuilt, a turn that
 * recorded no agent records its session's pin, persisted on its own row so
 * the runner the fresh workflow starts reads it. A turn that recorded an
 * agent, or whose session pins none, is left as it is.
 */
export function newStampRecoveredRunAgentStep(
  store: Store,
  logger: Logger,
  skip: (ctx: { get(key: string): unknown }) => boolean,
): PipelineStep<RecoverDesc> {
  return {
    name: "ResolveRunAgent",
    async execute(ctx) {
      if (skip(ctx)) {
        return;
      }
      const loaded = ctx.get(LOADED_EXECUTION_KEY) as
        | AgentExecution
        | undefined;
      if (loaded === undefined) {
        throw internalError(
          new Error("ResolveRunAgent ran before the execution was loaded"),
          "failed to resolve the agent this turn runs",
        );
      }
      if ((loaded.status?.agentId ?? "") !== "") {
        return;
      }
      const sessionId = sessionIdOf(loaded.spec);
      if (sessionId === "") {
        return;
      }
      const session = await readRow(
        store,
        ApiResourceKind.session,
        sessionId,
        SessionSchema,
      );
      const agentId = session?.status?.agentId ?? "";
      if (agentId === "") {
        return;
      }
      const pin: AgentPin = {
        agentId,
        versionHash: session?.status?.agentVersionHash ?? "",
      };
      const executionId = loaded.metadata?.id ?? "";
      let updated: AgentExecution;
      try {
        updated = await store.updateResource(
          ApiResourceKind.agent_execution,
          executionId,
          AgentExecutionSchema,
          (row) => stampRunAgent(row, pin),
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("agent_execution", executionId);
        }
        throw internalError(error, "failed to record the agent this turn runs");
      }
      ctx.set(LOADED_EXECUTION_KEY, updated);
      logger.info(
        "Recorded the session's agent on a recovered turn that recorded none",
        {
          executionId,
          agentId,
          versionHash: truncateHash(pin.versionHash),
        },
      );
    },
  };
}

/** A point read whose absence is a normal outcome here; a store fault is Internal. */
async function readRow<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  id: string,
  schema: Desc,
): Promise<MessageShape<Desc> | undefined> {
  try {
    return await store.getResource(kind, id, schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw internalError(error, "failed to resolve the agent this turn runs");
  }
}
