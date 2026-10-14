/**
 * An organization's embedding settings (`spec.embedding`): how people sign
 * in to it from its own product, when the product's backend mints their
 * tokens (domain/token/mint.ts). Which web pages may use the tokens, whether
 * a first sign-in creates the person's account and with which role, and
 * which vaults their runs use.
 *
 * One door writes them, updateEmbedding, the updatePolicies precedent
 * (policies.ts): a setting that decides who joins the organization and
 * which keys strangers' runs use is changed on purpose, never by a
 * manifest written before it changed. So:
 *
 *   - ClearEmbedding (create): a new organization starts with none, and
 *     create and apply's create arm ignore any they carry, so no vault is
 *     attached without the attachment rule below.
 *   - PreserveEmbedding (update and apply, after BuildUpdateState): the
 *     stored settings and their attachers stay, whatever the request
 *     carries.
 *   - updateEmbedding (its own chain, over the Organization row): a
 *     service account's key is refused, since the settings decide which
 *     role the mint its key calls grants; the request's settings replace
 *     the stored ones whole
 *     (BuildEmbeddingState), the row is validated, the sign-in role must be
 *     one an organization grants (ValidateSignInRole), and the vaults pass
 *     the reference rule and the attachment rule every surface that names
 *     vaults passes (pipeline/steps/references.ts, domain/vault/
 *     attachments.ts): a vault the writer may not use is refused, a My
 *     vault is refused, and who attached each vault is recorded in
 *     `status.embedding_vault_attachers`. PersistEmbedding writes the
 *     settings, the attachers and the spec audit onto the live row inside
 *     the store's atomic write, so a concurrent update or rename is not
 *     undone.
 *
 * The rules a write cannot express in protovalidate are here; owner as the
 * sign-in role and a role without account creation are the contract's own
 * refusals (OrganizationEmbedding's CEL), as the federation issuer's are.
 *
 * Proven by __tests__/organization-embedding.composed.test.ts and the
 * user-token conformance suites.
 */
import { clone, create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import {
  OrganizationSchema,
  OrganizationStatusSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { UpdateOrganizationEmbeddingInput } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import {
  OrganizationEmbeddingSchema,
  OrganizationSpecSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { grantableRolesFor } from "../../pipeline/apiresource-meta.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { VaultAttachmentOptions } from "../vault/attachments.js";
import { signInRoleNotGrantableMessage } from "../token/constants.js";

type OrganizationStep = PipelineStep<typeof OrganizationSchema>;
type OrganizationContext = RequestContext<typeof OrganizationSchema>;

/** Where updateEmbedding keeps the organization it wrote, and returns. */
export const EMBEDDING_ORGANIZATION_KEY = "embeddingOrganization";

/**
 * Whether an organization can be granted `role`: the kind's grantable
 * roles, or no role at all (unset grants nothing). updateEmbedding and the
 * mint's backstop for settings stored before the rule share it.
 */
export function isGrantableSignInRole(role: IamRole): boolean {
  return (
    role === IamRole.iam_role_unspecified ||
    grantableRolesFor(ApiResourceKind.organization).includes(role)
  );
}

/**
 * An app user's runs have no person of the organization's choosing: each
 * asks the account that attached each embedding vault.
 */
export const EMBEDDING_VAULT_ATTACHMENTS: VaultAttachmentOptions<
  typeof OrganizationSchema
> = {
  surface: "an organization's embedding settings",
  attachers: {
    get: (row) => row.status?.embeddingVaultAttachers,
    set: (row, attachers) => {
      (row.status ??= create(OrganizationStatusSchema)).embeddingVaultAttachers =
        attachers;
    },
  },
};

/** The request context updateEmbedding runs over: the organization it names, with the requested settings. */
export function embeddingContext(
  input: UpdateOrganizationEmbeddingInput,
  caller: CallerIdentity,
): OrganizationContext {
  return new RequestContext(
    OrganizationSchema,
    create(OrganizationSchema, {
      metadata: { id: input.orgId },
      spec: {
        embedding: clone(
          OrganizationEmbeddingSchema,
          input.embedding ?? create(OrganizationEmbeddingSchema),
        ),
      },
    }),
    caller,
    ApiResourceKind.organization,
  );
}

/** ClearEmbedding — create: a new organization starts with no embedding settings. */
export function newClearEmbeddingStep(): OrganizationStep {
  return {
    name: "ClearEmbedding",
    execute(ctx: OrganizationContext): void {
      if (ctx.newState.spec !== undefined) {
        ctx.newState.spec.embedding = undefined;
      }
      if (ctx.newState.status !== undefined) {
        ctx.newState.status.embeddingVaultAttachers = {};
      }
    },
  };
}

/** PreserveEmbedding — update and apply, after BuildUpdateState: the stored settings and attachers stay. */
export function newPreserveEmbeddingStep(): OrganizationStep {
  return {
    name: "PreserveEmbedding",
    execute(ctx: OrganizationContext): void {
      const existing = storedOrganizationOf(ctx, "PreserveEmbedding");
      const spec = (ctx.newState.spec ??= create(OrganizationSpecSchema));
      const stored = existing.spec?.embedding;
      spec.embedding =
        stored === undefined
          ? undefined
          : clone(OrganizationEmbeddingSchema, stored);
      const status = (ctx.newState.status ??= create(OrganizationStatusSchema));
      status.embeddingVaultAttachers = {
        ...(existing.status?.embeddingVaultAttachers ?? {}),
      };
    },
  };
}

/**
 * BuildEmbeddingState — updateEmbedding, after LoadExisting: the stored
 * organization with the request's settings in place of its own. Nothing
 * else on the row changes.
 */
export function newBuildEmbeddingStateStep(): OrganizationStep {
  return {
    name: "BuildEmbeddingState",
    execute(ctx: OrganizationContext): void {
      const existing = storedOrganizationOf(ctx, "BuildEmbeddingState");
      const requested =
        ctx.newState.spec?.embedding ?? create(OrganizationEmbeddingSchema);
      const next = clone(OrganizationSchema, existing);
      (next.spec ??= create(OrganizationSpecSchema)).embedding = clone(
        OrganizationEmbeddingSchema,
        requested,
      );
      ctx.setNewState(next);
    },
  };
}

/** ValidateSignInRole — updateEmbedding: the sign-in role is one an organization grants. */
export function newValidateSignInRoleStep(): OrganizationStep {
  return {
    name: "ValidateSignInRole",
    execute(ctx: OrganizationContext): void {
      const role =
        ctx.newState.spec?.embedding?.signInRole ?? IamRole.iam_role_unspecified;
      if (!isGrantableSignInRole(role)) {
        throw invalidArgumentError(signInRoleNotGrantableMessage(role));
      }
    },
  };
}

/**
 * PersistEmbedding — updateEmbedding: the settings, their attachers and the
 * spec audit, written onto the live row inside the store's atomic write.
 */
export function newPersistEmbeddingStep(store: Store): OrganizationStep {
  return {
    name: "PersistEmbedding",
    async execute(ctx: OrganizationContext): Promise<void> {
      const id = ctx.newState.metadata?.id ?? "";
      const embedding = ctx.newState.spec?.embedding;
      const attachers = { ...(ctx.newState.status?.embeddingVaultAttachers ?? {}) };
      try {
        const written = await store.updateResource(
          ApiResourceKind.organization,
          id,
          OrganizationSchema,
          (live) => {
            (live.spec ??= create(OrganizationSpecSchema)).embedding =
              embedding === undefined
                ? undefined
                : clone(OrganizationEmbeddingSchema, embedding);
            (live.status ??= create(OrganizationStatusSchema)).embeddingVaultAttachers =
              attachers;
            setAuditFieldsForUpdate(
              OrganizationSchema,
              live,
              "spec_audit",
              ctx.callerIdentity,
            );
          },
        );
        ctx.set(EMBEDDING_ORGANIZATION_KEY, written);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Organization", id);
        }
        throw internalError(error, "failed to save organization");
      }
    },
  };
}

function storedOrganizationOf(
  ctx: OrganizationContext,
  step: string,
): Organization {
  const existing = ctx.get(EXISTING_RESOURCE_KEY) as Organization | undefined;
  if (existing === undefined) {
    throw internalError(
      new Error(`organization chain reached ${step} without its loaded row`),
      "failed to update organization",
    );
  }
  return existing;
}
