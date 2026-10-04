/**
 * ResolveSessionAgent — pins the agent a conversation runs: writes the
 * agent spec.agent_ref resolves to, and the exact version, onto
 * status.agent_id and status.agent_version_hash. Every turn reaches its
 * agent through that pair by point read, so a version the author saves
 * later never changes an open conversation, and a slug deleted and taken by
 * another agent never redirects it (the share's pin, for the same reason).
 *
 * The rule, on create, update and apply alike:
 *   - a write naming no agent clears the pin: the built-in assistant;
 *   - a version of `latest` pins the agent's current version now (the
 *     reference grammar's meaning), which is how a conversation moves to
 *     the version its author last saved;
 *   - a tag or a content hash pins the version it names, refused when the
 *     agent holds no such version;
 *   - a reference unchanged from the stored one (same organization and
 *     slug), with no version, keeps the stored pin: an edit that echoes the
 *     stored spec moves nothing (the echo rule the reference rule's writer
 *     clause uses for attachments);
 *   - any other reference with no version pins the agent's current version.
 *
 * The agent's id is the one ValidateReferences resolved for this write
 * (RESOLVED_REFERENCE_TARGETS_KEY), so a write pays the one scan the
 * reference rule already paid; the version then resolves by point reads
 * (the agent row, and the audit row by tag or hash). resolveAgentPin is
 * that resolution alone, exported for the turn that starts a new
 * conversation (agent-execution's ResolveRunAgent), whose own reference
 * rule walked session_spec.agent_ref. The step runs after
 * ValidateReferences and before the run gate that asks whether the caller
 * may run the pinned agent, so that gate judges the resolved id, never a
 * slug. Nothing a client sends in status survives to here: BuildNewState
 * cleared it on create, and BuildUpdateState carried the stored status
 * over it on update.
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
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  resolvedReferenceTargets,
  type ReferenceTargets,
} from "../../pipeline/steps/references.js";
import {
  resolveVersionHash,
  truncateHash,
} from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError, type Store } from "../../store/interface.js";
import { agentVersionBinding } from "../agent/versions.js";
import { agentGoneMessage, agentVersionNotFoundMessage } from "./constants.js";

type SessionDesc = typeof SessionSchema;

export function newResolveSessionAgentStep(
  store: Store,
  logger: Logger,
): PipelineStep<SessionDesc> {
  return {
    name: "ResolveSessionAgent",
    async execute(ctx) {
      const session = ctx.newState;
      const status = (session.status ??= create(SessionStatusSchema));
      const ref = session.spec?.agentRef;
      if (ref === undefined || ref.slug === "") {
        status.agentId = "";
        status.agentVersionHash = "";
        return;
      }

      const stored = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      const version = ref.version.trim();
      if (version === "" && keepsStoredPin(stored, ref)) {
        status.agentId = stored?.status?.agentId ?? "";
        status.agentVersionHash = stored?.status?.agentVersionHash ?? "";
        return;
      }

      const pin = await resolveAgentPin(
        store,
        resolvedReferenceTargets(ctx),
        ref,
      );
      status.agentId = pin.agentId;
      status.agentVersionHash = pin.versionHash;
      logger.debug("Pinned the agent version this session runs", {
        agentId: pin.agentId,
        versionHash: truncateHash(pin.versionHash),
      });
    },
  };
}

/** The agent a reference names and the version hash it pins. */
export interface AgentPin {
  readonly agentId: string;
  readonly versionHash: string;
}

/**
 * Resolves a reference the chain's ValidateReferences admitted to the agent
 * it names and the version hash its version names (the module header's
 * rule, without the echo): the id from the targets that step recorded, the
 * version by point reads. Refuses with FAILED_PRECONDITION an agent gone
 * since the scan or a version the agent does not hold; an id the targets do
 * not carry is a chain built out of order (Internal).
 */
export async function resolveAgentPin(
  store: Store,
  targets: ReferenceTargets | undefined,
  ref: ApiResourceReference,
): Promise<AgentPin> {
  const agentId = targets?.idOf({
    kind: ApiResourceKind.agent,
    org: ref.org,
    slug: ref.slug,
  });
  if (agentId === undefined) {
    // ValidateReferences admitted the reference only if its scan found the
    // agent; an id it did not record is a chain built out of order.
    throw internalError(
      new Error(
        "an agent reference was resolved without the targets ValidateReferences records",
      ),
      "failed to resolve the agent this conversation runs",
    );
  }
  const agent = await readAgent(store, agentId);
  if (agent === undefined) {
    throw failedPreconditionError(agentGoneMessage(ref.org, ref.slug));
  }
  const version = ref.version.trim();
  const versionHash = await resolveVersionHash(
    store,
    agentVersionBinding,
    agent,
    version,
  );
  if (versionHash === undefined) {
    throw failedPreconditionError(
      agentVersionNotFoundMessage(ref.org, ref.slug, version),
    );
  }
  return { agentId, versionHash };
}

/**
 * Whether an update's reference echoes the stored one: the same agent by
 * organization and slug, on a session that already holds a pin. A
 * reference that names a version is never an echo (the caller asked for
 * that version); the caller of this function has checked that.
 */
function keepsStoredPin(
  stored: Session | undefined,
  ref: ApiResourceReference,
): boolean {
  const held = stored?.spec?.agentRef;
  return (
    held !== undefined &&
    held.org === ref.org &&
    held.slug === ref.slug &&
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
