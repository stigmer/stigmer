/**
 * Names: every kind a person names files its resources under a minted id,
 * and its slug is a name in the one name table (the Store's
 * `resourceNames`; store/interface.ts states its guarantees), unique per
 * kind and organization. The table, not a scan of the rows, decides
 * "taken": `saveResource` upserts, so two creates that both read "absent"
 * would otherwise both write, and the store would hold two rows of one
 * slug (stigmer#2153).
 *
 * What this module gives every kind, organization's protocol made generic
 * (domain/organization/names.ts keeps that kind's own copy and reserved
 * refusals on top of it):
 *
 *   - claimName: take a name for an id, atomically. A name whose holder is
 *     gone is freed and taken again: an interrupted create or delete
 *     leaves such names behind. A holder is never judged gone while its
 *     claim is younger than ABANDONED_NAME_AFTER_MS, because a create
 *     holds its claim a step before its row exists, and a name equal to
 *     its holder's id is never gone (an earlier release filed a resource
 *     under it). Whether the holder still holds the name is the caller's
 *     question (NameHolder): a row read for most kinds, the kind's port
 *     where a composition keeps the rows elsewhere;
 *   - ClaimName, immediately before Persist on every create, after the
 *     gate slots and checks, so a refusal leaves nothing written; a lost
 *     claim answers the kind's duplicate copy. The create's caller ends
 *     the chain with releaseNameOnFailure, which lets the name go when the
 *     row never landed;
 *   - ReleaseNames, after the row is deleted, in the delete chain and the
 *     organization purge's copy of it. Best-effort: the row is gone, so a
 *     fault is logged, and the next claim of the name frees it;
 *   - findResourceByName: a name read through the table, then a point
 *     read by id, in place of the scan every lookup by slug used to run.
 *     A read follows a previous name a rename left for its hold
 *     (pipeline/steps/rename.ts);
 *   - findResourceForWrite: a write's lookup. By the id the request carries
 *     first, then by name; a previous name is refused with SLUG_RENAMED,
 *     because a write that kept following it would make a second resource
 *     once the hold ends. Every loader of a write calls it (LoadForApply,
 *     LoadExisting, and the probes of kinds kept elsewhere).
 *
 * NAMED_KINDS says, for every kind, whether its slug is claimed or why
 * not; __tests__/names.postgres.test.ts holds it equal to ApiResourceKind, so a new
 * kind cannot land without an answer.
 *
 * Proven by __tests__/names.postgres.test.ts (both drivers: the race, the gone
 * holder, the release), the kind-purge tests, and the store contract.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type {
  ResourceNameClaim,
  ResourceNameEntry,
  ResourceNameKey,
  ResourceReadForWrite,
  Store,
} from "../../store/interface.js";
import { getKindName, kindEnumName, kindNoun } from "../apiresource-meta.js";
import {
  alreadyExistsError,
  alreadyExistsWithReasonError,
  failedPreconditionError,
  internalError,
} from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { metadataOf } from "./shapes.js";

/**
 * How old a name must be before a holder that no longer holds it counts as
 * gone: a create claims its name a step before its row is stored, so a
 * younger claim may be a create in flight.
 */
export const ABANDONED_NAME_AFTER_MS = 60 * 1000;

/** Whether a kind's slug is a claimed name, or the reason it is not. */
export type NamedKind =
  | { readonly claims: true }
  | { readonly claims: false; readonly reason: string };

const CLAIMS: NamedKind = { claims: true };

/**
 * Every kind's answer. A kind that claims takes its slug in the name table
 * on create and lets it go on delete; lookups by its slug read the table.
 * A kind that does not is addressed by id, or its uniqueness lives where
 * its rows do.
 */
export const NAMED_KINDS: Readonly<Record<ApiResourceKind, NamedKind>> = {
  [ApiResourceKind.api_resource_kind_unknown]: {
    claims: false,
    reason: "not a kind",
  },
  [ApiResourceKind.api_resource_version]: {
    claims: false,
    reason: "no slug: a version is named by its resource and number",
  },
  [ApiResourceKind.grant]: {
    claims: false,
    reason: "its id is its natural key (subject, relation, object)",
  },
  // A service account claims its slug in the organization; a person's
  // account has no unique slug by design and claims nothing.
  [ApiResourceKind.identity_account]: CLAIMS,
  [ApiResourceKind.api_key]: {
    claims: false,
    reason: "addressed by id; its name is a label",
  },
  [ApiResourceKind.invitation]: {
    claims: false,
    reason:
      "the cloud's unique index is the claim; nothing references or renames it",
  },
  // The cloud's chains claim it through the exported steps.
  [ApiResourceKind.federation_issuer]: CLAIMS,
  [ApiResourceKind.oauth_app]: CLAIMS,
  // The cloud's chains claim it through the exported steps.
  [ApiResourceKind.team]: CLAIMS,
  // Unique across the server, under its own key (domain/organization/names.ts).
  [ApiResourceKind.organization]: CLAIMS,
  [ApiResourceKind.platform]: {
    claims: false,
    reason: "a singleton",
  },
  [ApiResourceKind.agent]: CLAIMS,
  [ApiResourceKind.run]: {
    claims: false,
    reason:
      "addressed by id; its slug follows its name, which two runs may share (an eval run's retried tries), and a schedule fire finds its run through the run list index",
  },
  [ApiResourceKind.session]: CLAIMS,
  [ApiResourceKind.skill]: CLAIMS,
  [ApiResourceKind.channel]: CLAIMS,
  [ApiResourceKind.channel_app]: CLAIMS,
  [ApiResourceKind.routine]: CLAIMS,
  [ApiResourceKind.memory]: CLAIMS,
  [ApiResourceKind.plugin]: CLAIMS,
  [ApiResourceKind.vault]: CLAIMS,
  [ApiResourceKind.score]: CLAIMS,
  [ApiResourceKind.scoring_rule]: CLAIMS,
  [ApiResourceKind.eval]: CLAIMS,
  [ApiResourceKind.eval_run]: CLAIMS,
  [ApiResourceKind.plan]: {
    claims: false,
    reason:
      "the cloud's unique index is the claim; nothing references or renames it",
  },
  [ApiResourceKind.subscription]: {
    claims: false,
    reason:
      "the cloud's unique index is the claim; nothing references or renames it",
  },
  [ApiResourceKind.license]: {
    claims: false,
    reason:
      "the cloud's unique index is the claim; nothing references or renames it",
  },
};

/** Whether the kind's slugs are names in the table. */
export function kindClaimsNames(kind: ApiResourceKind): boolean {
  return NAMED_KINDS[kind]?.claims === true;
}

/** A resource's slug as a key in the name table: unique per kind and organization. */
export function resourceNameKey(
  kind: ApiResourceKind,
  org: string,
  slug: string,
): ResourceNameKey {
  return { kind: kindEnumName(kind), org, name: slug };
}

/**
 * The name table a step claims in and releases from: the store's own, or
 * the one the composition hands a unit (ComposedServices.resourceNames),
 * which keeps its rows elsewhere and so passes its own NameHolder.
 */
export type NameTable = Pick<Store, "resourceNames">;

/**
 * Whether the resource a name points at still holds it. Asked only of a
 * claim old enough to be abandoned, and never of a name equal to its
 * holder's id.
 */
export interface NameHolder {
  holds(entry: ResourceNameEntry): Promise<boolean>;
}

/** A holder that holds its names while a row of the kind carries its id. */
export function storedRowHolder<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
): NameHolder {
  return {
    async holds(entry: ResourceNameEntry): Promise<boolean> {
      return (await readById(store, kind, schema, entry.id)) !== undefined;
    },
  };
}

/** A holder whose rows are read by id through a port (a composition's own table). */
export function portHolder(
  findById: (id: string) => Promise<unknown>,
): NameHolder {
  return {
    async holds(entry: ResourceNameEntry): Promise<boolean> {
      return (await findById(entry.id)) !== undefined;
    },
  };
}

/**
 * Takes `key` for `id`, atomically: of concurrent claims exactly one wins.
 * A name `id` already holds counts as claimed. A name lost to a holder
 * that no longer holds it, once the claim is old enough, is let go and
 * claimed once more; a name lost to a live holder comes back as the
 * entry that holds it.
 */
export async function claimName(
  store: NameTable,
  key: ResourceNameKey,
  id: string,
  now: Date,
  holder: NameHolder,
): Promise<ResourceNameClaim> {
  const at = now.toISOString();
  const claim = await store.resourceNames.claim(key, id, at);
  if (claim.claimed) {
    return claim;
  }
  const entry = claim.entry;
  if (entry.id === id) {
    return { claimed: true, entry };
  }
  if (!(await holderIsGone(entry, now, holder))) {
    return claim;
  }
  await store.resourceNames.releaseName(key, entry.id);
  return store.resourceNames.claim(key, id, at);
}

/**
 * Whether the resource a name points at is gone: it no longer holds the
 * name, and the claim is older than ABANDONED_NAME_AFTER_MS. A name equal
 * to its holder's id never counts as gone: an earlier release filed a
 * resource under it.
 */
export async function holderIsGone(
  entry: ResourceNameEntry,
  now: Date,
  holder: NameHolder,
): Promise<boolean> {
  if (entry.name === entry.id) {
    return false;
  }
  if (now.getTime() - Date.parse(entry.claimedAt) < ABANDONED_NAME_AFTER_MS) {
    return false;
  }
  return !(await holder.holds(entry));
}

/** Where ClaimName leaves the entry it won, for releaseNameAfterFailure. */
const CLAIMED_NAME_KEY = "resourceNameClaim";

/**
 * The ErrorInfo reason a create or rename carries when the slug is another
 * resource's recent previous name, which still leads to it. Wire contract,
 * documented on each renamable kind's create; metadata `slug`. An
 * organization keeps its own reason (domain/organization/names.ts).
 */
export const SLUG_RESERVED = "SLUG_RESERVED";

/**
 * The ErrorInfo reason a write carries when it names a resource by a slug
 * the resource was renamed away from. Reads follow the old slug for its
 * hold; a write does not, because a file that kept naming it would make a
 * second resource once the hold ends. Wire contract, documented on each
 * renamable kind's apply and update; metadata `slug`, the name the request
 * gave. The copy never names the current slug: the loaders run before the
 * write authorizes its target, so a caller who may not read the resource
 * must not learn its new name (a client that may read it looks it up by
 * the old slug, which still resolves).
 */
export const SLUG_RENAMED = "SLUG_RENAMED";

/** The refusal of a write that names a resource by a slug it was renamed away from. */
export function slugRenamedError(kind: ApiResourceKind, slug: string): Error {
  const noun = kindNoun(kind);
  return failedPreconditionError(
    `${capitalized(noun)} '${slug}' was renamed; it still leads to the same ${noun} for reading. Write to it by its current slug or its id`,
    { reason: SLUG_RENAMED, metadata: { slug } },
  );
}

/**
 * The refusal of a create or rename whose slug another resource of the
 * kind holds: SLUG_RESERVED for a recent previous name, which still leads
 * to the resource that held it, and the kind's duplicate copy for a
 * current one.
 */
export function nameTakenError(
  kind: ApiResourceKind,
  entry: ResourceNameEntry,
): Error {
  if (entry.state === "previous") {
    const noun = kindNoun(kind);
    return alreadyExistsWithReasonError(
      `${capitalized(noun)} slug '${entry.name}' was recently another ${noun}'s, and still leads to it`,
      { reason: SLUG_RESERVED, metadata: { slug: entry.name } },
    );
  }
  return alreadyExistsError(
    getKindName(kind),
    `slug '${entry.name}' in org '${entry.org}' (id: ${entry.id})`,
  );
}

/**
 * ClaimName: takes the new resource's slug for its minted id, immediately
 * before Persist. ResolveSlug and BuildNewState run first, so an empty
 * slug or id here is a server-side ordering bug. `holder` defaults to a
 * row of the kind in the store.
 */
export function newClaimNameStep<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  holder?: NameHolder,
): PipelineStep<Desc>;
export function newClaimNameStep<Desc extends DescMessage>(
  names: NameTable,
  kind: ApiResourceKind,
  holder: NameHolder,
): PipelineStep<Desc>;
export function newClaimNameStep<Desc extends DescMessage>(
  store: NameTable,
  kind: ApiResourceKind,
  holder?: NameHolder,
): PipelineStep<Desc> {
  return {
    name: "ClaimName",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      await claimNameOf(ctx, store, kind, ctx.newState, ctx.schema, holder);
    },
  };
}

/**
 * The claim ClaimName makes, for a chain whose resource is not its new
 * state (a push keeps the resource in a context value) or that claims only
 * some of its rows (a service account among identity accounts).
 */
export async function claimNameOf<Desc extends DescMessage>(
  ctx: Pick<RequestContext<DescMessage>, "set">,
  store: NameTable,
  kind: ApiResourceKind,
  resource: MessageShape<Desc>,
  schema: Desc,
  holder?: NameHolder,
  refusal: (entry: ResourceNameEntry) => Error = (entry) =>
    nameTakenError(kind, entry),
): Promise<void> {
  const metadata = metadataOf(resource);
  const slug = metadata?.slug ?? "";
  const id = metadata?.id ?? "";
  const org = metadata?.org ?? "";
  if (slug === "" || id === "") {
    throw internalError(
      new Error(`${kindEnumName(kind)} slug or id is empty at ClaimName`),
      "failed to claim the resource's name",
    );
  }
  const rowHolder = holder ?? defaultHolder(store, kind, schema);
  let claim: ResourceNameClaim;
  try {
    claim = await claimName(
      store,
      resourceNameKey(kind, org, slug),
      id,
      new Date(),
      rowHolder,
    );
  } catch (error) {
    throw internalError(error, "failed to claim the resource's name");
  }
  if (!claim.claimed) {
    throw refusal(claim.entry);
  }
  const claimed: ClaimedName = { entry: claim.entry, holder: rowHolder };
  ctx.set(CLAIMED_NAME_KEY, claimed);
}

/** What ClaimName leaves for the release after a failure. */
interface ClaimedName {
  readonly entry: ResourceNameEntry;
  readonly holder: NameHolder;
}

/**
 * Frees the name a failed create claimed, when its row was never stored,
 * so the caller's retry can take the slug again. Called by the create
 * around its chain. Whether the row exists decides, rather than which step
 * failed: a Persist that stored the row and then failed keeps the name,
 * because the resource exists. A fault is logged and leaves the name with
 * an id no row holds; the next claim frees it once it is
 * ABANDONED_NAME_AFTER_MS old.
 */
export async function releaseNameAfterFailure<Desc extends DescMessage>(
  store: NameTable,
  logger: Logger,
  ctx: RequestContext<Desc>,
): Promise<void> {
  const claimed = ctx.get(CLAIMED_NAME_KEY) as ClaimedName | undefined;
  if (claimed === undefined) {
    return;
  }
  const { entry, holder } = claimed;
  try {
    if (await holder.holds(entry)) {
      return;
    }
    await store.resourceNames.release(entry.kind, entry.org, entry.id);
  } catch (error) {
    logger.error(
      "create failed and its name claim could not be released; the name stays claimed until a later claim frees it",
      {
        kind: entry.kind,
        org: entry.org,
        name: entry.name,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * The create chain's failure handler, `.execute(ctx).catch(...)`: frees
 * the name claim when the row never landed (releaseNameAfterFailure), then
 * rethrows the chain's own error.
 */
export function releaseNameOnFailure<Desc extends DescMessage>(
  store: NameTable,
  logger: Logger,
  ctx: RequestContext<Desc>,
): (error: unknown) => Promise<never> {
  return async (error: unknown): Promise<never> => {
    await releaseNameAfterFailure(store, logger, ctx);
    throw error;
  };
}

/**
 * ReleaseNames: after the row is deleted, lets go of every name the
 * resource held in its kind and organization, so a later resource may take
 * its slug. Best-effort, as the delete's other post-row steps: the
 * resource is gone, so a fault is logged and the next claim frees the
 * name. Reads the deleted row from EXISTING_RESOURCE_KEY.
 */
export function newReleaseNamesStep<Desc extends DescMessage>(
  store: NameTable,
  logger: Logger,
  kind: ApiResourceKind,
): PipelineStep<Desc> {
  return {
    name: "ReleaseNames",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as
        | MessageShape<DescMessage>
        | undefined;
      const metadata =
        existing === undefined ? undefined : metadataOf(existing);
      const id = metadata?.id ?? "";
      if (id === "") {
        throw internalError(
          new Error(
            `${kindEnumName(kind)} delete reached ReleaseNames without its loaded row`,
          ),
          "failed to release the resource's names",
        );
      }
      await releaseNamesOfDeleted(store, logger, kind, metadata?.org ?? "", id);
    },
  };
}

/**
 * Lets go of every name a deleted resource held in its kind and
 * organization, after its row is gone: what ReleaseNames does, for the
 * cascades that delete a resource's rows outside its delete chain (an
 * agent's shares and scoring rules, a plugin's or an agent's evals).
 * Best-effort: the resource is gone, so a fault is logged and the next
 * claim of the name frees it.
 */
export async function releaseNamesOfDeleted(
  store: NameTable,
  logger: Logger,
  kind: ApiResourceKind,
  org: string,
  id: string,
): Promise<void> {
  try {
    await store.resourceNames.release(kindEnumName(kind), org, id);
  } catch (error) {
    logger.error(
      "resource deleted but its names could not be released; a later claim frees them",
      {
        kind: kindEnumName(kind),
        id,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/** The id `slug` names in the kind and organization at `now`, or undefined when nothing holds it. */
export async function resolveName(
  store: NameTable,
  kind: ApiResourceKind,
  org: string,
  slug: string,
  now: Date = new Date(),
): Promise<string | undefined> {
  return (await resolveNameEntry(store, kind, org, slug, now))?.id;
}

/**
 * The entry `slug` names in the kind and organization at `now`, current or
 * a previous name still held, or undefined when nothing holds it: what
 * resolveName answers, with the entry's state.
 */
export async function resolveNameEntry(
  store: NameTable,
  kind: ApiResourceKind,
  org: string,
  slug: string,
  now: Date = new Date(),
): Promise<ResourceNameEntry | undefined> {
  requireNamedKind(kind);
  return store.resourceNames.resolve(
    resourceNameKey(kind, org, slug),
    now.toISOString(),
  );
}

/**
 * The resource `slug` names in the kind and organization: a name read,
 * then a point read by id. Not-found is a normal outcome (undefined). An
 * empty org is the platform's own scope (a platform-scoped row's names
 * live there), never every organization, so no lookup by name crosses
 * organizations; a getByReference still refuses a reference without one
 * (requireOrgForReference), because a reference names an organization's
 * resource. A kind whose slugs are not names is a server-side bug.
 */
export async function findResourceByName<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
  org: string,
  slug: string,
  now: Date = new Date(),
): Promise<MessageShape<Desc> | undefined> {
  const id = await resolveName(store, kind, org, slug, now);
  if (id === undefined) {
    return undefined;
  }
  return readById(store, kind, schema, id);
}

/**
 * findResourceByName for a write that will swap on the row (a push onto a
 * resource it finds by slug): the resource with its exact stored bytes
 * (Store.readResourceForWrite), or undefined when the name holds none.
 */
export async function findResourceByNameForWrite<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
  org: string,
  slug: string,
  now: Date = new Date(),
): Promise<ResourceReadForWrite<Desc> | undefined> {
  const id = await resolveName(store, kind, org, slug, now);
  if (id === undefined) {
    return undefined;
  }
  try {
    return await store.readResourceForWrite(kind, id, schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

/** What a write names its resource by: the request's metadata. */
export interface WriteTarget {
  readonly id: string;
  readonly org: string;
  readonly slug: string;
}

/**
 * The resource a write names, or undefined when it names none: by the id
 * the request carries when a row of the kind in the request's organization
 * holds it, else by its slug through the table. A row the id holds in
 * another organization is passed over, so a manifest copied between
 * organizations makes its own resource; an id nothing holds falls through
 * to the slug. A slug the kind's resource was renamed away from is refused
 * with SLUG_RENAMED (slugRenamedError says why). `readById` reads a kind
 * whose rows a composition keeps elsewhere (its port); it defaults to the
 * store.
 */
export async function findResourceForWrite<Desc extends DescMessage>(
  store: NameTable,
  kind: ApiResourceKind,
  target: WriteTarget,
  readRow: (id: string) => Promise<MessageShape<Desc> | undefined>,
  now: Date = new Date(),
): Promise<MessageShape<Desc> | undefined> {
  if (target.id !== "") {
    const byId = await readRow(target.id);
    if (byId !== undefined && (metadataOf(byId)?.org ?? "") === target.org) {
      return byId;
    }
  }
  if (target.slug === "") {
    return undefined;
  }
  const entry = await resolveNameEntry(store, kind, target.org, target.slug, now);
  if (entry === undefined) {
    return undefined;
  }
  if (entry.state === "previous") {
    throw slugRenamedError(kind, target.slug);
  }
  return readRow(entry.id);
}

/** A reader of the kind's rows by id in the store, for findResourceForWrite. */
export function storedRowReader<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
): (id: string) => Promise<MessageShape<Desc> | undefined> {
  return (id) => readById(store, kind, schema, id);
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function requireNamedKind(kind: ApiResourceKind): void {
  if (!kindClaimsNames(kind)) {
    throw internalError(
      new Error(`${kindEnumName(kind)} slugs are not names; read it by id`),
      "failed to look the resource up by name",
    );
  }
}

/**
 * The holder a claim falls back to when its caller passes none: a row of
 * the kind in the store. A name table without the store's rows (a unit's)
 * must pass its own holder; one that does not is a server-side bug.
 */
function defaultHolder<Desc extends DescMessage>(
  names: NameTable,
  kind: ApiResourceKind,
  schema: Desc,
): NameHolder {
  if (!("getResource" in names)) {
    throw internalError(
      new Error(`a ${kindEnumName(kind)} claim over a name table alone names no holder`),
      "failed to claim the resource's name",
    );
  }
  return storedRowHolder(names as Store, kind, schema);
}

async function readById<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
  id: string,
): Promise<MessageShape<Desc> | undefined> {
  try {
    return await store.getResource(kind, id, schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}
