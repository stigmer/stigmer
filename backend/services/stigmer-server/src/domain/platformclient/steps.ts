/**
 * Platform-client domain steps.
 *
 * The domain's persistence is a PORT (store.ts), so the shared steps that
 * touch storage (CheckDuplicate, LoadExisting, LoadTarget, LoadByReference,
 * Persist, the delete pair) come here under the SAME names over the port —
 * the identity-account domain's "own step, same name" precedent — and every
 * storage-free shared step is reused as it is. The shared context keys are
 * reused too, so BuildUpdateState finds EXISTING_RESOURCE_KEY and the
 * reference read's AuthorizeResolvedTarget finds TARGET_RESOURCE_KEY where
 * they expect them.
 *
 * The domain's own rules:
 *   - RefuseReservedSlug: `system-share-client` is the platform's (the
 *     cloud keeps each organization's system-managed share client under
 *     it, created through its driver, never through this chain), refused
 *     after ResolveSlug so a derived slug is refused too.
 *   - RefuseSystemManaged: a client carrying the reserved
 *     `stigmer.ai/system-managed` label is the platform's; update, delete
 *     and rotate refuse it FAILED_PRECONDITION with the cloud's copy.
 *   - GenerateClientCredentials, PreserveClientCredentials and
 *     RotateClientCredentials: the credential fields are the server's
 *     alone — generated on create (whatever the request carried), kept
 *     from the stored row on update, replaced (secret only; the client_id
 *     is permanent) on rotate. The plaintext secret is parked in the
 *     context for the one response that shows it, never persisted.
 *   - redactPlatformClient: the stored hash leaves on no response. It is
 *     cleared rather than marked (OAuthApp's `***REDACTED***` marker exists
 *     because its secret round-trips on update; this hash never does —
 *     PreserveClientCredentials restores it from the row).
 *
 * Not-found answers use the shared `notFoundError`, which renders exactly
 * the cloud's `PlatformClient not found: <id>`; the reference read keeps
 * the cloud's own sentence (constants.ts).
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import type { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import type { PlatformClientSpec } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";
import { PlatformClientSpecSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";

import {
  RESERVED_LABEL_TRUE,
  SYSTEM_MANAGED_LABEL,
} from "../../pipeline/apiresource-labels.js";
import {
  alreadyExistsError,
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { updateAuditFields } from "../../pipeline/steps/build-update-state.js";
import { RESOURCE_ID_KEY } from "../../pipeline/steps/delete.js";
import { requireOrgForReference } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { idValueOf, metadataOf } from "../../pipeline/steps/shapes.js";
import {
  PLATFORM_CLIENT_KIND_NAME,
  RESERVED_PLATFORM_CLIENT_SLUGS,
  referenceNotFoundMessage,
  reservedSlugMessage,
  systemManagedMessage,
} from "./constants.js";
import type { SystemManagedMutation } from "./constants.js";
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  secretFingerprint,
} from "./credentials.js";
import { DuplicatePlatformClientError } from "./store.js";
import type { PlatformClientStore } from "./store.js";

type ClientStep = PipelineStep<typeof PlatformClientSchema>;
type ClientContext = RequestContext<typeof PlatformClientSchema>;

/** Context key for the plaintext secret the create and rotate responses show once. */
export const CLIENT_SECRET_PLAINTEXT_KEY = "platformClientSecretPlaintext";

/** Clears the stored hash in place and answers the client — every response goes through it. */
export function redactPlatformClient(client: PlatformClient): PlatformClient {
  if (client.spec !== undefined) {
    client.spec.clientSecretHash = "";
  }
  return client;
}

/** The plaintext secret a credential step parked, or an ordering fault. */
export function parkedClientSecret<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): string {
  const secret = ctx.get(CLIENT_SECRET_PLAINTEXT_KEY);
  if (typeof secret !== "string" || secret === "") {
    throw internalError(
      new Error("no client secret parked — a credential step must run first"),
      "platform client credentials",
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function newRefuseReservedSlugStep(): ClientStep {
  return {
    name: "RefuseReservedSlug",
    execute(ctx: ClientContext): void {
      const slug = metadataOf(ctx.newState)?.slug ?? "";
      if (RESERVED_PLATFORM_CLIENT_SLUGS.has(slug)) {
        throw invalidArgumentError(reservedSlugMessage(slug));
      }
    },
  };
}

/** Rejects a create whose slug the organization already holds. */
export function newCheckDuplicateStep(clients: PlatformClientStore): ClientStep {
  return {
    name: "CheckDuplicate",
    async execute(ctx: ClientContext): Promise<void> {
      const metadata = requireMetadata(ctx, "duplicate check");
      const existing = await clients.findByOrgAndSlug(metadata.org, metadata.slug);
      if (existing !== undefined) {
        throw alreadyExistsError(
          PLATFORM_CLIENT_KIND_NAME,
          `slug '${metadata.slug}' in org '${metadata.org}' (id: ${existing.metadata?.id ?? ""})`,
        );
      }
    },
  };
}

/** Generates the credential fields after BuildNewState, parking the plaintext for the response. */
export function newGenerateClientCredentialsStep(): ClientStep {
  return {
    name: "GenerateClientCredentials",
    execute(ctx: ClientContext): void {
      const spec = specOf(ctx.newState);
      const secret = generateClientSecret();
      spec.clientId = generateClientId();
      spec.clientSecretHash = hashClientSecret(secret);
      spec.secretFingerprint = secretFingerprint(secret);
      ctx.set(CLIENT_SECRET_PLAINTEXT_KEY, secret);
    },
  };
}

/** Saves the new client through the port; a held slug or client_id is ALREADY_EXISTS. */
export function newPersistNewClientStep(clients: PlatformClientStore): ClientStep {
  return {
    name: "Persist",
    async execute(ctx: ClientContext): Promise<void> {
      try {
        await clients.save(ctx.newState);
      } catch (error) {
        if (error instanceof DuplicatePlatformClientError) {
          // The race the duplicate check could not see.
          const metadata = requireMetadata(ctx, "persist");
          throw alreadyExistsError(
            PLATFORM_CLIENT_KIND_NAME,
            `slug '${metadata.slug}' in org '${metadata.org}'`,
          );
        }
        throw internalError(error, "failed to save platform client");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/** Loads the client by id, else by org-scoped slug (the id written back), into EXISTING_RESOURCE_KEY. */
export function newLoadExistingClientStep(clients: PlatformClientStore): ClientStep {
  return {
    name: "LoadExisting",
    async execute(ctx: ClientContext): Promise<void> {
      const metadata = requireMetadata(ctx, "load existing");
      let existing: PlatformClient | undefined;
      if (metadata.id !== "") {
        existing = await clients.findById(metadata.id);
        if (existing === undefined) {
          throw notFoundError(PLATFORM_CLIENT_KIND_NAME, metadata.id);
        }
      } else if (metadata.slug !== "") {
        existing = await clients.findByOrgAndSlug(metadata.org, metadata.slug);
        if (existing === undefined) {
          throw notFoundError(PLATFORM_CLIENT_KIND_NAME, metadata.slug);
        }
        metadata.id = existing.metadata?.id ?? "";
      } else {
        throw invalidArgumentError("resource id or slug is required for update");
      }
      ctx.set(EXISTING_RESOURCE_KEY, existing);
    },
  };
}

/** Restores the credential fields from the stored row after BuildUpdateState. */
export function newPreserveClientCredentialsStep(): ClientStep {
  return {
    name: "PreserveClientCredentials",
    execute(ctx: ClientContext): void {
      const existing = storedClientOf(ctx, EXISTING_RESOURCE_KEY);
      const spec = specOf(ctx.newState);
      spec.clientId = existing.spec?.clientId ?? "";
      spec.clientSecretHash = existing.spec?.clientSecretHash ?? "";
      spec.secretFingerprint = existing.spec?.secretFingerprint ?? "";
    },
  };
}

/** Replaces the row through the port. */
export function newPersistUpdatedClientStep(
  clients: PlatformClientStore,
): ClientStep {
  return {
    name: "Persist",
    async execute(ctx: ClientContext): Promise<void> {
      try {
        await clients.update(ctx.newState);
      } catch (error) {
        throw internalError(error, "failed to save platform client");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Update, delete and rotate: the platform's own clients
// ---------------------------------------------------------------------------

/** Refuses a mutation of a client carrying the system-managed label, read from `key`. */
export function newRefuseSystemManagedStep<Desc extends DescMessage>(
  verb: SystemManagedMutation,
  key: typeof EXISTING_RESOURCE_KEY | typeof TARGET_RESOURCE_KEY,
): PipelineStep<Desc> {
  return {
    name: "RefuseSystemManaged",
    execute(ctx: RequestContext<Desc>): void {
      const client = storedClientOf(ctx, key);
      if (client.metadata?.labels[SYSTEM_MANAGED_LABEL] === RESERVED_LABEL_TRUE) {
        throw failedPreconditionError(systemManagedMessage(verb));
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Get, getByReference, rotate
// ---------------------------------------------------------------------------

/** Loads the client named by an ID-wrapper input into TARGET_RESOURCE_KEY. */
export function newLoadTargetClientStep<InputDesc extends DescMessage>(
  clients: PlatformClientStore,
): PipelineStep<InputDesc> {
  return {
    name: "LoadTarget",
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      const id = idValueOf(ctx.input);
      if (id === "") {
        throw invalidArgumentError("resource id is required");
      }
      ctx.set(TARGET_RESOURCE_KEY, await readClient(clients, id));
    },
  };
}

/** Loads the client an org/slug reference names into TARGET_RESOURCE_KEY, with the cloud's copy. */
export function newLoadClientByReferenceStep(
  clients: PlatformClientStore,
): PipelineStep<typeof ApiResourceReferenceSchema> {
  return {
    name: "LoadByReference",
    async execute(
      ctx: RequestContext<typeof ApiResourceReferenceSchema>,
    ): Promise<void> {
      const ref = ctx.input;
      if (ref.slug === "") {
        throw invalidArgumentError("slug is required in reference");
      }
      if (
        ref.kind !== ApiResourceKind.api_resource_kind_unknown &&
        ref.kind !== ApiResourceKind.platform_client
      ) {
        throw invalidArgumentError(
          `kind mismatch: expected platform_client, got ${ApiResourceKind[ref.kind] ?? String(ref.kind)}`,
        );
      }
      requireOrgForReference(ApiResourceKind.platform_client, ref.org);
      const client = await clients.findByOrgAndSlug(ref.org, ref.slug);
      if (client === undefined) {
        throw new ConnectError(
          referenceNotFoundMessage(ref.org, ref.slug),
          Code.NotFound,
        );
      }
      ctx.set(TARGET_RESOURCE_KEY, client);
    },
  };
}

/**
 * Replaces the loaded client's secret in place (the client_id is
 * permanent), stamps the update audit as the caller, and parks the
 * plaintext for the response. The expiry is left as it is: rotating a
 * secret does not extend a client the owner set to expire.
 */
export function newRotateClientCredentialsStep<
  InputDesc extends DescMessage,
>(): PipelineStep<InputDesc> {
  return {
    name: "RotateClientCredentials",
    execute(ctx: RequestContext<InputDesc>): void {
      const client = storedClientOf(ctx, TARGET_RESOURCE_KEY);
      const spec = specOf(client);
      const secret = generateClientSecret();
      spec.clientSecretHash = hashClientSecret(secret);
      spec.secretFingerprint = secretFingerprint(secret);
      // The row is its own "existing": the creation stamp is read before
      // the fresh audit block replaces it.
      updateAuditFields(PlatformClientSchema, client, client, ctx.callerIdentity);
      ctx.set(CLIENT_SECRET_PLAINTEXT_KEY, secret);
    },
  };
}

/** Writes the rotated TARGET_RESOURCE_KEY client through the port. */
export function newPersistTargetClientStep<InputDesc extends DescMessage>(
  clients: PlatformClientStore,
): PipelineStep<InputDesc> {
  return {
    name: "Persist",
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      try {
        await clients.update(storedClientOf(ctx, TARGET_RESOURCE_KEY));
      } catch (error) {
        throw internalError(error, "failed to save platform client");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Delete (ApiResourceDeleteInput; the handler sets RESOURCE_ID_KEY)
// ---------------------------------------------------------------------------

export function newLoadExistingClientForDeleteStep<
  InputDesc extends DescMessage,
>(clients: PlatformClientStore): PipelineStep<InputDesc> {
  return {
    name: "LoadExistingForDelete",
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      ctx.set(
        EXISTING_RESOURCE_KEY,
        await readClient(clients, requireResourceId(ctx)),
      );
    },
  };
}

export function newDeleteClientStep<InputDesc extends DescMessage>(
  clients: PlatformClientStore,
): PipelineStep<InputDesc> {
  return {
    name: "DeleteResource",
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      try {
        await clients.deleteById(requireResourceId(ctx));
      } catch (error) {
        throw internalError(error, "failed to delete platform client");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Shared readers
// ---------------------------------------------------------------------------

/** The client by id, or the shared NOT_FOUND; any other fault propagates. */
async function readClient(
  clients: PlatformClientStore,
  id: string,
): Promise<PlatformClient> {
  const client = await clients.findById(id);
  if (client === undefined) {
    throw notFoundError(PLATFORM_CLIENT_KIND_NAME, id);
  }
  return client;
}

/** The client a load step stashed under `key`, or an ordering fault. */
export function storedClientOf<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
  key: string,
): PlatformClient {
  const client = ctx.get(key) as PlatformClient | undefined;
  if (client === undefined) {
    throw internalError(
      new Error(`no platform client under '${key}' — its load step must run first`),
      "platform client chain ordering",
    );
  }
  return client;
}

function requireMetadata(ctx: ClientContext, operation: string) {
  const metadata = metadataOf(ctx.newState);
  if (metadata === undefined) {
    throw internalError(new Error("platform client metadata is nil"), operation);
  }
  return metadata;
}

/** The client's spec, created in place when the caller omitted it (every field defaults). */
function specOf(client: PlatformClient): PlatformClientSpec {
  if (client.spec === undefined) {
    client.spec = create(PlatformClientSpecSchema);
  }
  return client.spec;
}

function requireResourceId<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): string {
  const id = ctx.get(RESOURCE_ID_KEY);
  if (typeof id !== "string" || id === "") {
    throw internalError(
      new Error("resource id not found in context (the delete handler sets it)"),
      "platform client delete ordering",
    );
  }
  return id;
}
