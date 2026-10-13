/**
 * The IdentityProvider chains' own steps: the reads the OSS chain steps
 * need done over the composition's table (`ee.iam_identity_provider`),
 * because the library's versions read its Store. Each keeps the OSS step's
 * name, and each refusal keeps the provider's own copy, so a failure log
 * reads like the library's and a caller reads what it always read. A
 * create's id needs no step here: the library's BuildNewState mints it
 * whatever the request carried.
 *
 *   CheckDuplicate   the org-scoped slug check before a create persists
 *   LoadExisting     the update's stored row, under EXISTING_RESOURCE_KEY,
 *                    for the OSS BuildUpdateState; a provider whose delete
 *                    has begun is refused, FAILED_PRECONDITION
 *   LoadForApply     apply's existence probe by org and slug, which never
 *                    refuses: the row under EXISTING_RESOURCE_KEY when it
 *                    exists, nothing when apply is a create
 *   LoadByReference  the reference read's row, under TARGET_RESOURCE_KEY,
 *                    for the OSS AuthorizeResolvedTarget; a miss is
 *                    NOT_FOUND only to the organization's admins, who see
 *                    every provider there, and `get`'s denial to anyone
 *                    else (reference-miss.ts)
 *   LoadTarget       a read or delete by id, under TARGET_RESOURCE_KEY
 */
import { clone } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderQueryController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/query_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type {
  Authorizer,
  NameHolder,
  NameTable,
  PipelineStep,
  RequestContext,
} from "@stigmer/server";
import {
  alreadyExistsError,
  EXISTING_RESOURCE_BYTES_KEY,
  EXISTING_RESOURCE_KEY,
  failedPreconditionError,
  findResourceForWrite,
  internalError,
  invalidArgumentError,
  nameTakenError,
  notFoundError,
  portHolder,
  resolveName,
  resolveNameEntry,
  TARGET_RESOURCE_KEY,
} from "@stigmer/server";

import { deniedCopyOf, refuseMissUnlessOrganizationBar } from "../reference-miss.js";
import type { IdentityProviderStore } from "./store.js";

/** The kind's name in refusal copy, as the provider service has always rendered it. */
export const PROVIDER_DISPLAY_NAME = "IdentityProvider";

/**
 * The provider a slug names in an organization: the server's one name
 * table (@stigmer/server `resolveName`), then this table by id.
 */
export async function findProviderByName(
  names: NameTable,
  providers: Pick<IdentityProviderStore, "findById">,
  org: string,
  slug: string,
): Promise<IdentityProvider | undefined> {
  const id = await resolveName(names, ApiResourceKind.identity_provider, org, slug);
  return id === undefined ? undefined : providers.findById(id);
}

/** A provider holds its name while its row exists. */
export function providerNameHolder(
  providers: Pick<IdentityProviderStore, "findById">,
): NameHolder {
  return portHolder((id) => providers.findById(id));
}

/**
 * The org-scoped slug check, before a create persists; ClaimName is the
 * guarantee. A slug a renamed provider still answers to is refused with
 * the library's SLUG_RESERVED (`nameTakenError`); a current holder keeps
 * the duplicate copy.
 */
export function newCheckDuplicateProviderStep(
  names: NameTable,
  providers: Pick<IdentityProviderStore, "findById">,
): PipelineStep<typeof IdentityProviderSchema> {
  return {
    name: "CheckDuplicate",
    async execute(ctx: RequestContext<typeof IdentityProviderSchema>): Promise<void> {
      const metadata = ctx.newState.metadata;
      const slug = metadata?.slug ?? "";
      if (slug === "") {
        throw internalError(new Error("resource slug is empty"), "duplicate check");
      }
      const entry = await resolveNameEntry(names, ApiResourceKind.identity_provider, metadata?.org ?? "", slug);
      const existing = entry === undefined ? undefined : await providers.findById(entry.id);
      if (entry !== undefined && existing !== undefined) {
        throw entry.state === "previous"
          ? nameTakenError(ApiResourceKind.identity_provider, entry)
          : duplicateProviderError(existing);
      }
    },
  };
}

/** The provider's duplicate copy, naming the held slug and organization. */
export function duplicateProviderError(existing: IdentityProvider): Error {
  const metadata = existing.metadata;
  return alreadyExistsError(
    PROVIDER_DISPLAY_NAME,
    `slug '${metadata?.slug ?? ""}' in org '${metadata?.org ?? ""}'`,
  );
}

/**
 * The refusal an edit of a provider being deleted answers, during its
 * delete or after one that faulted: the delete keeps the provider dark
 * until it runs to the end (removal.ts), so an edit would change nothing
 * an admin could see work.
 */
export const PROVIDER_BEING_DELETED_MESSAGE =
  "This identity provider is being deleted. If its delete failed, delete it again to finish.";

/**
 * The update's stored row, for the OSS BuildUpdateState; apply's update
 * arm comes here too. A provider being deleted is refused after the
 * Authorize step, so only a caller who may edit it learns of the delete.
 */
export function newLoadExistingProviderStep(
  providers: Pick<IdentityProviderStore, "findById" | "isLive" | "readForWrite">,
): PipelineStep<typeof IdentityProviderSchema> {
  return {
    name: "LoadExisting",
    async execute(ctx: RequestContext<typeof IdentityProviderSchema>): Promise<void> {
      const id = ctx.input.metadata?.id ?? "";
      if (id === "") {
        throw invalidArgumentError("resource id is required for update");
      }
      const read = await providers.readForWrite(id);
      if (read === undefined || !(await providers.isLive(id))) {
        // Absent, or not live: marked, or, if its delete finished between
        // the two reads, gone; a gone provider answers as one.
        await requireProvider(providers, id);
        throw failedPreconditionError(PROVIDER_BEING_DELETED_MESSAGE);
      }
      ctx.set(EXISTING_RESOURCE_KEY, read.row);
      // The bytes the update's guarded write swaps on.
      ctx.set(EXISTING_RESOURCE_BYTES_KEY, read.bytes);
    },
  };
}

/**
 * A rename's refusal of a provider being deleted, after LoadForRename (the
 * row is under EXISTING_RESOURCE_KEY), with the update's copy: the delete
 * keeps the provider dark until it runs to the end.
 */
export function newRefuseRenamingDeletedProviderStep<Desc extends DescMessage>(
  providers: Pick<IdentityProviderStore, "isLive">,
): PipelineStep<Desc> {
  return {
    name: "RefuseBeingDeleted",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const provider = ctx.get(EXISTING_RESOURCE_KEY) as IdentityProvider;
      if (!(await providers.isLive(provider.metadata?.id ?? ""))) {
        throw failedPreconditionError(PROVIDER_BEING_DELETED_MESSAGE);
      }
    },
  };
}

/**
 * Apply's existence probe (after ResolveSlug), the library's rule for every
 * write (`findResourceForWrite`): by the id the request carries when a
 * provider of the request's organization holds it, else by org and slug. A
 * slug the provider was renamed away from is refused with SLUG_RENAMED;
 * nothing else refuses here.
 */
export function newLoadProviderForApplyStep(
  names: NameTable,
  providers: Pick<IdentityProviderStore, "findById">,
): PipelineStep<typeof IdentityProviderSchema> {
  return {
    name: "LoadForApply",
    async execute(ctx: RequestContext<typeof IdentityProviderSchema>): Promise<void> {
      const metadata = ctx.newState.metadata;
      const target = { id: metadata?.id ?? "", org: metadata?.org ?? "", slug: metadata?.slug ?? "" };
      if (target.id === "" && target.slug === "") {
        return;
      }
      const existing = await findResourceForWrite<typeof IdentityProviderSchema>(
        names,
        ApiResourceKind.identity_provider,
        target,
        (id) => providers.findById(id),
      );
      if (existing !== undefined) {
        ctx.set(EXISTING_RESOURCE_KEY, existing);
      }
    },
  };
}

/** The row LoadForApply found, or undefined when apply is a create. */
export function providerForApply(ctx: { get(key: string): unknown }): IdentityProvider | undefined {
  return ctx.get(EXISTING_RESOURCE_KEY) as IdentityProvider | undefined;
}

/**
 * Apply's update arm: the ORIGINAL request (never the decision chain's
 * shaped copy) with the id of the row apply resolved by org and slug. The
 * resolved id always wins over one the request carries, unlike the OSS
 * `withResolvedApplyId`: a provider's id is the server's, and a request's
 * own id could name another organization's provider.
 */
export function withResolvedProviderId(
  original: IdentityProvider,
  resolved: IdentityProvider,
): IdentityProvider {
  const enriched = clone(IdentityProviderSchema, original);
  if (enriched.metadata !== undefined) {
    enriched.metadata.id = resolved.metadata?.id ?? "";
  }
  return enriched;
}

/**
 * The reference read's row, for the OSS AuthorizeResolvedTarget. A miss
 * asks the organization's `can_create_idp` (its admins, the people who see
 * every provider it holds) before it answers NOT_FOUND; anyone else gets
 * the refusal `get` answers a provider they may not see.
 */
export function newLoadProviderByReferenceStep(
  names: NameTable,
  providers: Pick<IdentityProviderStore, "findById">,
  authorizer: Authorizer,
): PipelineStep<typeof ApiResourceReferenceSchema> {
  const deniedMessage = deniedCopyOf(IdentityProviderQueryController.method.get);
  return {
    name: "LoadByReference",
    async execute(ctx: RequestContext<typeof ApiResourceReferenceSchema>): Promise<void> {
      const ref = ctx.input;
      if (ref.slug === "" && ref.id === "") {
        throw invalidArgumentError("slug or id is required in reference");
      }
      if (
        ref.kind !== ApiResourceKind.api_resource_kind_unknown &&
        ref.kind !== ApiResourceKind.identity_provider
      ) {
        throw invalidArgumentError(
          `kind mismatch: expected identity_provider, got ${ApiResourceKind[ref.kind] ?? String(ref.kind)}`,
        );
      }
      if (ref.org === "") {
        throw invalidArgumentError(`org is required for ${PROVIDER_DISPLAY_NAME} lookup`);
      }
      const provider = await findByHeldReference(names, providers, ApiResourceKind.identity_provider, ref);
      if (provider === undefined) {
        await refuseMissUnlessOrganizationBar(authorizer, ctx.callerIdentity, {
          organization: ref.org,
          permission: IamPermission.can_create_idp,
          deniedMessage,
        });
        throw notFoundByReference(ref.org, ref.slug !== "" ? ref.slug : ref.id);
      }
      ctx.set(TARGET_RESOURCE_KEY, provider);
    },
  };
}

/** A read by id, for `get` and `delete`; `idOf` names the request's id field. */
export function newLoadProviderStep<Desc extends DescMessage>(
  providers: Pick<IdentityProviderStore, "findById">,
  idOf: (input: MessageShape<Desc>) => string,
): PipelineStep<Desc> {
  return {
    name: "LoadTarget",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const id = idOf(ctx.input);
      if (id === "") {
        throw invalidArgumentError("resource id is required");
      }
      ctx.set(TARGET_RESOURCE_KEY, await requireProvider(providers, id));
    },
  };
}

/** The row a load step stashed under `key`; the chain guarantees it. */
export function providerAt(ctx: { get(key: string): unknown }, key: string): IdentityProvider {
  const provider = ctx.get(key) as IdentityProvider | undefined;
  if (provider === undefined) {
    throw internalError(
      new Error(`no identity provider under ${key}`),
      "identity provider chain lost its loaded resource",
    );
  }
  return provider;
}

/** The provider's by-id not-found copy. */
export function notFoundById(id: string): Error {
  return notFoundError(PROVIDER_DISPLAY_NAME, id);
}

/** The provider's by-reference not-found copy, which names the organization too. */
function notFoundByReference(org: string, slug: string): Error {
  return new ConnectError(`${PROVIDER_DISPLAY_NAME} '${org}/${slug}' not found`, Code.NotFound);
}

async function requireProvider(
  providers: Pick<IdentityProviderStore, "findById">,
  id: string,
): Promise<IdentityProvider> {
  const provider = await providers.findById(id);
  if (provider === undefined) {
    throw notFoundById(id);
  }
  return provider;
}

/**
 * The identity provider a reference request names: by its id, the row in the
 * reference's organization; else by its org and slug through the name
 * table. Beside an id the slug is not looked up: the lane authorizes the
 * row only after this finds it, so asking the name table here would tell a
 * caller with no standing on the organization whether it holds a name
 * (findByReference in @stigmer/server says the same).
 */
async function findByHeldReference<Row extends { metadata?: { org: string; slug: string } }>(
  names: NameTable,
  rows: { findById(id: string): Promise<Row | undefined> },
  kind: ApiResourceKind,
  ref: { readonly org: string; readonly id: string; readonly slug: string },
): Promise<Row | undefined> {
  if (ref.id === "") {
    const id = await resolveName(names, kind, ref.org, ref.slug);
    return id === undefined ? undefined : rows.findById(id);
  }
  const row = await rows.findById(ref.id);
  return row === undefined || (row.metadata?.org ?? "") !== ref.org ? undefined : row;
}
