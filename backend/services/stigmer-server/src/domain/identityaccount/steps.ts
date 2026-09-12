/**
 * Identity-account domain steps (20260911.11; T01_1_review.md A1, A9).
 *
 * This is the first OSS domain whose persistence is a PORT
 * (IdentityAccountStore) rather than the generic Store, so the cloud can
 * serve the same controller over its own table. The shared steps that
 * touch storage (CheckDuplicate, LoadExisting, LoadTarget, Persist, the
 * delete pair) are typed over `Store`; this module brings the domain's
 * own under the SAME names, so a chain reads onto the inventory unchanged
 * (the organization domain's "own step, same name" precedent), and reuses
 * every storage-free shared step as it is. The shared context keys are
 * reused too, so BuildUpdateState finds EXISTING_RESOURCE_KEY exactly
 * where it expects it.
 *
 * The domain's own rules:
 *   - DefaultAccountName: `metadata.name` falls back to the email, then
 *     the subject. ResolveSlug refuses an empty name and the field is not
 *     proto-required, and a machine subject whose IdP releases no email
 *     must still provision.
 *   - DeriveAccountId (A1): `metadata.id = accountIdFor(spec.idp_id)`,
 *     replacing whatever the caller sent (the organization's CopySlugToId
 *     precedent, `metadata.proto`'s documented exception). Runs BEFORE
 *     BuildNewState, which mints only when the id is empty.
 *   - CheckDuplicate: by SUBJECT, a primary-key read of the derived id —
 *     two accounts may share an email; the account's uniqueness is its
 *     subject, never its slug (the guideline's "domains with different
 *     uniqueness rules bring their own step under the same name").
 *   - AssignBackendFields: `is_machine_account` from the `@clients`
 *     suffix and `provisioning_mode direct` on create (the spec's
 *     "assigned by backend" fields); on update, every backend-assigned
 *     field and the email are preserved from the existing row (A9: the
 *     cloud's writable surface — first/last name, picture, preferences —
 *     and nothing else; the `preserveImmutableFields` shape).
 *   - GuardImmutableSubject (A1): a changed `spec.idp_id` is refused
 *     FAILED_PRECONDITION (the schedule domain's shape), never silently
 *     preserved — the subject IS the identity, and a client that sends a
 *     different one has a bug it should hear about.
 *
 * NOT_FOUND copy is the domain's (`Identity account not found: <id>`, the
 * cloud's byte-pinned sentence); the shared `notFoundError` would render
 * the kind_meta name `IdentityAccount`.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMessage } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import type { IdentityAccountSpec } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";

import {
  alreadyExistsError,
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { idValueOf, metadataOf } from "../../pipeline/steps/shapes.js";
import {
  accountIdFor,
  accountNotFoundMessage,
  idpIdImmutableMessage,
  isMachineSubject,
} from "./constants.js";
import { DuplicateAccountError } from "./store.js";
import type { IdentityAccountStore } from "./store.js";

type AccountStep = PipelineStep<typeof IdentityAccountSchema>;
type AccountContext = RequestContext<typeof IdentityAccountSchema>;

/** The kind's name as the shared error constructors render it. */
const KIND_NAME = "IdentityAccount";

/** `Identity account not found: <handle>` as a NOT_FOUND ConnectError. */
export function accountNotFoundError(handle: string): ConnectError {
  return new ConnectError(accountNotFoundMessage(handle), Code.NotFound);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function newDefaultAccountNameStep(): AccountStep {
  return {
    name: "DefaultAccountName",
    execute(ctx: AccountContext): void {
      const metadata = requireMetadata(ctx, "default account name");
      if (metadata.name === "") {
        const spec = specOf(ctx);
        metadata.name = spec.email !== "" ? spec.email : spec.idpId;
      }
    },
  };
}

export function newDeriveAccountIdStep(): AccountStep {
  return {
    name: "DeriveAccountId",
    execute(ctx: AccountContext): void {
      const metadata = requireMetadata(ctx, "derive account id");
      // ValidateProto ran upstream (idp_id is required), so an empty
      // subject here is a pipeline-ordering bug, not bad client input.
      const idpId = specOf(ctx).idpId;
      if (idpId === "") {
        throw internalError(
          new Error("identity account idp_id is empty"),
          "derive account id",
        );
      }
      metadata.id = accountIdFor(idpId);
    },
  };
}

/** Rejects a create whose SUBJECT already has an account (a primary-key read). */
export function newCheckDuplicateStep(
  accounts: IdentityAccountStore,
): AccountStep {
  return {
    name: "CheckDuplicate",
    async execute(ctx: AccountContext): Promise<void> {
      const metadata = requireMetadata(ctx, "duplicate check");
      const idpId = specOf(ctx).idpId;
      let existing: IdentityAccount | undefined;
      try {
        existing = await accounts.findById(metadata.id);
      } catch (error) {
        throw internalError(
          error,
          "failed to check for duplicate identity account",
        );
      }
      if (existing !== undefined) {
        throw alreadyExistsError(KIND_NAME, `subject '${idpId}'`);
      }
    },
  };
}

/**
 * The backend-assigned fields of a DIRECT account, applied in place: the
 * machine flag from the subject's shape, `provisioning_mode direct`, no
 * provider ref (a direct account is the platform's own subject). The ONE
 * writer of these fields; the provisioner builds its spec through it too.
 */
export function assignDirectBackendFields(
  spec: IdentityAccountSpec,
): IdentityAccountSpec {
  spec.isMachineAccount = isMachineSubject(spec.idpId);
  spec.provisioningMode = IdentityAccountProvisioningMode.direct;
  spec.identityProviderRef = undefined;
  return spec;
}

export function newAssignBackendFieldsStep(): AccountStep {
  return {
    name: "AssignBackendFields",
    execute(ctx: AccountContext): void {
      assignDirectBackendFields(specOf(ctx));
    },
  };
}

/** Saves the new account through the port; a held subject is ALREADY_EXISTS. */
export function newPersistNewAccountStep(
  accounts: IdentityAccountStore,
): AccountStep {
  return {
    name: "Persist",
    async execute(ctx: AccountContext): Promise<void> {
      try {
        await accounts.save(ctx.newState);
      } catch (error) {
        if (error instanceof DuplicateAccountError) {
          // The race the duplicate check could not see: another writer
          // took the subject between the read and this save. The
          // provisioner's race arm resolves the winner from this code.
          throw alreadyExistsError(KIND_NAME, `subject '${specOf(ctx).idpId}'`);
        }
        throw internalError(error, "failed to save identity account");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/** Loads the existing account by id into EXISTING_RESOURCE_KEY; the domain's NOT_FOUND copy. */
export function newLoadExistingAccountStep(
  accounts: IdentityAccountStore,
): AccountStep {
  return {
    name: "LoadExisting",
    async execute(ctx: AccountContext): Promise<void> {
      const metadata = requireMetadata(ctx, "load existing");
      if (metadata.id === "") {
        // By id only: an account's slug is derived from its display name
        // and two accounts may share one, so a slug lookup could never be
        // an identity.
        throw invalidArgumentError("resource id is required for update");
      }
      const existing = await readAccount(accounts, metadata.id);
      ctx.set(EXISTING_RESOURCE_KEY, existing);
    },
  };
}

export function newGuardImmutableSubjectStep(): AccountStep {
  return {
    name: "GuardImmutableSubject",
    execute(ctx: AccountContext): void {
      const existing = existingAccountOf(ctx);
      const existingIdpId = existing.spec?.idpId ?? "";
      if (specOf(ctx).idpId !== existingIdpId) {
        throw failedPreconditionError(idpIdImmutableMessage(existingIdpId));
      }
    },
  };
}

/** Preserves the backend-assigned fields and the email from the existing row (A9). */
export function newPreserveBackendFieldsStep(): AccountStep {
  return {
    name: "AssignBackendFields",
    execute(ctx: AccountContext): void {
      const existingSpec = existingAccountOf(ctx).spec;
      const spec = specOf(ctx);
      spec.idpId = existingSpec?.idpId ?? spec.idpId;
      spec.email = existingSpec?.email ?? "";
      spec.isMachineAccount = existingSpec?.isMachineAccount ?? false;
      spec.provisioningMode =
        existingSpec?.provisioningMode ??
        IdentityAccountProvisioningMode.identity_account_provisioning_mode_unspecified;
      spec.identityProviderRef = existingSpec?.identityProviderRef;
    },
  };
}

/** Replaces the row through the port. */
export function newPersistUpdatedAccountStep(
  accounts: IdentityAccountStore,
): AccountStep {
  return {
    name: "Persist",
    async execute(ctx: AccountContext): Promise<void> {
      try {
        await accounts.update(ctx.newState);
      } catch (error) {
        throw internalError(error, "failed to save identity account");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Get / Delete (ID-wrapper inputs)
// ---------------------------------------------------------------------------

/** Loads the account named by an ID-wrapper input into TARGET_RESOURCE_KEY. */
export function newLoadTargetAccountStep<InputDesc extends DescMessage>(
  accounts: IdentityAccountStore,
): PipelineStep<InputDesc> {
  return {
    name: "LoadTarget",
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      const id = idValueOf(ctx.input);
      if (id === "") {
        throw invalidArgumentError("resource id is required");
      }
      ctx.set(TARGET_RESOURCE_KEY, await readAccount(accounts, id));
    },
  };
}

/** Loads the doomed account (after ExtractResourceId) so delete can return it. */
export function newLoadExistingAccountForDeleteStep<
  InputDesc extends DescMessage,
>(accounts: IdentityAccountStore): PipelineStep<InputDesc> {
  return {
    name: "LoadExistingForDelete",
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      ctx.set(
        EXISTING_RESOURCE_KEY,
        await readAccount(accounts, requireResourceId(ctx)),
      );
    },
  };
}

export function newDeleteAccountStep<InputDesc extends DescMessage>(
  accounts: IdentityAccountStore,
): PipelineStep<InputDesc> {
  return {
    name: "DeleteResource",
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      try {
        await accounts.deleteById(requireResourceId(ctx));
      } catch (error) {
        throw internalError(error, "failed to delete identity account");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Shared readers
// ---------------------------------------------------------------------------

/** The account by id, or the domain's NOT_FOUND; any other fault propagates. */
async function readAccount(
  accounts: IdentityAccountStore,
  id: string,
): Promise<IdentityAccount> {
  const account = await accounts.findById(id);
  if (account === undefined) {
    throw accountNotFoundError(id);
  }
  return account;
}

function requireMetadata(ctx: AccountContext, operation: string) {
  const metadata = metadataOf(ctx.newState);
  if (metadata === undefined) {
    throw internalError(
      new Error("identity account metadata is nil"),
      operation,
    );
  }
  return metadata;
}

/** The spec being built, created in place when the caller omitted it. */
function specOf(ctx: AccountContext): IdentityAccountSpec {
  const state = ctx.newState;
  if (state.spec === undefined) {
    state.spec = create(IdentityAccountSpecSchema);
  }
  return state.spec;
}

function existingAccountOf(ctx: AccountContext): IdentityAccount {
  const existing = ctx.get(EXISTING_RESOURCE_KEY) as
    | IdentityAccount
    | undefined;
  if (existing === undefined) {
    throw internalError(
      new Error(
        "existing identity account not found in context - LoadExisting must run first",
      ),
      "identity account update ordering",
    );
  }
  return existing;
}

function requireResourceId<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): string {
  const id = ctx.get(RESOURCE_ID_KEY);
  if (typeof id !== "string" || id === "") {
    throw internalError(
      new Error(
        "resource id not found in context (ExtractResourceId must run first)",
      ),
      "identity account delete ordering",
    );
  }
  return id;
}
