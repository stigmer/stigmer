/**
 * The read side of content-addressed versioning, shared by every kind whose
 * version is the SHA-256 of a pushed archive (skills, plugins): the
 * getByReference version ladder and the paginated version history. Skills
 * carried both alone (the Go LoadSkillByReferenceStep / ListVersions port);
 * plugins need the identical ladder over another schema, and a second copy
 * would be the drift the house forbids, so the steps take a
 * `VersionedResourceBinding` that names what differs per kind (the schema,
 * the noun in sentences, where the head hash and the live tag live, how a
 * snapshot maps to an entry) and keep everything else once.
 *
 * The ladder: resolve the live head by slug+org; empty/"latest" returns it;
 * a 64-hex version matches the head's hash or falls to the indexed
 * audit-by-hash lookup; anything else is a tag, matching the head's live
 * tag first (honest under the single-holder model: a push reconciles the
 * live tag with the audit tag column, clearing the live tag when
 * assignment fails) and then the indexed audit-by-tag lookup.
 *
 * listVersions marks is_current by HEAD-HASH match, not recency: under
 * repoint semantics (#475) re-pushing archived content re-activates its
 * existing row, so the current version need not be the newest-archived
 * one. Tags come from the audit COLUMN (the single-holder source of
 * truth), never from the snapshot.
 *
 * Proven by the skill domain's __tests__/skill.test.ts (ladder and
 * pagination blocks) and the skill and plugin conformance suites'
 * getByReference/listVersions blocks.
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
import { AuditNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
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
  /** The noun in sentences: "skill", "plugin". */
  readonly noun: string;
  /** The head's content hash (status.version_hash, status.digest). */
  headHashOf(resource: MessageShape<Desc>): string;
  /** The tag the live head claims (spec.tag; the plugin's manifest version). */
  liveTagOf(resource: MessageShape<Desc>): string;
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
          `kind mismatch: expected ${ApiResourceKind[binding.kind]}, got ${ApiResourceKind[ref.kind]}`,
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
        ctx.apiResourceKind,
        binding.schema,
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
 * Indexed audit lookup by hash or tag — not-found is a normal outcome
 * (undefined), storage failures are Internal.
 */
async function findAuditByVersion<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
  resourceId: string,
  version: string,
): Promise<MessageShape<Desc> | undefined> {
  if (isVersionHash(version)) {
    try {
      return await store.getAuditByHash(kind, resourceId, version, schema);
    } catch (error) {
      if (error instanceof AuditNotFoundError) {
        return undefined;
      }
      throw internalError(error, "failed to query audit by hash");
    }
  }
  try {
    return await store.getAuditByTag(kind, resourceId, version, schema);
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      return undefined;
    }
    throw internalError(error, "failed to query audit by tag");
  }
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

/** metadata.id of a resource message; every versioned kind carries the commons metadata. */
function idOf(resource: Message): string {
  return metadataOf(resource)?.id ?? "";
}
