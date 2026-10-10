/**
 * GuardReservedLabels — the write-boundary guard for the platform-reserved
 * `stigmer.ai/*` label namespace (the Java GuardReservedLabelsStep port).
 *
 * Reserved labels carry platform semantics the server reads and acts on
 * (the membership and lineage labels): a client that could write one would be
 * writing a platform decision, and any reader trusting the label would be
 * trusting the client. Only rejecting the write closes that; the label is
 * not authorization, the server is.
 *
 * Behavior (the Java matrix verbatim):
 *   - ECHOES pass — clients read-modify-write whole resources, so a
 *     stored reserved label legitimately comes back on honest updates.
 *   - REMOVALS pass — dropping a reserved label only shrinks what it
 *     granted (de-escalation, and the operator cleanup path).
 *   - INTRODUCTIONS and CHANGES reject with INVALID_ARGUMENT (the
 *     boundary rule: server-reserved sentinels are not
 *     accepted from clients) — unless the caller holds
 *     `can_write_reserved_labels` on `platform:stigmer`, consulted
 *     LAZILY through the one composed Authorizer, so normal writes pay
 *     no authorization round-trip. The OSS permissive default allows —
 *     the local posture keeps today's behavior byte-identically; the
 *     cloud's FGA Authorizer supplies the operator gate.
 *   - INTERNAL callers pass (the in-process chain's own composed
 *     requests — the rows the server composes; the TS rendering of Java's
 *     skipAuthorization + isInProcessCall arms).
 *   - No kind takes a reserved key from a client: the one per-kind client
 *     contract (the personal-environment marker) left with the
 *     Environment kind, and a person's own vault is told apart by its
 *     server-stamped owner, never by a label.
 *   - LABELS only, deliberately not annotations (annotations carry no
 *     resolution or authorization semantics).
 *
 * Placement: after BuildNewState/BuildUpdateState — the step inspects the
 * state that will persist, and update chains have LoadExisting's stored
 * labels for echo detection. A push-shaped chain (skill push, whose
 * PushSkillRequest carries `labels`) places it after its populate step and
 * names its own positions (GuardReservedLabelsPositions), since its
 * resource rides a domain key, not newState. The infrastructure-failure arm answers a
 * sanitized INTERNAL (the TS store-fault doctrine, #478) where Java
 * echoes raw exception text — an unpinned outage-lane difference.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMessage, Message } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import { isServerComposedRequest } from "../../extensions/identity.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { metadataOf } from "./shapes.js";

/** The platform-reserved label key namespace (SystemManagedLabels). */
export const RESERVED_LABEL_PREFIX = "stigmer.ai/";

/**
 * The reserved keys `requested` would introduce or change relative to
 * `stored` — the guard's predicate (SystemManagedLabels
 * reservedLabelMutations). Removals and echoes are not mutations.
 */
export function reservedLabelMutations(
  stored: Readonly<Record<string, string>>,
  requested: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  const mutations: string[] = [];
  for (const [key, value] of Object.entries(requested)) {
    if (key.startsWith(RESERVED_LABEL_PREFIX) && stored[key] !== value) {
      mutations.push(key);
    }
  }
  return mutations.sort();
}

/**
 * Where the guard finds the state that will persist and the stored state
 * it is judged against. The create and update chains carry both in the
 * shared positions (`ctx.newState`, EXISTING_RESOURCE_KEY); a push-shaped
 * chain builds its resource from an artifact and rides its own keys, so
 * it names them here. Defaults are the shared positions.
 */
export interface GuardReservedLabelsPositions<Desc extends DescMessage> {
  /** The resource about to persist; defaults to the chain's newState. */
  readonly stateOf?: (ctx: RequestContext<Desc>) => Message | undefined;
  /** The context key the stored resource rides; defaults to EXISTING_RESOURCE_KEY. */
  readonly existingKey?: string;
}

export function newGuardReservedLabelsStep<Desc extends DescMessage>(
  authorizer: Authorizer,
  positions: GuardReservedLabelsPositions<Desc> = {},
): PipelineStep<Desc> {
  const stateOf =
    positions.stateOf ?? ((ctx: RequestContext<Desc>) => ctx.newState);
  const existingKey = positions.existingKey ?? EXISTING_RESOURCE_KEY;
  return {
    name: "GuardReservedLabels",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (isServerComposedRequest(ctx.callerIdentity)) {
        // The Java isInProcessCall arm: the trust decision was
        // made by the service code that built the request, which may stamp
        // reserved labels by design, even when the call propagates the
        // user's identity for attribution.
        return;
      }
      const state = stateOf(ctx);
      const requested =
        state === undefined ? {} : (metadataOf(state)?.labels ?? {});
      const existing = ctx.get(existingKey);
      const stored =
        existing === undefined
          ? {}
          : (metadataOf(existing as Message)?.labels ?? {});

      const mutations = reservedLabelMutations(stored, requested);
      if (mutations.length === 0) {
        return;
      }

      // Lazy operator check — only a request that actually mutates a
      // reserved key ever reaches the Authorizer.
      if (await mayWriteReservedLabels(authorizer, ctx.callerIdentity)) {
        return;
      }
      throw new ConnectError(
        `Labels in the reserved '${RESERVED_LABEL_PREFIX}' namespace ` +
          "are platform-managed and cannot be set or changed by this " +
          `request: ${mutations.join(", ")}. Stored reserved labels ` +
          "may be echoed back unchanged or removed.",
        Code.InvalidArgument,
      );
    },
  };
}

/**
 * The operator question the guard asks of a mutation no step vouched for:
 * does the caller hold `can_write_reserved_labels` on `platform:stigmer`?
 * An authorization outage fails closed as a sanitized Internal (#478),
 * never an answer.
 */
export async function mayWriteReservedLabels(
  authorizer: Authorizer,
  caller: CallerIdentity,
): Promise<boolean> {
  let decision;
  try {
    decision = await authorizer.authorize(caller, {
      permission: IamPermission.can_write_reserved_labels,
      resourceKind: ApiResourceKind.platform,
      resourceId: "stigmer",
    });
  } catch (error) {
    throw reservedLabelCheckFailure(error);
  }
  switch (decision.kind) {
    case "allow":
      return true;
    case "deny":
    case "not-found":
      return false;
    case "unavailable":
      throw reservedLabelCheckFailure(decision.cause);
    default: {
      const exhaustive: never = decision;
      throw reservedLabelCheckFailure(
        new Error(`unknown decision ${JSON.stringify(exhaustive)}`),
      );
    }
  }
}

/** Authorization infrastructure failure: fail closed, sanitized (#478). */
function reservedLabelCheckFailure(error: unknown): ConnectError {
  return internalError(
    error instanceof Error ? error : new Error(String(error)),
    "reserved-label validation could not be completed",
  );
}
