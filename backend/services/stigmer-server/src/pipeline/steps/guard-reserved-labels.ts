/**
 * GuardReservedLabels — the write-boundary guard for the platform-reserved
 * `stigmer.ai/*` label namespace (the Java GuardReservedLabelsStep port,
 * cloud#320/#386; C2 Stage 3, 20260827.10).
 *
 * Reserved labels carry platform semantics — the motivating one is
 * `stigmer.ai/default-agent`, which the default-agent resolution reads
 * GLOBALLY (label + visibility_public), so a tenant labeling its own
 * public agent would enter every organization's default-agent candidate
 * set. Only rejecting the write closes that.
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
 *   - LABELS only, deliberately not annotations (annotations carry no
 *     resolution or authorization semantics).
 *
 * Placement: after BuildNewState/BuildUpdateState — the step inspects the
 * state that will persist, and update chains have LoadExisting's stored
 * labels for echo detection. The infrastructure-failure arm answers a
 * sanitized INTERNAL (the TS store-fault doctrine, #478) where Java
 * echoes raw exception text — an unpinned outage-lane difference.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMessage } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
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
> = new Map([
  [ApiResourceKind.environment, new Set(["stigmer.ai/personal"])],
]);

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

export function newGuardReservedLabelsStep<Desc extends DescMessage>(
  authorizer: Authorizer,
): PipelineStep<Desc> {
  return {
    name: "GuardReservedLabels",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (
        ctx.callerIdentity.callerClass === "internal" ||
        ctx.callerIdentity.origin === "in-process"
      ) {
        // Server-composed request (the Java isInProcessCall arm,
        // cloud#386): the trust decision was made by the service code
        // that built it — default-instance factories stamp reserved
        // labels by design, even when the call propagates the user's
        // identity for attribution (ruling R5).
        return;
      }
      const requested = metadataOf(ctx.newState)?.labels ?? {};
      const existing = ctx.get(EXISTING_RESOURCE_KEY);
      const stored =
        existing === undefined
          ? {}
          : (metadataOf(existing as typeof ctx.newState)?.labels ?? {});

      const allowlist =
        CLIENT_CONTRACT_ALLOWLIST.get(ctx.apiResourceKind) ?? new Set();
      const mutations = reservedLabelMutations(stored, requested).filter(
        (key) => !allowlist.has(key),
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
