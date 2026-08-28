/**
 * The PUBLIC-visibility operator gates — the two write doors a resource
 * can become public through, both consulting the ONE composed Authorizer
 * with the same platform-scoped check (the Java
 * PublicVisibilityEscalationPolicy port; C2 Stage 3, 20260827.10).
 *
 * PUBLIC is the only level that crosses every org boundary (one flip
 * lists a resource in every tenant's cross-org catalog), so entering it
 * is a curation decision: the owner requests, the platform team grants.
 * The answer is `can_set_public_visibility` on `platform:stigmer` — a
 * named operator capability, never a bare operator lookup.
 *
 *   - GuardPublicVisibility: the CREATE door, in the create chains of
 *     the kinds whose VisibilityConfig supports PUBLIC (agent, workflow,
 *     mcp_server, agent_instance, workflow_instance). After
 *     BuildNewState — it inspects the state that will persist — which
 *     keeps the pinned INVALID_ARGUMENT level-support rejections (the
 *     earlier ValidateVisibility) their precedence over this
 *     PERMISSION_DENIED.
 *   - AuthorizeVisibilityTransition: the UPDATE door, in every
 *     updateVisibility chain after ValidateVisibilityUpdate (the pinned
 *     FAILED_PRECONDITION default-instance rejection keeps precedence,
 *     the Java ordering the conformance suite depends on). Gates only
 *     the ESCALATION to public (stored level is anything else).
 *
 * Both run LAZILY — only requests that actually involve the PUBLIC level
 * reach the Authorizer — and both pass for internal callers (server-side
 * flows publish platform resources by design). The OSS permissive
 * default allows, so the local posture keeps today's behavior
 * byte-identically; the cloud's FGA Authorizer supplies the gate.
 *
 * DELIBERATE partial port, recorded owner-visibly (Stage-3 execution
 * record): Java's transition step additionally lets operators WITHOUT
 * resource can_edit publish and take down (its updateVisibility chains
 * authorize post-load, transition-aware); this edition's position-1
 * Authorize enforces can_edit on updateVisibility before any step here
 * runs, so those operator-without-edit lanes require can_edit until the
 * Stage-4 chain disposition addresses them. No conformance lane pins
 * them.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMessage } from "@bufbuild/protobuf";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { UpdateVisibilityInput } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  Authorizer,
  AuthzDecision,
} from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { metadataOf } from "./shapes.js";

/**
 * The denial callers see at both doors (the Java policy copy verbatim).
 * Deliberately not byte-pinned by the OSS conformance suite; the cloud
 * gate itself is recorded via the clientPublicVisibilityWrites flag.
 */
export const PUBLIC_VISIBILITY_DENY_MESSAGE =
  "Public visibility is granted by the platform team. " +
  "Ask a platform operator to publish this resource.";

/** The CREATE door: a new state declaring PUBLIC needs the operator grant. */
export function newGuardPublicVisibilityStep<Desc extends DescMessage>(
  authorizer: Authorizer,
): PipelineStep<Desc> {
  return {
    name: "GuardPublicVisibility",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (ctx.callerIdentity.callerClass === "internal") {
        return;
      }
      if (
        metadataOf(ctx.newState)?.visibility !==
        ApiResourceVisibility.visibility_public
      ) {
        return;
      }
      await requireOperatorMaySetPublic(authorizer, ctx.callerIdentity);
    },
  };
}

/**
 * The UPDATE door: escalation to PUBLIC (the stored level is anything
 * else) needs the operator grant. Reads the loaded target from the
 * chain's own context key (every updateVisibility chain stores it —
 * the RecordVisibilityBeforeUpdate pattern).
 */
export function newAuthorizeVisibilityTransitionStep<
  Desc extends DescMessage,
>(targetKey: string, authorizer: Authorizer): PipelineStep<Desc> {
  return {
    name: "AuthorizeVisibilityTransition",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (ctx.callerIdentity.callerClass === "internal") {
        return;
      }
      const requested = (ctx.input as unknown as UpdateVisibilityInput)
        .visibility;
      if (requested !== ApiResourceVisibility.visibility_public) {
        return;
      }
      const target = ctx.get(targetKey);
      if (target === undefined) {
        // Wiring error, not a user error: without the loaded target there
        // is no stored level, and a gate that silently passes un-guards
        // the boundary it exists to protect.
        throw internalError(
          new Error(
            "AuthorizeVisibilityTransition ran without a loaded target — step must be placed after the load step",
          ),
          "visibility authorization requires the loaded resource",
        );
      }
      const stored = metadataOf(target as typeof ctx.newState)?.visibility;
      if (stored === ApiResourceVisibility.visibility_public) {
        return; // Re-asserting a stored PUBLIC is not an escalation.
      }
      await requireOperatorMaySetPublic(authorizer, ctx.callerIdentity);
    },
  };
}

/** The single owner of "may this caller set public?" — both doors call it. */
async function requireOperatorMaySetPublic(
  authorizer: Authorizer,
  caller: CallerIdentity,
): Promise<void> {
  let decision: AuthzDecision;
  try {
    decision = await authorizer.authorize(caller, {
      permission: IamPermission.can_set_public_visibility,
      resourceKind: ApiResourceKind.platform,
      resourceId: "stigmer",
    });
  } catch (error) {
    throw publicVisibilityCheckFailure(error);
  }
  switch (decision.kind) {
    case "allow":
      return;
    case "deny":
    case "not-found":
      throw new ConnectError(
        PUBLIC_VISIBILITY_DENY_MESSAGE,
        Code.PermissionDenied,
      );
    case "unavailable":
      throw publicVisibilityCheckFailure(decision.cause);
    default: {
      const exhaustive: never = decision;
      throw publicVisibilityCheckFailure(
        new Error(`unknown decision ${JSON.stringify(exhaustive)}`),
      );
    }
  }
}

/** Authorization infrastructure failure: fail closed, sanitized (#478). */
function publicVisibilityCheckFailure(error: unknown): ConnectError {
  return internalError(
    error instanceof Error ? error : new Error(String(error)),
    "public-visibility authorization could not be completed",
  );
}
