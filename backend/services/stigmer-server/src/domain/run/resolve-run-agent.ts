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
 * The recover chain runs newResolveRecoveredRunAgentStep under the same
 * name: a turn created before turns recorded their agent carries no stamp,
 * and recovering it takes the session's pin as what the recovery runs.
 * Its AuthorizeRunAgent (newAuthorizeRecoveredRunAgentStep) then asks
 * whether the caller may still run that agent, as every turn's create
 * does, before the previous workflow is terminated or anything is
 * written; RecordRunAgent (newStampRecoveredRunAgentStep) persists the
 * pin before the context is rebuilt and the workflow starts. Its creation
 * history is never rewritten otherwise, and no reader keeps a route of
 * its own to the agent.
 *
 * Proven by __tests__/resolve-run-agent.test.ts and the agent and session
 * conformance suites' turn arms.
 */
import { clone, create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
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
import { agentExecutionRunAgent } from "./run-target.js";
import { storedSessionOf } from "./session-binding.js";
import { newSessionSpecOf, sessionIdOf } from "./target.js";

type CreateDesc = typeof RunSchema;
type RecoverDesc = typeof RunCommandController.method.recover.input;

export function newResolveRunAgentStep(
  store: Store,
  logger: Logger,
  authorizer: Authorizer,
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
            { authorizer, caller: ctx.callerIdentity },
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
export function stampRunAgent(execution: Run, pin: AgentPin): void {
  execution.status ??= create(RunStatusSchema);
  execution.status.agentId = pin.agentId;
  execution.status.agentVersionHash = pin.versionHash;
}

/** The pin recover resolved for a turn that recorded none, not yet written. */
const RECOVERED_PIN_KEY = "agentexecution.recover.pendingRunAgent";

/**
 * The recover chain's ResolveRunAgent (the module header): right after the
 * execution is loaded and its phase validated, before any side effect, a
 * turn that recorded no agent takes its session's pin, held in memory
 * (RECOVERED_PIN_KEY) for AuthorizeRunAgent to ask about and
 * newStampRecoveredRunAgentStep to write once the question is answered.
 * A turn that recorded an agent, one that names no session, and one whose
 * session pins none are left as they are.
 */
export function newResolveRecoveredRunAgentStep(
  store: Store,
  skip: (ctx: { get(key: string): unknown }) => boolean,
): PipelineStep<RecoverDesc> {
  return {
    name: "ResolveRunAgent",
    async execute(ctx) {
      if (skip(ctx)) {
        return;
      }
      const loaded = loadedExecutionOf(ctx, "ResolveRunAgent");
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
      ctx.set(RECOVERED_PIN_KEY, pin);
    },
  };
}

/**
 * The recover chain's AuthorizeRunAgent: rerunning a turn runs its agent
 * again, so the caller must still be able to run it — agent#can_execute on
 * the turn's stamp, or on the pin ResolveRunAgent holds for a turn that
 * recorded none. It runs before the previous workflow is terminated, the
 * pre-side-effect slot, and any write, so a refused caller changes
 * nothing. A turn of the built-in assistant asks nothing. The edition's
 * lanes are admitted by its Authorizer as the create chain's are
 * (RUN_GATE_CHECKS).
 */
export function newAuthorizeRecoveredRunAgentStep(
  authorizer: Authorizer,
  skip: (ctx: { get(key: string): unknown }) => boolean,
): PipelineStep<RecoverDesc> {
  return {
    name: "AuthorizeRunAgent",
    async execute(ctx) {
      if (skip(ctx)) {
        return;
      }
      const loaded = loadedExecutionOf(ctx, "AuthorizeRunAgent");
      const pending = ctx.get(RECOVERED_PIN_KEY) as AgentPin | undefined;
      const runs =
        pending === undefined ? loaded : stampedCopy(loaded, pending);
      const target = agentExecutionRunAgent(runs);
      if (target === undefined) {
        return;
      }
      await authorizeResolvedResource(
        authorizer,
        ctx.callerIdentity,
        {
          permission: target.permission,
          resourceKind: target.resourceKind,
          resourceId: target.resourceId,
        },
        target.deniedMessage,
      );
    },
  };
}

/**
 * The recover chain's write of the pin ResolveRunAgent held: after the
 * pre-side-effect slot and before the context is rebuilt, persisted on the
 * turn's own row so the runner the fresh workflow starts reads it, and
 * handed on as the loaded execution. Nothing to write is a no-op.
 */
export function newStampRecoveredRunAgentStep(
  store: Store,
  logger: Logger,
  skip: (ctx: { get(key: string): unknown }) => boolean,
): PipelineStep<RecoverDesc> {
  return {
    name: "RecordRunAgent",
    async execute(ctx) {
      if (skip(ctx)) {
        return;
      }
      const pin = ctx.get(RECOVERED_PIN_KEY) as AgentPin | undefined;
      if (pin === undefined) {
        return;
      }
      const loaded = loadedExecutionOf(ctx, "RecordRunAgent");
      const executionId = loaded.metadata?.id ?? "";
      let updated: Run;
      try {
        updated = await store.updateResource(
          ApiResourceKind.run,
          executionId,
          RunSchema,
          (row) => stampRunAgent(row, pin),
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Run", executionId);
        }
        throw internalError(error, "failed to record the agent this turn runs");
      }
      ctx.set(LOADED_EXECUTION_KEY, updated);
      logger.info(
        "Recorded the session's agent on a recovered turn that recorded none",
        {
          executionId,
          agentId: pin.agentId,
          versionHash: truncateHash(pin.versionHash),
        },
      );
    },
  };
}

/** The loaded execution, or Internal when a step runs before the load. */
function loadedExecutionOf(
  ctx: { get(key: string): unknown },
  step: string,
): Run {
  const loaded = ctx.get(LOADED_EXECUTION_KEY) as Run | undefined;
  if (loaded === undefined) {
    throw internalError(
      new Error(`${step} ran before the execution was loaded`),
      "failed to resolve the agent this turn runs",
    );
  }
  return loaded;
}

/** A copy of `execution` carrying `pin` as its stamp; the original is untouched. */
function stampedCopy(execution: Run, pin: AgentPin): Run {
  const copy = clone(RunSchema, execution);
  stampRunAgent(copy, pin);
  return copy;
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
