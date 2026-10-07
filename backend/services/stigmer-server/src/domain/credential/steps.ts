/**
 * Credential domain steps: the owner resolution and the create-time
 * permission it decides, the one-default-per-target rule, the sentinel
 * guard and encrypt-at-rest pair, the sign-in guard, the single-field
 * reveal, and the two self-contained write boundaries for field
 * management (setFields, removeFields).
 *
 * The ordering contracts these steps embody:
 *   1. PreserveRedactedSecrets runs BEFORE EncryptSecretValues — the
 *      marker arm restores stored ciphertext, whose idempotent encrypt
 *      pass-through must leave it unchanged (never double-encrypted).
 *   2. Within the guard, the marker arm runs BEFORE the forged-ciphertext
 *      arm — after preservation, legitimate stored ciphertext is present
 *      by design and must not hit the forgery rejection.
 *   3. Redaction (redact.ts) runs AFTER Persist, outside the pipeline.
 *
 * Proven by __tests__/credential.test.ts, __tests__/store-faults.test.ts
 * and credential.conformance.test.ts (CONFORMANCE_TARGET=local).
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import {
  CredentialFieldSchema,
  CredentialSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import type { CredentialField } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import type { CredentialTarget } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import {
  CredentialSource,
  CredentialStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import type {
  RemoveCredentialFieldsInputSchema,
  RevealCredentialFieldInputSchema,
  SetCredentialFieldsInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { isServerComposedRequest } from "../../extensions/identity.js";
import { isCiphertextShaped } from "../../encryption/encryption.js";
import type { SecretService } from "../../encryption/encryption.js";
import { EncryptionScope } from "../../encryption/encryption.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  permissionDeniedError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { evaluateAuthorizer } from "../../pipeline/steps/authorize.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { destroySecretBackingState } from "../../pipeline/steps/secret-cleanup.js";
import { fittedSlug } from "../../pipeline/steps/slug.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  forgedCiphertextMessage,
  markerRejectionMessage,
  ORG_CREDENTIAL_IS_WRITE_ONLY,
  ORG_IS_NOT_METADATA_ORG,
  OWNER_IS_FIXED,
  PERSON_IS_NOT_CALLER,
  REDACTED_MARKER,
  servesTakenMessage,
  SIGN_IN_FIELDS_ARE_THE_PLATFORMS,
} from "./constants.js";
import { credentialsOfOrg } from "./values.js";

/** Context key for the revealed field. */
export const REVEALED_FIELD_KEY = "revealedField";

/** Context key for the credential after a setFields/removeFields write. */
export const UPDATED_CREDENTIAL_KEY = "updatedCredential";

// ---------------------------------------------------------------------------
// Ownership.
// ---------------------------------------------------------------------------

/** Who a credential belongs to, as its spec names it. */
export type CredentialOwner =
  | { readonly kind: "person"; readonly person: string }
  | { readonly kind: "org"; readonly org: string };

/** The owner a stored or requested credential names; undefined when it names none. */
export function ownerOf(credential: Credential): CredentialOwner | undefined {
  const owner = credential.spec?.owner;
  switch (owner?.case) {
    case "person":
      return { kind: "person", person: owner.value };
    case "org":
      return { kind: "org", org: owner.value };
    case undefined:
      return undefined;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = owner;
      throw new Error(`unknown credential owner: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Whether a credential is an MCP server sign-in, written and refreshed by the platform. */
export function isSignIn(credential: Credential): boolean {
  return credential.status?.source === CredentialSource.oauth;
}

/**
 * ResolveCredentialOwner (create): fills an empty owner member (the
 * caller for `person`, the credential's organization for `org`), refuses
 * one that names someone else, and asks the permission the owner
 * decides — can_create_credential on the organization for a person's own,
 * can_create_org_credential for the organization's (the share-create
 * shape: the RPC is is_skip_authorization because its permission depends
 * on the request). Runs after BuildNewState, when metadata.org is the
 * organization's id.
 */
export function newResolveCredentialOwnerStep(
  authorizer: Authorizer,
): PipelineStep<typeof CredentialSchema> {
  return {
    name: "ResolveCredentialOwner",
    async execute(ctx: RequestContext<typeof CredentialSchema>): Promise<void> {
      const credential = ctx.newState;
      const org = credential.metadata?.org ?? "";
      const spec = (credential.spec ??= create(CredentialSpecSchema));
      const owner = ownerOf(credential);
      let permission: IamPermission;
      if (owner === undefined) {
        throw invalidArgumentError(
          "spec.person or spec.org is required: say whether the credential is yours or the organization's",
        );
      }
      if (owner.kind === "person") {
        const caller = ctx.callerIdentity.identityId;
        if (owner.person === "") {
          spec.owner = { case: "person", value: caller };
        } else if (owner.person !== caller) {
          throw permissionDeniedError(PERSON_IS_NOT_CALLER);
        }
        permission = IamPermission.can_create_credential;
      } else {
        if (owner.org === "") {
          spec.owner = { case: "org", value: org };
        } else if (owner.org !== org) {
          throw invalidArgumentError(ORG_IS_NOT_METADATA_ORG);
        }
        permission = IamPermission.can_create_org_credential;
      }
      const decision = await evaluateAuthorizer(authorizer, ctx.callerIdentity, {
        permission,
        resourceKind: ApiResourceKind.organization,
        resourceId: org,
      });
      if (decision.kind === "allow") {
        return;
      }
      if (decision.kind === "deny") {
        throw permissionDeniedError(
          owner.kind === "person"
            ? "unauthorized to create a credential in this organization"
            : "unauthorized to create an organization credential: only the organization's admins save credentials for it",
        );
      }
      if (decision.kind === "not-found") {
        throw notFoundError("organization", org);
      }
      throw internalError(decision.cause, "failed to authorize credential create");
    },
  };
}

/**
 * GuardCredentialOwnerFixed (update): the owner a credential was created
 * with never changes — a person's credential never becomes the
 * organization's, nor the reverse, nor someone else's.
 */
export function newGuardCredentialOwnerFixedStep(): PipelineStep<
  typeof CredentialSchema
> {
  return {
    name: "GuardCredentialOwnerFixed",
    execute(ctx: RequestContext<typeof CredentialSchema>): void {
      // LoadExisting precedes this step, and protovalidate requires the
      // owner on every write, so both owners are named here.
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Credential;
      const stored = ownerOf(existing);
      const requested = ownerOf(ctx.newState);
      const keeps =
        stored !== undefined &&
        requested?.kind === stored.kind &&
        (ownerValue(requested) === "" ||
          ownerValue(requested) === ownerValue(stored));
      if (!keeps) {
        throw failedPreconditionError(OWNER_IS_FIXED);
      }
      // An empty member means "as stored", as it means "me" or "this
      // organization" on create.
      (ctx.newState.spec ??= create(CredentialSpecSchema)).owner =
        existing.spec?.owner ?? { case: undefined };
    },
  };
}

function ownerValue(owner: CredentialOwner): string {
  return owner.kind === "person" ? owner.person : owner.org;
}

/**
 * StampCredentialSource (create): `oauth` only when the server composed
 * the request (the sign-in lane, which creates the credential in-process
 * and says so); `static` for every request from the wire, whatever it
 * claims — only a sign-in writes a sign-in.
 */
export function newStampCredentialSourceStep(): PipelineStep<
  typeof CredentialSchema
> {
  return {
    name: "StampCredentialSource",
    execute(ctx: RequestContext<typeof CredentialSchema>): void {
      const requested = ctx.input.status?.source;
      const source =
        isServerComposedRequest(ctx.callerIdentity) &&
        requested === CredentialSource.oauth
          ? CredentialSource.oauth
          : CredentialSource.static;
      const status = (ctx.newState.status ??= create(CredentialStatusSchema));
      status.source = source;
    },
  };
}

/**
 * GuardSignInFields (update): a sign-in's values are the platform's (the
 * refresh lane rewrites them); a person may rename it, describe it or
 * change what it serves, never its fields. Every field must come back
 * as stored (secrets as the marker, which the preserve step restores).
 */
export function newGuardSignInFieldsStep(): PipelineStep<typeof CredentialSchema> {
  return {
    name: "GuardSignInFields",
    execute(ctx: RequestContext<typeof CredentialSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Credential | undefined;
      if (
        existing === undefined ||
        !isSignIn(existing) ||
        isServerComposedRequest(ctx.callerIdentity)
      ) {
        return;
      }
      const stored = existing.spec?.fields ?? {};
      const requested = ctx.newState.spec?.fields ?? {};
      const names = new Set([...Object.keys(stored), ...Object.keys(requested)]);
      for (const name of names) {
        const before = stored[name];
        const after = requested[name];
        if (before === undefined || after === undefined) {
          throw failedPreconditionError(SIGN_IN_FIELDS_ARE_THE_PLATFORMS);
        }
        const keepsSecret = !before.plain && after.value === REDACTED_MARKER;
        if (
          before.plain !== after.plain ||
          (!keepsSecret && before.value !== after.value)
        ) {
          throw failedPreconditionError(SIGN_IN_FIELDS_ARE_THE_PLATFORMS);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Slug.
// ---------------------------------------------------------------------------

/** How many random hex digits a minted slug ends with. */
const SLUG_SUFFIX_DIGITS = 8;

/**
 * MintCredentialSlug (create, before ResolveSlug): a credential named by a
 * person ("OpenAI") gets a slug with a random suffix, because slugs are
 * unique per organization and two members' "OpenAI" must never collide.
 * A slug the request sets is kept, and the duplicate check judges it.
 */
export function newMintCredentialSlugStep(): PipelineStep<typeof CredentialSchema> {
  return {
    name: "MintCredentialSlug",
    execute(ctx: RequestContext<typeof CredentialSchema>): void {
      const metadata = ctx.newState.metadata;
      if (metadata === undefined || metadata.slug !== "" || metadata.name === "") {
        return;
      }
      metadata.slug = mintCredentialSlug(metadata.name);
    },
  };
}

/** A slug for a credential named `name`: the fitted name, cut to leave room for a random suffix. */
export function mintCredentialSlug(name: string): string {
  const suffix = randomBytes(SLUG_SUFFIX_DIGITS / 2).toString("hex");
  const head = fittedSlug(name, "credential")
    .slice(0, 63 - SLUG_SUFFIX_DIGITS - 1)
    .replace(/-+$/, "");
  return `${head}-${suffix}`;
}

// ---------------------------------------------------------------------------
// One default per owner and target.
// ---------------------------------------------------------------------------

/** A target as one comparable string: the kind and the absolute reference, or the host. */
export function targetKey(target: CredentialTarget): string | undefined {
  const t = target.target;
  switch (t.case) {
    case "mcpServer":
      return `mcp_server:${t.value.org}/${t.value.slug}`;
    case "agent":
      return `agent:${t.value.org}/${t.value.slug}`;
    case "gitHost":
      return `git_host:${t.value.toLowerCase()}`;
    case undefined:
      return undefined;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = t;
      throw new Error(`unknown credential target: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** A target as a refusal names it. */
export function targetWords(target: CredentialTarget): string {
  const t = target.target;
  switch (t.case) {
    case "mcpServer":
      return `MCP server '${t.value.slug}'`;
    case "agent":
      return `agent '${t.value.slug}'`;
    case "gitHost":
      return `git host '${t.value}'`;
    case undefined:
      return "an empty target";
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = t;
      throw new Error(`unknown credential target: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function sameOwner(a: CredentialOwner | undefined, b: CredentialOwner | undefined): boolean {
  return (
    a !== undefined &&
    b !== undefined &&
    a.kind === b.kind &&
    ownerValue(a) === ownerValue(b)
  );
}

/**
 * EnforceOneDefaultPerTarget (create and update, after NormalizeReferences
 * so every reference is absolute): at most one of a person's credentials,
 * and at most one of the organization's, may serve the same MCP server,
 * agent or git host. A save that would make a second is refused naming
 * the first, so a run's default for a target is never a choice between
 * two. A target listed twice on one credential is deduplicated.
 */
export function newEnforceOneDefaultPerTargetStep(
  store: Store,
): PipelineStep<typeof CredentialSchema> {
  return {
    name: "EnforceOneDefaultPerTarget",
    async execute(ctx: RequestContext<typeof CredentialSchema>): Promise<void> {
      const credential = ctx.newState;
      const spec = credential.spec;
      if (spec === undefined || spec.serves.length === 0) {
        return;
      }
      const seen = new Set<string>();
      spec.serves = spec.serves.filter((target) => {
        const key = targetKey(target);
        if (key === undefined || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      const owner = ownerOf(credential);
      const id = credential.metadata?.id ?? "";
      let others: Credential[];
      try {
        others = await credentialsOfOrg(store, credential.metadata?.org ?? "");
      } catch (error) {
        throw internalError(error, "failed to check what the organization's credentials serve");
      }
      for (const other of others) {
        if ((other.metadata?.id ?? "") === id || !sameOwner(ownerOf(other), owner)) {
          continue;
        }
        const taken = new Set(
          (other.spec?.serves ?? []).map(targetKey).filter((k) => k !== undefined),
        );
        for (const target of spec.serves) {
          const key = targetKey(target);
          if (key !== undefined && taken.has(key)) {
            throw new ConnectError(
              servesTakenMessage(targetWords(target), other.metadata?.slug ?? ""),
              Code.AlreadyExists,
            );
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Secrets at rest.
// ---------------------------------------------------------------------------

/**
 * PreserveRedactedSecrets: a secret field whose incoming value is the
 * marker is restored from the stored credential (update); with nothing to
 * restore (a create, or a field that held no secret) the marker is
 * refused. A secret carrying the server-reserved ciphertext prefix is
 * refused. Plain fields pass untouched: every decrypt path gates on the
 * field being secret, so a plain prefixed string is inert.
 */
export function newPreserveRedactedSecretsStep(): PipelineStep<
  typeof CredentialSchema
> {
  return {
    name: "PreserveRedactedSecrets",
    execute(ctx: RequestContext<typeof CredentialSchema>): void {
      const fields = ctx.newState.spec?.fields;
      if (fields === undefined || Object.keys(fields).length === 0) {
        return;
      }
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Credential | undefined;
      const stored = existing?.spec?.fields ?? {};
      for (const [name, field] of Object.entries(fields)) {
        if (field.plain) {
          continue;
        }
        if (field.value === REDACTED_MARKER) {
          const held = stored[name];
          if (held !== undefined && !held.plain) {
            fields[name] = held;
            continue;
          }
          throw invalidArgumentError(markerRejectionMessage(name));
        }
        if (isCiphertextShaped(field.value)) {
          throw invalidArgumentError(forgedCiphertextMessage(name));
        }
      }
    },
  };
}

/**
 * EncryptSecretValues: encrypts every non-empty secret field before
 * persistence, after PreserveRedactedSecrets (a restored ciphertext passes
 * the idempotent encrypt unchanged). Keyless mode stores plaintext with
 * one WARN per request, only when a secret would actually rest plaintext.
 */
export function newEncryptSecretValuesStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof CredentialSchema> {
  return {
    name: "EncryptSecretValues",
    async execute(ctx: RequestContext<typeof CredentialSchema>): Promise<void> {
      const credential = ctx.newState;
      const fields = credential.spec?.fields;
      if (fields === undefined || Object.keys(fields).length === 0) {
        return;
      }
      if (!secretService.isEnabled()) {
        if (Object.values(fields).some((f) => !f.plain && f.value !== "")) {
          logger.warn(
            "Encryption disabled: credential secret values will be stored in plaintext",
            { credentialId: credential.metadata?.id ?? "" },
          );
        }
        return;
      }
      for (const [name, field] of Object.entries(fields)) {
        if (field.plain || field.value === "") {
          continue;
        }
        try {
          field.value = await secretService.encrypt(
            field.value,
            EncryptionScope.forOrganization(credential.metadata?.org ?? ""),
          );
        } catch (error) {
          throw internalError(error, `failed to encrypt secret value for field '${name}'`);
        }
      }
    },
  };
}

/**
 * DestroyDroppedSecrets (update, after Persist): destroys the external
 * backing state of secret fields the update dropped. A field that
 * survives with a new value keeps its path. Best-effort by the
 * secret-cleanup contract; a no-op under the OSS v1-only codec set.
 */
export function newDestroyDroppedSecretsStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof CredentialSchema> {
  return {
    name: "DestroyDroppedSecrets",
    async execute(ctx: RequestContext<typeof CredentialSchema>): Promise<void> {
      // LoadExisting precedes this step on the update chain.
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Credential;
      const before = existing.spec?.fields ?? {};
      const after = ctx.newState.spec?.fields ?? {};
      await destroySecretBackingState(
        secretService,
        logger,
        {
          kind: "credential",
          resourceId: existing.metadata?.id ?? "",
          operation: "update",
        },
        Object.entries(before)
          .filter(([name, field]) => !field.plain && after[name] === undefined)
          .map(([, field]) => field.value),
      );
    },
  };
}

/** The sealed values a credential holds — the delete chain's extractor. */
export function secretValuesOfCredential(credential: Credential): string[] {
  return Object.values(credential.spec?.fields ?? {})
    .filter((field) => !field.plain)
    .map((field) => field.value);
}

// ---------------------------------------------------------------------------
// The field lanes.
// ---------------------------------------------------------------------------

/**
 * LoadCredentialById: loads by the `credential_id` input field into
 * TARGET_RESOURCE_KEY. Missing → NotFound; a store fault → Internal.
 */
export function newLoadCredentialByIdStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "LoadCredentialById",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      // ValidateProto precedes this step, and every input it serves
      // requires a non-empty credential_id.
      const credentialId = (ctx.input as { credentialId?: string }).credentialId ?? "";
      let credential: Credential;
      try {
        credential = await store.getResource(
          ctx.apiResourceKind,
          credentialId,
          CredentialSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("credential", credentialId);
        }
        throw internalError(error, "failed to load credential");
      }
      ctx.set(TARGET_RESOURCE_KEY, credential);
    },
  };
}

/** The credential LoadCredentialById put on the context; it precedes every field-lane step. */
function loadedCredential<Desc extends DescMessage>(ctx: RequestContext<Desc>): Credential {
  return ctx.get(TARGET_RESOURCE_KEY) as Credential;
}

/** Refuses a hand edit of a sign-in's fields; the sign-in lane (server-composed) passes. */
function guardSignInEdit<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
  credential: Credential,
): void {
  if (isSignIn(credential) && !isServerComposedRequest(ctx.callerIdentity)) {
    throw failedPreconditionError(SIGN_IN_FIELDS_ARE_THE_PLATFORMS);
  }
}

/** Persists a field-lane write with its SpecAudit stamp. */
async function persistFieldWrite<Desc extends DescMessage>(
  store: Store,
  ctx: RequestContext<Desc>,
  credential: Credential,
  operation: string,
): Promise<void> {
  setAuditFieldsForUpdate(CredentialSchema, credential, "spec_audit", ctx.callerIdentity);
  try {
    await store.saveResource(
      ctx.apiResourceKind,
      credential.metadata?.id ?? "",
      CredentialSchema,
      credential,
    );
  } catch (error) {
    throw internalError(error, `failed to persist credential after ${operation}`);
  }
}

/**
 * SetFieldsAndPersist: merges the named fields into the loaded credential
 * and persists — its own write boundary (sentinel guard, merge, encrypt,
 * persist, same ordering as create/update). Fields not named are kept.
 * The sign-in lane's refresh writes through here too, as the server.
 */
export function newSetFieldsAndPersistStep(
  store: Store,
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof SetCredentialFieldsInputSchema> {
  return {
    name: "SetFieldsAndPersist",
    async execute(
      ctx: RequestContext<typeof SetCredentialFieldsInputSchema>,
    ): Promise<void> {
      const credential = loadedCredential(ctx);
      guardSignInEdit(ctx, credential);
      const spec = (credential.spec ??= create(CredentialSpecSchema));
      for (const [name, incoming] of Object.entries(ctx.input.fields)) {
        let field: CredentialField = incoming;
        if (!field.plain && field.value === REDACTED_MARKER) {
          const held = spec.fields[name];
          if (held !== undefined && !held.plain) {
            if (field.description !== "" && field.description !== held.description) {
              spec.fields[name] = create(CredentialFieldSchema, {
                value: held.value,
                plain: false,
                description: field.description,
              });
            }
            continue;
          }
          throw invalidArgumentError(markerRejectionMessage(name));
        }
        if (!field.plain && isCiphertextShaped(field.value)) {
          throw invalidArgumentError(forgedCiphertextMessage(name));
        }
        if (!field.plain && field.value !== "") {
          if (!secretService.isEnabled()) {
            logger.warn(
              "Encryption disabled: credential secret value will be stored in plaintext",
              { field: name },
            );
          } else {
            let sealed: string;
            try {
              sealed = await secretService.encrypt(
                field.value,
                EncryptionScope.forOrganization(credential.metadata?.org ?? ""),
              );
            } catch (error) {
              throw internalError(error, `failed to encrypt secret value for field '${name}'`);
            }
            field = create(CredentialFieldSchema, {
              value: sealed,
              plain: false,
              description: field.description,
            });
          }
        }
        spec.fields[name] = field;
      }
      await persistFieldWrite(store, ctx, credential, "setting fields");
      ctx.set(UPDATED_CREDENTIAL_KEY, credential);
    },
  };
}

/**
 * RemoveFieldsAndPersist: deletes the named fields (unknown names
 * ignored), persists, then destroys the removed secrets' backing state —
 * best-effort, after the persist, so a failure never fails the remove.
 */
export function newRemoveFieldsAndPersistStep(
  store: Store,
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof RemoveCredentialFieldsInputSchema> {
  return {
    name: "RemoveFieldsAndPersist",
    async execute(
      ctx: RequestContext<typeof RemoveCredentialFieldsInputSchema>,
    ): Promise<void> {
      const credential = loadedCredential(ctx);
      guardSignInEdit(ctx, credential);
      const removed: string[] = [];
      const fields = credential.spec?.fields;
      if (fields !== undefined) {
        for (const name of ctx.input.fields) {
          const held = fields[name];
          if (held !== undefined && !held.plain) {
            removed.push(held.value);
          }
          delete fields[name];
        }
      }
      await persistFieldWrite(store, ctx, credential, "removing fields");
      await destroySecretBackingState(
        secretService,
        logger,
        {
          kind: "credential",
          resourceId: credential.metadata?.id ?? "",
          operation: "removeFields",
        },
        removed,
      );
      ctx.set(UPDATED_CREDENTIAL_KEY, credential);
    },
  };
}

/**
 * RevealField: the one unredacted read. Refused on an organization's
 * credential (write-only; the model already gives it no owner, so the
 * Authorize step refuses first, and this arm keeps the promise if a grant
 * ever widened it). Missing field → NotFound; a plain field → as it is; a
 * secret → decrypted, a decrypt failure loud (Internal).
 */
export function newRevealFieldStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof RevealCredentialFieldInputSchema> {
  return {
    name: "RevealField",
    async execute(
      ctx: RequestContext<typeof RevealCredentialFieldInputSchema>,
    ): Promise<void> {
      const credential = loadedCredential(ctx);
      if (ownerOf(credential)?.kind !== "person") {
        throw failedPreconditionError(ORG_CREDENTIAL_IS_WRITE_ONLY);
      }
      const name = ctx.input.field;
      const field = credential.spec?.fields[name];
      if (field === undefined) {
        throw notFoundError("credential field", name);
      }
      if (field.plain || field.value === "") {
        ctx.set(REVEALED_FIELD_KEY, field);
        return;
      }
      let value: string;
      try {
        value = await secretService.decrypt(field.value);
      } catch (error) {
        logger.error("Failed to decrypt credential field", {
          field: name,
          error: error instanceof Error ? error.message : String(error),
        });
        throw internalError(error, "failed to decrypt secret value");
      }
      ctx.set(
        REVEALED_FIELD_KEY,
        create(CredentialFieldSchema, {
          value,
          plain: false,
          description: field.description,
        }),
      );
    },
  };
}
