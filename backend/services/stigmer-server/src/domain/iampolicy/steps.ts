/**
 * IamPolicy pipeline steps (20260913.01 slice 5; Q-S5-1): the domain-local
 * steps the six command chains splice after the shared `Authorize` and
 * `ValidateProto`. The write itself is never here — every step that writes
 * calls the ONE grant and revoke path (grant-path.ts, which owns the
 * cloud#425 orderings, the by-triple read and the wire refusals) and leaves
 * its answer under POLICY_RESULT_KEY for the handler. The chains are
 * deliberately short: `Authorize → ValidateProto → <one of these>`, so the
 * pipeline executor's fault mapping (a step's ConnectError keeps its code;
 * a raw store fault becomes the sanitized INTERNAL) covers the path's two
 * error shapes with no second idiom in the handlers.
 *
 * ValidateGrantableRole (the `create` chain only; `bootstrapPolicy` is the
 * structural lane and skips it) is the one step with branching logic. It
 * runs BEFORE Grant — the cloud's validate-before-write order, so a held
 * legacy row under a role the kind does not grant is refused rather than
 * answered as a duplicate — and reads, in this order (Q-OR-3 as refined;
 * Q-S3-3):
 *   1. the wire refusals: an unknown resource kind is `Unknown resource
 *      kind`, never a role sentence;
 *   2. the PROTO (`grantableRolesFor`): a kind that lists no role is
 *      system-managed in every edition — the cloud's byte-pinned copy,
 *      whatever the composed scope claims;
 *   3. the composed SCOPE: a kind it lists nothing for is a per-resource
 *      grant this edition does not serve — UNIMPLEMENTED naming the
 *      editions that do;
 *   4. proto ∩ scope, in proto order: the role must be in the
 *      intersection — the cloud's second copy listing it. Intersecting is
 *      what keeps a scope from WIDENING the contract by accident.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { RevokeOrgAccessInputSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type {
  ApiResourceRef,
  ApiResourceRefSchema,
  IamPolicySpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { PolicyGrantScope } from "../../extensions/policy-grant-scope.js";
import { grantableRolesFor } from "../../pipeline/apiresource-meta.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import {
  PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE,
  noGrantableRolesMessage,
  roleNotGrantableMessage,
} from "./constants.js";
import type { IamPolicyGrantPath } from "./grant-path.js";
import { requireKnownResourceKind } from "./wire-refusals.js";

/** The row a write chain answers — the granted row, or the revoked row (the default instance when there was none). */
export const POLICY_RESULT_KEY = "policyResult";

/** The `create` chain's role check; see the module header for the four arms. */
export function newValidateGrantableRoleStep(
  scope: PolicyGrantScope,
): PipelineStep<typeof IamPolicySpecSchema> {
  return {
    name: "ValidateGrantableRole",
    execute(ctx: RequestContext<typeof IamPolicySpecSchema>): void {
      const spec = ctx.input;
      const kindName = spec.resource?.kind ?? "";
      const kind = requireKnownResourceKind(kindName);
      const contract = grantableRolesFor(kind);
      if (contract.length === 0) {
        throw new ConnectError(
          noGrantableRolesMessage(kindName),
          Code.InvalidArgument,
        );
      }
      const scoped = new Set(scope.grantableRoles(kind));
      if (scoped.size === 0) {
        throw new ConnectError(
          PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE,
          Code.Unimplemented,
        );
      }
      const grantable = contract.filter((role) => scoped.has(role));
      if (!grantable.some((role) => IamRole[role] === spec.relation)) {
        throw new ConnectError(
          roleNotGrantableMessage(
            spec.relation,
            kindName,
            grantable.map((role) => IamRole[role]),
          ),
          Code.InvalidArgument,
        );
      }
    },
  };
}

/** Grant the spec as the chain's caller; the row (fresh or held) is the result. */
export function newGrantStep(
  grantPath: IamPolicyGrantPath,
): PipelineStep<typeof IamPolicySpecSchema> {
  return {
    name: "Grant",
    async execute(
      ctx: RequestContext<typeof IamPolicySpecSchema>,
    ): Promise<void> {
      const { policy } = await grantPath.grant(ctx.input, ctx.callerIdentity);
      ctx.set(POLICY_RESULT_KEY, policy);
    },
  };
}

/** Revoke the spec's row; absent, the default instance is the result (Java's idempotent delete). */
export function newRevokeStep(
  grantPath: IamPolicyGrantPath,
): PipelineStep<typeof IamPolicySpecSchema> {
  return {
    name: "Revoke",
    async execute(
      ctx: RequestContext<typeof IamPolicySpecSchema>,
    ): Promise<void> {
      const revoked = await grantPath.revokeBySpec(ctx.input);
      ctx.set(POLICY_RESULT_KEY, revoked ?? create(IamPolicySchema));
    },
  };
}

/** Revoke every relation the account holds directly on the organization. */
export function newRevokeOrgAccessStep(
  grantPath: IamPolicyGrantPath,
): PipelineStep<typeof RevokeOrgAccessInputSchema> {
  return {
    name: "RevokeOrgAccess",
    execute(
      ctx: RequestContext<typeof RevokeOrgAccessInputSchema>,
    ): Promise<void> {
      return grantPath.revokeOrgAccess(
        ctx.input.identityAccountId,
        ctx.input.organizationId,
      );
    },
  };
}

/** Revoke every row naming the ref as resource or principal — the deleted resource's cleanup. */
export function newCleanupResourceStep(
  grantPath: IamPolicyGrantPath,
): PipelineStep<typeof ApiResourceRefSchema> {
  return {
    name: "CleanupResource",
    execute(ctx: RequestContext<typeof ApiResourceRefSchema>): Promise<void> {
      const ref: ApiResourceRef = ctx.input;
      return grantPath.cleanupResource(ref);
    },
  };
}
