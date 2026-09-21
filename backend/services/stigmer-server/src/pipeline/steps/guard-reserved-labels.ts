/**
 * GuardReservedLabels — the write-boundary guard for the platform-reserved
 * `stigmer.ai/*` label namespace (the Java GuardReservedLabelsStep port,
 * cloud#320/#386; C2 Stage 3, 20260827.10).
 *
 * Reserved labels carry platform semantics the server reads and acts on
 * (the personal-environment marker, the default-instance marker, the
 * membership and lineage labels): a client that could write one would be
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
 *     cloud#229 boundary doctrine: server-reserved sentinels are not
 *     accepted from clients) — unless the caller holds
 *     `can_write_reserved_labels` on `platform:stigmer`, consulted
 *     LAZILY through the one composed Authorizer, so normal writes pay
 *     no authorization round-trip. The OSS permissive default allows —
 *     the local posture keeps today's behavior byte-identically; the
 *     cloud's FGA Authorizer supplies the operator gate.
 *   - INTERNAL callers pass (the in-process chain's own composed
 *     requests — default-instance factories, managed environments; the
 *     TS rendering of Java's skipAuthorization + isInProcessCall arms).
 *   - PER-KIND CLIENT CONTRACTS pass: `stigmer.ai/personal` on
 *     Environment, which the console legitimately sends on create — the
 *     one allowlist entry, kept here with the doctrine so widening it is
 *     one reviewable diff.
 *   - SERVER-STAMPED KEYS pass (server-stamped-reserved-labels.ts, the
 *     Java ServerStampedReservedLabels arm, cloud#386): a step that made
 *     the trust decision for specific keys on THIS request records
 *     exactly those keys, and the guard exempts exactly them (the
 *     agentexecution create chain's RecordRunnerLineageLabels is the
 *     first recorder — parity entry 20260830.05).
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
import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { serverStampedReservedLabels } from "./server-stamped-reserved-labels.js";
import { metadataOf } from "./shapes.js";

/** The platform-reserved label key namespace (SystemManagedLabels). */
export const RESERVED_LABEL_PREFIX = "stigmer.ai/";

/**
 * The reserved keys clients may legitimately write per kind — the one
 * entry today is the personal-environment marker the console sends on
 * create (the Java CLIENT_CONTRACT_ALLOWLIST verbatim).
 */
const CLIENT_CONTRACT_ALLOWLIST: ReadonlyMap<
  ApiResourceKind,
  ReadonlySet<string>
> = new Map([[ApiResourceKind.environment, new Set(["stigmer.ai/personal"])]]);

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
        // The Java isInProcessCall arm (cloud#386): the trust decision was
        // made by the service code that built the request — default-instance
        // factories stamp reserved labels by design, even when the call
        // propagates the user's identity for attribution (ruling R5).
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

      const allowlist =
        CLIENT_CONTRACT_ALLOWLIST.get(ctx.apiResourceKind) ?? new Set();
      const stamped = serverStampedReservedLabels(ctx);
      const mutations = reservedLabelMutations(stored, requested).filter(
        (key) => !allowlist.has(key) && !stamped.has(key),
      );
      if (mutations.length === 0) {
        return;
      }

      // Lazy operator check — only a request that actually mutates a
      // reserved key ever reaches the Authorizer.
      let decision;
      try {
        decision = await authorizer.authorize(ctx.callerIdentity, {
          permission: IamPermission.can_write_reserved_labels,
          resourceKind: ApiResourceKind.platform,
          resourceId: "stigmer",
        });
      } catch (error) {
        throw reservedLabelCheckFailure(error);
      }
      switch (decision.kind) {
        case "allow":
          return;
        case "deny":
        case "not-found":
          throw new ConnectError(
            `Labels in the reserved '${RESERVED_LABEL_PREFIX}' namespace ` +
              "are platform-managed and cannot be set or changed by this " +
              `request: ${mutations.join(", ")}. Stored reserved labels ` +
              "may be echoed back unchanged or removed.",
            Code.InvalidArgument,
          );
        case "unavailable":
          throw reservedLabelCheckFailure(decision.cause);
        default: {
          const exhaustive: never = decision;
          throw reservedLabelCheckFailure(
            new Error(`unknown decision ${JSON.stringify(exhaustive)}`),
          );
        }
      }
    },
  };
}

/** Authorization infrastructure failure: fail closed, sanitized (#478). */
function reservedLabelCheckFailure(error: unknown): ConnectError {
  return internalError(
    error instanceof Error ? error : new Error(String(error)),
    "reserved-label validation could not be completed",
  );
}
