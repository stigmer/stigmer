/**
 * The read side of content-addressed versioning, shared by every versioned
 * kind (agents, skills, plugins): the getByReference version
 * ladder, the paginated version history, one version by hash, and the tag
 * move. One copy, because two ladders drift: the steps take a
 * `VersionedResourceBinding` that names what differs per kind (the schema,
 * the noun in sentences, where the head hash and the live tag live, how a
 * tag is written onto a snapshot, how a snapshot maps to an entry) and keep
 * everything else once.
 *
 * The ladder: resolve the live head by slug+org; empty/"latest" returns it;
 * a 64-hex version matches the head's hash or falls to the indexed
 * audit-by-hash lookup; anything else is a tag, matching the head's live
 * tag first (honest under the single-holder model: a write reconciles the
 * live tag with the audit tag column, clearing the live tag when
 * assignment fails) and then the indexed audit-by-tag lookup. An archived
 * snapshot carries the tag it was archived with at best (snapshots archive
 * tagless), so the ladder and getVersion write the audit column's tag onto
 * it through `overlayTag`: a version whose tag later moved never claims it.
 * A kind whose "tag" is content (the plugin's manifest version) supplies no
 * overlay.
 *
 * listVersions marks is_current by HEAD-HASH match, not recency: under
 * repoint semantics (#475) re-pushing archived content re-activates its
 * existing row, so the current version need not be the newest-archived
 * one. Tags come from the audit COLUMN (the single-holder source of
 * truth), never from the snapshot.
 *
 * Proven by the skill domain's __tests__/skill.test.ts (ladder and
 * pagination blocks), the workflow and agent domains' version tests, and
 * the workflow, agent, skill and plugin conformance suites'
 * getByReference/listVersions/getVersion/tagVersion blocks.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage, Message, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import {
  AuditNotFoundError,
  ResourceNotFoundError,
} from "../../store/interface.js";
import type { AuditRecord, Store } from "../../store/interface.js";
import { findResourceBySlug, requireOrgForReference } from "./helpers.js";
import type { ResolvedTargetResolver } from "./authorize-resolved-target.js";
import { TARGET_RESOURCE_KEY } from "./load-target.js";
import { metadataOf } from "./shapes.js";

/** A 64-character lowercase-hex string (a SHA-256 content hash). */
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function isVersionHash(version: string): boolean {
  return HASH_PATTERN.test(version);
}

/** What a content-versioned kind must say about itself for the ladder. */
export interface VersionedResourceBinding<Desc extends DescMessage> {
  readonly kind: ApiResourceKind;
  readonly schema: Desc;
  /** The noun in sentences: "agent", "skill", "plugin". */
  readonly noun: string;
  /** The head's content hash (status.version_hash, status.digest). */
  headHashOf(resource: MessageShape<Desc>): string;
  /** The tag the live head claims (metadata.version.tag, spec.tag; the plugin's manifest version). */
  liveTagOf(resource: MessageShape<Desc>): string;
  /**
   * Writes `tag` where this kind's live tag lives: onto an archived
   * snapshot read back (the audit column's tag, the only current one) and
   * onto the head when a tag move reconciles it. Absent for a kind whose
   * tag is content (the plugin's manifest version), which must never be
   * rewritten.
   */
  overlayTag?(resource: MessageShape<Desc>, tag: string): void;
}

/**
 * A kind number as error copy: the name for a defined value, the bare
 * number for an unknown one. A reference's kind carries no defined-only
 * rule, and the JSON enum name throws on an unknown value.
 */
function kindLabel(kind: ApiResourceKind): string {
  return ApiResourceKind[kind] ?? String(kind);
}

type GetByReferenceDesc = typeof ApiResourceReferenceSchema;

/** The reference + version ladder (Go LoadSkillByReferenceStep, generalised). */
export function newLoadByReferenceWithVersionStep<Desc extends DescMessage>(
  store: Store,
  binding: VersionedResourceBinding<Desc>,
  stepName: string,
): PipelineStep<GetByReferenceDesc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<GetByReferenceDesc>): Promise<void> {
      const ref = ctx.input;

      if (ref.slug === "") {
        throw invalidArgumentError("slug is required in reference");
      }

      // Org-scoped kinds: the slug is unique only within an org, so an
      // empty-org reference is under-specified.
      requireOrgForReference(ctx.apiResourceKind, ref.org);

      if (
        ref.kind !== ApiResourceKind.api_resource_kind_unknown &&
        ref.kind !== binding.kind
      ) {
        throw invalidArgumentError(
          `kind mismatch: expected ${kindLabel(binding.kind)}, got ${kindLabel(ref.kind)}`,
        );
      }

      let head: MessageShape<Desc> | undefined;
      try {
        head = await findResourceBySlug(
          store,
          ctx.apiResourceKind,
          binding.schema,
          ref.slug,
          ref.org,
        );
      } catch (error) {
        throw internalError(error, `failed to list ${binding.noun}s`);
      }
      if (head === undefined) {
        throw notFoundError(binding.noun, ref.slug);
      }

      const version = ref.version.trim();
      if (version === "" || version === "latest") {
        ctx.set(TARGET_RESOURCE_KEY, head);
        return;
      }

      if (headMatchesVersion(binding, head, version)) {
        ctx.set(TARGET_RESOURCE_KEY, head);
        return;
      }

      const archived = await findAuditByVersion(
        store,
        binding,
        idOf(head),
        version,
      );
      if (archived === undefined) {
        throw notFoundError(
          `${binding.noun} version`,
          `${ref.slug}:${version}`,
        );
      }
      ctx.set(TARGET_RESOURCE_KEY, archived);
    },
  };
}

/**
 * The content hash `version` names on a resource whose live head is `head`,
 * by the ladder's order: the head's own hash for an empty version or
 * "latest", or when the head is the version by hash or live tag; else the
 * archived row's, by hash or by tag. Undefined when the resource holds no
 * such version; a store fault is Internal. The answer for a head written
 * before its kind was versioned, asked for its current version, is "".
 */
export async function resolveVersionHash<Desc extends DescMessage>(
  store: Store,
  binding: VersionedResourceBinding<Desc>,
  head: MessageShape<Desc>,
  version: string,
): Promise<string | undefined> {
  const named = version.trim();
  if (
    named === "" ||
    named === "latest" ||
    headMatchesVersion(binding, head, named)
  ) {
    return binding.headHashOf(head);
  }
  try {
    const record = isVersionHash(named)
      ? await store.getAuditRecordByHash(binding.kind, idOf(head), named)
      : await store.getAuditRecordByTag(binding.kind, idOf(head), named);
    return record.versionHash;
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      return undefined;
    }
    throw internalError(
      error,
      `failed to query ${binding.noun} audit by version`,
    );
  }
}

/** Whether the live head IS the requested version — by hash, or by its live tag. */
function headMatchesVersion<Desc extends DescMessage>(
  binding: VersionedResourceBinding<Desc>,
  head: MessageShape<Desc>,
  version: string,
): boolean {
  if (isVersionHash(version)) {
    return binding.headHashOf(head) === version;
  }
  const liveTag = binding.liveTagOf(head);
  return liveTag !== "" && liveTag === version;
}

/**
 * Indexed audit lookup by hash or tag, decoded with the audit column's tag
 * overlaid — not-found is a normal outcome (undefined), storage failures
 * are Internal.
 */
async function findAuditByVersion<Desc extends DescMessage>(
  store: Store,
  binding: VersionedResourceBinding<Desc>,
  resourceId: string,
  version: string,
): Promise<MessageShape<Desc> | undefined> {
  let record: AuditRecord;
  try {
    record = isVersionHash(version)
      ? await store.getAuditRecordByHash(binding.kind, resourceId, version)
      : await store.getAuditRecordByTag(binding.kind, resourceId, version);
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      return undefined;
    }
    throw internalError(
      error,
      `failed to query ${binding.noun} audit by version`,
    );
  }
  return decodeArchived(binding, record);
}

/** An audit row's snapshot with the column's tag written on; a corrupt row is Internal. */
function decodeArchived<Desc extends DescMessage>(
  binding: VersionedResourceBinding<Desc>,
  record: AuditRecord,
): MessageShape<Desc> {
  let snapshot: MessageShape<Desc>;
  try {
    snapshot = fromBinary(binding.schema, record.data);
  } catch (error) {
    throw internalError(
      error,
      `failed to decode archived ${binding.noun} version`,
    );
  }
  binding.overlayTag?.(snapshot, record.tag);
  return snapshot;
}

// ─── listVersions ────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export const LIST_VERSIONS_RESOURCE_ID_KEY = "listVersionsResourceId";
export const LIST_VERSIONS_HEAD_HASH_KEY = "listVersionsHeadHash";
export const LIST_VERSIONS_RESPONSE_KEY = "listVersionsResponse";

/**
 * The ListVersions lanes' authorization question, for the
 * AuthorizeResolvedTarget step placed after the slug resolver: `can_view`
 * on the resolved head's id (the version history of a row is readable by
 * whoever may read the row), with the lane's byte-pinned copy. The id key
 * is the resolver's own — the shared resolver stashes under
 * LIST_VERSIONS_RESOURCE_ID_KEY; a domain resolver with its own key names
 * it. An id the chain did not stash is a broken invariant and throws.
 */
export function versionHistoryTarget<Desc extends DescMessage>(
  kind: ApiResourceKind,
  deniedMessage: string,
  idKey: string = LIST_VERSIONS_RESOURCE_ID_KEY,
): ResolvedTargetResolver<Desc> {
  return (ctx) => {
    const resourceId = ctx.get(idKey);
    if (typeof resourceId !== "string" || resourceId === "") {
      throw new Error(
        `ListVersions: no resolved resource id under ${idKey}; the slug resolver must run first`,
      );
    }
    return [
      {
        permission: IamPermission.can_view,
        resourceKind: kind,
        resourceId,
        deniedMessage,
      },
    ];
  };
}

/** The fields every ListVersions input carries; the binding reads them off its own message. */
export interface ListVersionsInputShape {
  readonly org: string;
  readonly slug: string;
  readonly pageToken: string;
  readonly pageSize: number;
}

/** What differs per kind in the version history: the input, the entry, the response. */
export interface VersionHistoryBinding<
  Desc extends DescMessage,
  InputDesc extends DescMessage,
  Entry extends Message,
  Response extends Message,
> extends VersionedResourceBinding<Desc> {
  input(message: MessageShape<InputDesc>): ListVersionsInputShape;
  /** An archived snapshot to one entry; `tag` is the audit column's. */
  mapEntry(
    snapshot: MessageShape<Desc>,
    isCurrent: boolean,
    tag: string,
  ): Entry;
  response(
    entries: Entry[],
    nextPageToken: string,
    totalCount: number,
  ): Response;
}

/** Resolves the head by slug and captures its id and hash (Go ResolveSkillBySlugStep, generalised). */
export function newResolveBySlugForVersionsStep<
  Desc extends DescMessage,
  InputDesc extends DescMessage,
  Entry extends Message,
  Response extends Message,
>(
  store: Store,
  binding: VersionHistoryBinding<Desc, InputDesc, Entry, Response>,
  stepName: string,
): PipelineStep<InputDesc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      const req = binding.input(ctx.input);
      let head: MessageShape<Desc> | undefined;
      try {
        head = await findResourceBySlug(
          store,
          ctx.apiResourceKind,
          binding.schema,
          req.slug,
          req.org,
        );
      } catch (error) {
        throw internalError(error, `failed to search for ${binding.noun}`);
      }
      if (head === undefined) {
        throw notFoundError(binding.noun, `${req.slug} (org: ${req.org})`);
      }
      ctx.set(LIST_VERSIONS_RESOURCE_ID_KEY, idOf(head));
      // The live head's hash decides is_current downstream. Under repoint
      // semantics the current version need not be the newest-archived row,
      // so recency cannot stand in for currency.
      ctx.set(LIST_VERSIONS_HEAD_HASH_KEY, binding.headHashOf(head));
    },
  };
}

/** Audit records → entries → one page (Go LoadAndMapVersionsStep, generalised). */
export function newLoadAndMapVersionsStep<
  Desc extends DescMessage,
  InputDesc extends DescMessage,
  Entry extends Message,
  Response extends Message,
>(
  store: Store,
  binding: VersionHistoryBinding<Desc, InputDesc, Entry, Response>,
  stepName: string,
): PipelineStep<InputDesc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      const req = binding.input(ctx.input);
      const resourceId = ctx.get(LIST_VERSIONS_RESOURCE_ID_KEY) as string;

      let records;
      try {
        records = await store.listAuditRecords(ctx.apiResourceKind, resourceId);
      } catch (error) {
        throw internalError(error, "failed to load version history");
      }

      // is_current = the entry whose hash matches the live head, not the
      // newest row. Legacy data may hold duplicate-hash rows (predating
      // repoint semantics); marking only the first match keeps
      // exactly-one-current true for them too.
      const headHash = ctx.get(LIST_VERSIONS_HEAD_HASH_KEY) as string;
      let currentMarked = false;
      const entries: Entry[] = [];
      for (const record of records) {
        let snapshot: MessageShape<Desc>;
        try {
          snapshot = fromBinary(binding.schema, record.data);
        } catch {
          continue;
        }
        const isCurrent: boolean =
          !currentMarked &&
          headHash !== "" &&
          binding.headHashOf(snapshot) === headHash;
        currentMarked = currentMarked || isCurrent;
        // Tag comes from the audit column (source of truth), not the snapshot.
        entries.push(binding.mapEntry(snapshot, isCurrent, record.tag));
      }

      let pageSize = req.pageSize;
      if (pageSize <= 0) {
        pageSize = DEFAULT_PAGE_SIZE;
      }
      if (pageSize > MAX_PAGE_SIZE) {
        pageSize = MAX_PAGE_SIZE;
      }

      let startIndex = 0;
      if (req.pageToken !== "") {
        startIndex = decodePageToken(req.pageToken);
      }

      let pageEntries: Entry[] = [];
      let nextPageToken = "";
      if (startIndex < entries.length) {
        const end = Math.min(startIndex + pageSize, entries.length);
        pageEntries = entries.slice(startIndex, end);
        if (end < entries.length) {
          nextPageToken = Buffer.from(String(end)).toString("base64");
        }
      }

      ctx.set(
        LIST_VERSIONS_RESPONSE_KEY,
        binding.response(pageEntries, nextPageToken, entries.length),
      );
    },
  };
}

/**
 * Decodes the base64 cursor with Go's strictness: base64.StdEncoding
 * rejects malformed input and strconv.Atoi rejects trailing garbage —
 * Buffer.from is lenient on both, so validity is checked explicitly.
 */
export function decodePageToken(token: string): number {
  const decoded = Buffer.from(token, "base64");
  if (decoded.toString("base64") !== token) {
    throw invalidArgumentError("invalid page_token");
  }
  const text = decoded.toString("utf8");
  const index = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(index) || String(index) !== text || index < 0) {
    throw invalidArgumentError("invalid page_token");
  }
  return index;
}

// ─── getVersion ──────────────────────────────────────────────────────────

/** The fields every GetVersion input carries, read off the kind's own message. */
export interface VersionLookup {
  readonly resourceId: string;
  readonly versionHash: string;
}

/** One version of a resource, read by its hash. */
export interface LoadedVersion<Desc extends DescMessage> {
  /** The live head when it is the version, else the archived snapshot with the audit column's tag written on. */
  readonly resource: MessageShape<Desc>;
  /** Whether `resource` is the live head. */
  readonly isCurrent: boolean;
  /** The version's tag: the head's live tag, or the audit column's. */
  readonly tag: string;
}

/**
 * One version of a resource by its hash: the live head when the hash is
 * the head's, else the archived row. The one reader of a version by hash,
 * shared by getVersion (getVersionEntry) and every server-side read of
 * what a run pinned, so the two can never disagree about what a version
 * holds. A missing resource and a missing version are both NotFound,
 * naming which; a store fault is Internal. Asks no authorization.
 */
export async function loadVersion<Desc extends DescMessage>(
  store: Store,
  binding: VersionedResourceBinding<Desc>,
  resourceId: string,
  versionHash: string,
): Promise<LoadedVersion<Desc>> {
  let head: MessageShape<Desc>;
  try {
    head = await store.getResource(binding.kind, resourceId, binding.schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError(binding.noun, resourceId);
    }
    throw internalError(error, `failed to load ${binding.noun}`);
  }

  if (binding.headHashOf(head) === versionHash) {
    return { resource: head, isCurrent: true, tag: binding.liveTagOf(head) };
  }

  let record: AuditRecord;
  try {
    record = await store.getAuditRecordByHash(
      binding.kind,
      resourceId,
      versionHash,
    );
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      throw notFoundError(`${binding.noun} version`, truncateHash(versionHash));
    }
    throw internalError(
      error,
      `failed to load ${binding.noun} version from audit`,
    );
  }
  return {
    resource: decodeArchived(binding, record),
    isCurrent: false,
    tag: record.tag,
  };
}

/**
 * One version of a resource by its hash, as the kind's entry (loadVersion,
 * mapped): the live head with is_current and its live tag, which a tag
 * move keeps reconciled with the audit column, else the archived row with
 * the column's tag. The caller has already asked the annotation's
 * can_view on the resource id.
 */
export async function getVersionEntry<
  Desc extends DescMessage,
  InputDesc extends DescMessage,
  Entry extends Message,
  Response extends Message,
>(
  store: Store,
  binding: VersionHistoryBinding<Desc, InputDesc, Entry, Response>,
  lookup: VersionLookup,
): Promise<Entry> {
  const version = await loadVersion(
    store,
    binding,
    lookup.resourceId,
    lookup.versionHash,
  );
  return binding.mapEntry(version.resource, version.isCurrent, version.tag);
}

/** A hash shortened for messages and logs: the first 12 hex characters. */
export function truncateHash(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) + "..." : hash;
}

// ─── tagVersion ──────────────────────────────────────────────────────────

/** What a kind with a tag RPC says about its input and where its live tag lives. */
export interface VersionTagBinding<
  Desc extends DescMessage,
  InputDesc extends DescMessage,
> extends VersionedResourceBinding<Desc> {
  tagInput(message: MessageShape<InputDesc>): VersionLookup & {
    readonly tag: string;
  };
  overlayTag(resource: MessageShape<Desc>, tag: string): void;
}

/**
 * Loads the live resource the tag move targets, once, for the guard that
 * runs between this step and the move (a plugin-managed resource's tags
 * are its plugin's) and for the move itself.
 */
export function newLoadForTagVersionStep<
  Desc extends DescMessage,
  InputDesc extends DescMessage,
>(
  store: Store,
  binding: VersionTagBinding<Desc, InputDesc>,
  stepName: string,
  resourceKey: string,
): PipelineStep<InputDesc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      const { resourceId } = binding.tagInput(ctx.input);
      let resource: MessageShape<Desc>;
      try {
        resource = await store.getResource(
          binding.kind,
          resourceId,
          binding.schema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(binding.noun, resourceId);
        }
        throw internalError(error, `failed to load ${binding.noun}`);
      }
      ctx.set(resourceKey, resource);
    },
  };
}

/**
 * Moves a tag single-holder (git-tag semantics): the audit tag COLUMN is
 * the source of truth and setAuditTag clears any prior holder in the same
 * write. A hash with no audit row is NotFound and leaves the prior holder
 * untouched. The head's live tag is then reconciled to the head version's
 * post-move tag, which covers tagging the head, moving a tag off it, and
 * touching only archived versions alike. The updated head lands under
 * `resultKey`.
 */
export function newTagVersionStep<
  Desc extends DescMessage,
  InputDesc extends DescMessage,
>(
  store: Store,
  binding: VersionTagBinding<Desc, InputDesc>,
  stepName: string,
  resourceKey: string,
  resultKey: string,
): PipelineStep<InputDesc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      const req = binding.tagInput(ctx.input);
      const resource = ctx.get(resourceKey) as MessageShape<Desc>;

      try {
        await store.setAuditTag(
          binding.kind,
          req.resourceId,
          req.versionHash,
          req.tag,
        );
      } catch (error) {
        if (error instanceof AuditNotFoundError) {
          throw notFoundError(`${binding.noun} version`, req.versionHash);
        }
        throw internalError(
          error,
          `failed to assign ${binding.noun} version tag`,
        );
      }

      const headTag = await resolveHeadTag(
        store,
        binding,
        req.resourceId,
        binding.headHashOf(resource),
      );

      let updated: MessageShape<Desc>;
      try {
        updated = await store.updateResource(
          binding.kind,
          req.resourceId,
          binding.schema,
          (head) => binding.overlayTag(head, headTag),
        );
      } catch (error) {
        throw internalError(
          error,
          `failed to reconcile ${binding.noun} head tag`,
        );
      }
      ctx.set(resultKey, updated);
    },
  };
}

/**
 * The tag the head version holds in the audit column. An empty head hash or
 * a head without an audit row holds none.
 */
async function resolveHeadTag<Desc extends DescMessage>(
  store: Store,
  binding: VersionedResourceBinding<Desc>,
  resourceId: string,
  headHash: string,
): Promise<string> {
  if (headHash === "") {
    return "";
  }
  try {
    const record = await store.getAuditRecordByHash(
      binding.kind,
      resourceId,
      headHash,
    );
    return record.tag;
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      return "";
    }
    throw internalError(error, "failed to resolve head version tag");
  }
}

/** metadata.id of a resource message; every versioned kind carries the commons metadata. */
function idOf(resource: Message): string {
  return metadataOf(resource)?.id ?? "";
}
