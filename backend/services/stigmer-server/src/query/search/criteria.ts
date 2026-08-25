/**
 * Search criteria value object — ports
 * pkg/query/search/valueobject/search_criteria.go: validated, normalized,
 * immutable search parameters and the three-mode contract (list / search /
 * discover).
 *
 * The searchable-kind set is DERIVED from the proto kind_meta extension
 * (not_search_indexed: false, tier != cloud_only) — Go's
 * SearchIndexedKinds() posture since stigmer/stigmer#439, where hand-copied
 * kind lists drifted from the proto and from each other. Go still carries a
 * hand map (SearchableKinds) pinned to the derivation by an invariant test;
 * here the derivation IS the set — parity by construction, one source. The
 * registry unit test pins the registered extractors against this same
 * derivation (the #439 invariant's TS home).
 *
 * kinds are kept VERBATIM from the request; filtering to the searchable set
 * happens in effectiveKinds(). Keeping the raw request is what
 * distinguishes "no kinds requested" (discover mode) from "kinds requested
 * but none searchable" (empty result) — collapsing the two at construction
 * made kind-targeted requests for non-searchable kinds silently degrade to
 * discover mode and return every other kind's resources
 * (stigmer/stigmer#440).
 *
 * Proven by __tests__/criteria.test.ts (Go's tables case-for-case) and
 * search.conformance.test.ts on local.
 */
import {
  ApiResourceKind,
  ApiResourceKindSchema,
  ResourceTier,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { goTrimSpace } from "../../gocompat/trim.js";
import { getKindMeta } from "../../pipeline/apiresource-meta.js";

/** Go DefaultPageSize. */
export const DEFAULT_PAGE_SIZE = 20;
/** Go MaxPageSize. */
export const MAX_PAGE_SIZE = 100;
/** Go MaxQueryLength (the proto's max_len twin; see newSearchCriteria). */
export const MAX_QUERY_LENGTH = 500;

let searchIndexedKindsCache: readonly ApiResourceKind[] | undefined;
let searchableKindSetCache: ReadonlySet<ApiResourceKind> | undefined;

/**
 * Go SearchIndexedKinds(): every kind this edition's search read side
 * serves — kind_meta declares it search-indexed and servable outside the
 * cloud. Sorted ascending by enum value, exactly Go's sort. Kinds whose
 * kind_meta cannot be read are skipped (Go's contract; the registry unit
 * test separately fails on such a defect).
 */
export function searchIndexedKinds(): readonly ApiResourceKind[] {
  if (searchIndexedKindsCache === undefined) {
    const kinds: ApiResourceKind[] = [];
    for (const value of ApiResourceKindSchema.values) {
      const kind = value.number as ApiResourceKind;
      if (kind === ApiResourceKind.api_resource_kind_unknown) {
        continue;
      }
      let meta;
      try {
        meta = getKindMeta(kind);
      } catch {
        continue;
      }
      if (meta.notSearchIndexed || meta.tier === ResourceTier.cloud_only) {
        continue;
      }
      kinds.push(kind);
    }
    kinds.sort((a, b) => a - b);
    searchIndexedKindsCache = kinds;
  }
  return searchIndexedKindsCache;
}

/** The derivation as a Set — effectiveKinds' filter (Go SearchableKinds). */
function searchableKindSet(): ReadonlySet<ApiResourceKind> {
  if (searchableKindSetCache === undefined) {
    searchableKindSetCache = new Set(searchIndexedKinds());
  }
  return searchableKindSetCache;
}

/**
 * Immutable, validated search parameters. Construct via newSearchCriteria.
 */
export class SearchCriteria {
  private constructor(
    private readonly requestedKinds: readonly ApiResourceKind[],
    private readonly queryText: string,
    private readonly orgFilterValue: string,
    private readonly excludePublicFlag: boolean,
    private readonly crossOrgPublicFlag: boolean,
    private readonly pageNumberValue: number,
    private readonly pageSizeValue: number,
  ) {}

  /**
   * Go NewSearchCriteria: trims query and org, clamps pagination
   * (num < 1 → 1; size < 1 → default 20; size > 100 → 100), keeps kinds
   * verbatim. Throws on an over-length query — defensive twin of the
   * proto's max_len 500, which the protovalidate interceptor answers
   * first on the wire (Go carries the same unreachable guard).
   *
   * Trimming is goTrimSpace, NOT String.trim: hasQuery() decides
   * list-vs-search mode from the trimmed query, and the two trim sets
   * disagree on U+FEFF/U+0085 — a BOM-only query would read as list mode
   * (return everything) where Go runs an empty-match search (the #8 BOM
   * divergence class, caught again by this sub-project's parity panel).
   */
  static create(
    kinds: readonly ApiResourceKind[],
    query: string,
    orgFilter: string,
    excludePublic: boolean,
    crossOrgPublic: boolean,
    pageNumber: number,
    pageSize: number,
  ): SearchCriteria {
    const normalizedQuery = goTrimSpace(query);
    if (normalizedQuery.length > MAX_QUERY_LENGTH) {
      throw new Error(
        `search query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`,
      );
    }
    return new SearchCriteria(
      [...kinds],
      normalizedQuery,
      goTrimSpace(orgFilter),
      excludePublic,
      crossOrgPublic,
      pageNumber < 1 ? 1 : pageNumber,
      pageSize < 1 ? DEFAULT_PAGE_SIZE : Math.min(pageSize, MAX_PAGE_SIZE),
    );
  }

  /** The requested kinds VERBATIM — including non-searchable ones. */
  kinds(): readonly ApiResourceKind[] {
    return [...this.requestedKinds];
  }

  query(): string {
    return this.queryText;
  }

  orgFilter(): string {
    return this.orgFilterValue;
  }

  excludePublic(): boolean {
    return this.excludePublicFlag;
  }

  crossOrgPublic(): boolean {
    return this.crossOrgPublicFlag;
  }

  pageNumber(): number {
    return this.pageNumberValue;
  }

  pageSize(): number {
    return this.pageSizeValue;
  }

  /**
   * Discover mode = NO kinds requested. A request naming only
   * non-searchable kinds is NOT discover mode — it searches nothing.
   */
  isDiscoverMode(): boolean {
    return this.requestedKinds.length === 0;
  }

  /** False = list mode (created_at ordering, score pinned 1.0). */
  hasQuery(): boolean {
    return this.queryText !== "";
  }

  hasOrgFilter(): boolean {
    return this.orgFilterValue !== "";
  }

  /**
   * Go EffectiveKinds: discover mode → all searchable kinds; otherwise
   * the requested kinds filtered to the searchable set — silently
   * dropping non-searchable ones (the forward-compatibility contract on
   * SearchRequest.kinds). The result may be EMPTY: the caller answers
   * emptiness, never a discover fallback (stigmer/stigmer#440).
   */
  effectiveKinds(): readonly ApiResourceKind[] {
    if (this.requestedKinds.length === 0) {
      return searchIndexedKinds();
    }
    const searchable = searchableKindSet();
    return this.requestedKinds.filter((kind) => searchable.has(kind));
  }

  /** Zero-indexed row offset for the page (Go Offset). */
  offset(): number {
    return (this.pageNumberValue - 1) * this.pageSizeValue;
  }
}
