/**
 * ResolveSessionAgent — pins the agent a conversation runs: writes the
 * agent spec.agent_ref resolves to, and the exact version, onto
 * status.agent_id and status.agent_version_hash. Every turn reaches its
 * agent through that pair by point read, so a version the author saves
 * later never changes an open conversation, and a slug deleted and taken by
 * another agent never redirects it.
 *
 * The rule, on create, update and apply alike:
 *   - a write naming no agent clears the pin: the built-in assistant. A
 *     stored row that names none either keeps its pin (an echo): a
 *     session the agent-instance migration left holding only the id of an
 *     agent since deleted stays that agent's, and fails its next turn;
 *   - a version of `latest` pins the agent's current version now (the
 *     reference grammar's meaning), which is how a conversation moves to
 *     the version its author last saved. `latest` is an instruction, not a
 *     state: the stored reference keeps no version, so a later echo of the
 *     stored spec cannot move the conversation again;
 *   - a reference unchanged from the stored one (same organization, agent
 *     id and version) keeps the stored pin: an edit that echoes the stored
 *     spec moves nothing, whoever sends it (a person editing the
 *     conversation's tools, the runner recording its harness state) and
 *     even when the tag it names has moved since (the echo rule the
 *     reference rule's writer clause uses for attachments);
 *   - any other reference pins the version it names — a tag or a content
 *     hash, refused when the agent holds no such version — or, with no
 *     version, the agent's current version.
 *
 * The agent's id is the reference's own: NormalizeReferences resolved a
 * written slug to it, so an agent deleted and remade under its name is a
 * different id, judged by the reference rule as any reference a write
 * introduces, and a conversation pinned to the deleted one fails its next
 * turn naming it. The version then resolves by point reads (the agent row,
 * and the audit row by tag or hash). resolveAgentPin is
 * that resolution alone, exported for the turn that starts a new
 * conversation (agent-execution's ResolveRunAgent), whose own reference
 * rule walked session_spec.agent_ref. The step runs after
 * ValidateReferences and before the run gate that asks whether the caller
 * may run the pinned agent, so that gate judges the resolved id, never a
 * slug. Nothing a client sends in status survives to here: BuildNewState
 * cleared it on create, and BuildUpdateState carried the stored status
 * over it on update.
 *
 * An update that names no engine keeps the conversation's stored one, so a
 * caller re-applying a session it created (a retry) never
 * resets the engine its agent's defaults chose; the same holds when the
 * write keeps the stored pin. A new conversation that names no engine starts on the engine its agent's
 * pinned version names (AgentSpec.harness), the engine the agent's run
 * defaults were chosen for: the request's engine first, then the agent's,
 * then the platform default (native, the core's reading of unset). A turn
 * that starts a conversation naming a model but no engine has already named
 * native here (agentexecution's ResolveRunConfig), since its model was
 * checked against native. Only on
 * create: a stored conversation keeps the engine it started on
 * (session/steps.ts refuses a change once a turn has run), so a re-pin to a
 * version naming another engine changes new conversations only.
 *
 * Proven by __tests__/resolve-session-agent.test.ts and the session
 * conformance suite's pin arms.
 */
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type {
  Session,
  SessionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import {
  failedPreconditionError,
  internalError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  resolveVersionHash,
  truncateHash,
} from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError, type Store } from "../../store/interface.js";
import { readRunAgentSpec } from "../agent/run-defaults.js";
import { agentVersionBinding } from "../agent/versions.js";
import {
  agentGoneMessage,
  agentVersionNotFoundMessage,
  runAgentDeniedMessage,
} from "./constants.js";

type SessionDesc = typeof SessionSchema;

export function newResolveSessionAgentStep(
  store: Store,
  logger: Logger,
  authorizer: Authorizer,
): PipelineStep<SessionDesc> {
  return {
    name: "ResolveSessionAgent",
    async execute(ctx) {
      const session = ctx.newState;
      const status = (session.status ??= create(SessionStatusSchema));
      keepStoredEngine(
        session,
        ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined,
      );
      const ref = session.spec?.agentRef;
      if (ref === undefined || !namesAgent(ref)) {
        const stored = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
        if (!namesAgent(stored?.spec?.agentRef)) {
          // Neither names an agent: an echo. The stored pin stands, which
          // is the built-in assistant's empty pin, or a migrated session's
          // agent that left before the migration could name it (its next
          // turn fails naming the agent, as any deletion's does).
          status.agentId = stored?.status?.agentId ?? "";
          status.agentVersionHash = stored?.status?.agentVersionHash ?? "";
          return;
        }
        status.agentId = "";
        status.agentVersionHash = "";
        return;
      }

      const stored = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      const version = ref.version.trim();
      if (version !== LATEST && keepsStoredPin(stored, ref, version)) {
        status.agentId = stored?.status?.agentId ?? "";
        status.agentVersionHash = stored?.status?.agentVersionHash ?? "";
        return;
      }

      const pin = await resolveAgentPin(store, ref, {
        authorizer,
        caller: ctx.callerIdentity,
      });
      if (version === LATEST) {
        ref.version = "";
      }
      status.agentId = pin.agentId;
      status.agentVersionHash = pin.versionHash;
      if (
        stored === undefined &&
        session.spec !== undefined &&
        session.spec.harness === Harness.UNSPECIFIED
      ) {
        const agentSpec = await readRunAgentSpec(store, pin.agentId, pin.versionHash);
        session.spec.harness = agentSpec?.harness ?? Harness.UNSPECIFIED;
      }
      logger.debug("Pinned the agent version this session runs", {
        agentId: pin.agentId,
        versionHash: truncateHash(pin.versionHash),
      });
    },
  };
}

/** An update naming no engine keeps the stored conversation's (the module header). */
function keepStoredEngine(session: Session, stored: Session | undefined): void {
  if (
    stored !== undefined &&
    session.spec !== undefined &&
    session.spec.harness === Harness.UNSPECIFIED
  ) {
    session.spec.harness = stored.spec?.harness ?? Harness.UNSPECIFIED;
  }
}

/** The reference grammar's name for an agent's current version. */
const LATEST = "latest";

/** The agent a reference names and the version hash it pins. */
export interface AgentPin {
  readonly agentId: string;
  readonly versionHash: string;
}

/** Who asks for a pin. */
export interface PinAsker {
  readonly authorizer: Authorizer;
  readonly caller: CallerIdentity;
}

/**
 * Resolves a reference the chain's NormalizeReferences resolved and its
 * ValidateReferences admitted to the agent it names (its id) and the
 * version hash its version names (the module header's rule, without the
 * echo), by point reads. Refuses with FAILED_PRECONDITION an agent that is
 * gone (a reference whose id no agent of its organization holds, or one
 * still written by a name nothing held) or a version the agent does not
 * hold — the latter only to a caller who may run the agent, so a caller
 * who may not learns nothing about its versions (the run gate's own denial
 * answers them).
 */
export async function resolveAgentPin(
  store: Store,
  ref: ApiResourceReference,
  asker: PinAsker,
): Promise<AgentPin> {
  const agentId = ref.id;
  const agent = agentId === "" ? undefined : await readAgent(store, agentId);
  if (agent === undefined || (agent.metadata?.org ?? "") !== ref.org) {
    throw failedPreconditionError(
      agentGoneMessage(ref.org, ref.slug !== "" ? ref.slug : ref.id),
    );
  }
  const version = ref.version.trim();
  const versionHash = await resolveVersionHash(
    store,
    agentVersionBinding,
    agent,
    version,
  );
  if (versionHash === undefined) {
    await authorizeResolvedResource(
      asker.authorizer,
      asker.caller,
      {
        permission: IamPermission.can_execute,
        resourceKind: ApiResourceKind.agent,
        resourceId: agentId,
      },
      runAgentDeniedMessage(agentId),
    );
    throw failedPreconditionError(
      agentVersionNotFoundMessage(ref.org, agent.metadata?.slug ?? "", version),
    );
  }
  return { agentId, versionHash };
}

/** Whether a reference names an agent at all, by id or by a name nothing held. */
function namesAgent(ref: ApiResourceReference | undefined): boolean {
  return ref !== undefined && (ref.id !== "" || ref.slug !== "");
}

/**
 * Whether an update's reference echoes the stored one: the same agent by
 * organization and id (or, for a reference still written by a name nothing
 * held, that name), naming the same version (none, a tag or a hash), on a
 * session that already holds a pin. `latest` is never an echo; the caller
 * of this function has checked that.
 */
function keepsStoredPin(
  stored: Session | undefined,
  ref: ApiResourceReference,
  version: string,
): boolean {
  const held = stored?.spec?.agentRef;
  return (
    held !== undefined &&
    held.org === ref.org &&
    held.id === ref.id &&
    (held.id !== "" || held.slug === ref.slug) &&
    held.version.trim() === version &&
    (stored?.status?.agentId ?? "") !== ""
  );
}

/** The agent row by id; absent when it has gone, a store fault Internal. */
async function readAgent(
  store: Store,
  agentId: string,
): Promise<Agent | undefined> {
  try {
    return await store.getResource(ApiResourceKind.agent, agentId, AgentSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw internalError(
      error,
      "failed to resolve the agent this conversation runs",
    );
  }
}
