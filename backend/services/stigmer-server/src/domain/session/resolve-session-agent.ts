/**
 * ResolveSessionAgent — pins the agent a conversation runs: writes the
 * agent spec.agent_ref resolves to, and the exact version, onto
 * status.agent_id and status.agent_version_hash. Every turn reaches its
 * agent through that pair by point read, so a version the author saves
 * later never changes an open conversation, and a slug deleted and taken by
 * another agent never redirects it (the share's pin, for the same reason).
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
 *   - a reference unchanged from the stored one (same organization, slug
 *     and version) keeps the stored pin: an edit that echoes the stored
 *     spec moves nothing, whoever sends it (a person editing the
 *     conversation's tools, the runner recording its harness state) and
 *     even when the tag it names has moved since (the echo rule the
 *     reference rule's writer clause uses for attachments);
 *   - any other reference pins the version it names — a tag or a content
 *     hash, refused when the agent holds no such version — or, with no
 *     version, the agent's current version.
 *
 * The agent's id is the one the stored row already pins under the same
 * organization and slug — the conversation's agent, kept by id — else the
 * one ValidateReferences resolved for this write
 * (RESOLVED_REFERENCE_TARGETS_KEY), so a write pays at most the one scan
 * the reference rule already paid; the version then resolves by point reads
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
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
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
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  checkReferences,
  resolvedReferenceTargets,
  type ReferenceTargets,
} from "../../pipeline/steps/references.js";
import {
  resolveVersionHash,
  truncateHash,
} from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError, type Store } from "../../store/interface.js";
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
      const ref = session.spec?.agentRef;
      if (ref === undefined || ref.slug === "") {
        const stored = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
        if ((stored?.spec?.agentRef?.slug ?? "") === "") {
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

      const pin = await resolveAgentPin(
        store,
        resolvedReferenceTargets(ctx),
        ref,
        {
          authorizer,
          caller: ctx.callerIdentity,
          heldAgentId: heldAgentIdOf(stored, ref),
          judgeResolvedAgain: async () => {
            // The write names the slug again, but the reference rule
            // passed it over as one the stored row carries: judge it now,
            // as a reference this write introduces.
            const refusal = await checkReferences(
              store,
              {
                org: session.metadata?.org ?? "",
                visibility:
                  session.metadata?.visibility ??
                  ApiResourceVisibility.visibility_private,
              },
              [{ kind: ApiResourceKind.agent, org: ref.org, slug: ref.slug }],
              { authorizer, caller: ctx.callerIdentity, stored: [] },
            );
            if (refusal !== undefined) {
              throw refusal;
            }
          },
        },
      );
      if (version === LATEST) {
        ref.version = "";
      }
      status.agentId = pin.agentId;
      status.agentVersionHash = pin.versionHash;
      logger.debug("Pinned the agent version this session runs", {
        agentId: pin.agentId,
        versionHash: truncateHash(pin.versionHash),
      });
    },
  };
}

/** The reference grammar's name for an agent's current version. */
const LATEST = "latest";

/** The agent a reference names and the version hash it pins. */
export interface AgentPin {
  readonly agentId: string;
  readonly versionHash: string;
}

/** Who asks for a pin, and the agent the stored row already pins under the same name. */
export interface PinAsker {
  readonly authorizer: Authorizer;
  readonly caller: CallerIdentity;
  /**
   * The agent id the stored session pins when the reference names the same
   * organization and slug as the stored one: the conversation's agent, kept
   * by id, never resolved by its slug again (so a slug taken by another
   * agent never redirects it, and an unchanged name costs no scan). Only
   * when that agent is gone does a write that names its slug again resolve
   * the slug to the agent that holds it now, judged first by
   * judgeResolvedAgain.
   */
  readonly heldAgentId?: string;
  /**
   * The reference rule over the reference, for the agent a slug resolves
   * to when the held agent is gone: the chain's ValidateReferences passed
   * the reference over as one the stored row already carries, so the
   * agent that holds the slug now was never judged. Throws its refusal.
   */
  readonly judgeResolvedAgain?: () => Promise<void>;
}

/**
 * Resolves a reference the chain's ValidateReferences admitted to the agent
 * it names and the version hash its version names (the module header's
 * rule, without the echo): the id the stored row holds under the same name,
 * else the id from the targets that step recorded; the version by point
 * reads. Refuses with FAILED_PRECONDITION an agent gone since the scan or a
 * version the agent does not hold — the latter only to a caller who may run
 * the agent, so a caller who may not learns nothing about its versions (the
 * run gate's own denial answers them). An id neither source carries is a
 * chain built out of order (Internal).
 */
export async function resolveAgentPin(
  store: Store,
  targets: ReferenceTargets | undefined,
  ref: ApiResourceReference,
  asker: PinAsker,
): Promise<AgentPin> {
  const held = asker.heldAgentId ?? "";
  const named = targets?.idOf({
    kind: ApiResourceKind.agent,
    org: ref.org,
    slug: ref.slug,
  });
  let agentId = held !== "" ? held : named;
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
  let agent = await readAgent(store, agentId);
  if (agent === undefined && held !== "") {
    // The conversation's agent is gone. This write names its slug again
    // and is no echo (an echo kept the pin before this), so it names
    // whichever agent holds the slug now; the run gate then asks about
    // that agent, whose id differs from the stored pin.
    const now =
      named ??
      (
        await findResourceBySlug(
          store,
          ApiResourceKind.agent,
          AgentSchema,
          ref.slug,
          ref.org,
        )
      )?.metadata?.id;
    if (now !== undefined && now !== "" && now !== held) {
      await asker.judgeResolvedAgain?.();
      agentId = now;
      agent = await readAgent(store, now);
    }
  }
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
      agentVersionNotFoundMessage(ref.org, ref.slug, version),
    );
  }
  return { agentId, versionHash };
}

/** The agent the stored session pins under the reference's own name, if any. */
export function heldAgentIdOf(
  stored: Session | undefined,
  ref: ApiResourceReference,
): string | undefined {
  const held = stored?.spec?.agentRef;
  return held !== undefined && held.org === ref.org && held.slug === ref.slug
    ? stored?.status?.agentId
    : undefined;
}

/**
 * Whether an update's reference echoes the stored one: the same agent by
 * organization and slug, naming the same version (none, a tag or a hash),
 * on a session that already holds a pin. `latest` is never an echo; the
 * caller of this function has checked that.
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
    held.slug === ref.slug &&
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
