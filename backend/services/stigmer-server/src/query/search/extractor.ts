/**
 * Searchable-extractor contract, the query side (the index side,
 * SearchIndexExtractor, is in pipeline/steps/index-search.ts; this module
 * extends it into one interface).
 *
 * The SearchResult OUTPUT is formulaic — metadata identity, spec-audit
 * timestamps with zero-Timestamp defaults, per-kind summary — so it is
 * built ONCE as buildSearchResult, parameterized by what actually varies
 * (kind, summary, icon). The per-kind summary sources are pinned in each
 * domain's search-extractor.ts and in the conformance suite.
 *
 * Proven by search.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * the registry/extractor unit tests.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceMetadata } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { SearchResultSchema } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";

import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

/**
 * The full extractor contract: the index side
 * plus the query side. One extractor per searchable
 * kind, registered in registry.ts.
 */
export interface SearchableExtractor extends SearchIndexExtractor {
  /** The kind this extractor serves. */
  readonly kind: ApiResourceKind;
  /** The schema RebuildIndex unmarshals rows with. */
  readonly schema: DescMessage;
  /**
   * The display description for search results.
   * The source field varies by kind (see each domain's extractor header);
   * truncation is a presentation concern — return the full text.
   */
  getSearchSummary(resource: Message): string;
  /**
   * The wire projection for one hit. Returns undefined when the resource
   * carries no metadata — the caller skips the row.
   */
  toSearchResult(resource: Message, score: number): SearchResult | undefined;
}

/**
 * The formulaic SearchResult assembly every extractor shares:
 * metadata identity + qualified slug, spec-audit timestamps defaulting to
 * the ZERO Timestamp when unstamped (never absent on the wire), and the
 * caller's summary/icon/score.
 */
export function buildSearchResult(params: {
  readonly kind: ApiResourceKind;
  readonly metadata: ApiResourceMetadata | undefined;
  readonly summary: string;
  readonly score: number;
  readonly createdAt: Timestamp | undefined;
  readonly updatedAt: Timestamp | undefined;
  readonly iconUrl?: string;
}): SearchResult | undefined {
  const metadata = params.metadata;
  if (metadata === undefined) {
    return undefined;
  }
  return create(SearchResultSchema, {
    kind: params.kind,
    id: metadata.id,
    name: metadata.name,
    slug: metadata.slug,
    org: metadata.org,
    qualifiedSlug: buildQualifiedSlug(metadata.org, metadata.slug),
    description: params.summary,
    visibility: metadata.visibility,
    tags: metadata.tags,
    score: params.score,
    iconUrl: params.iconUrl ?? "",
    createdAt: params.createdAt ?? create(TimestampSchema),
    updatedAt: params.updatedAt ?? create(TimestampSchema),
  });
}

/** "org/slug", or the bare slug when org is empty. */
function buildQualifiedSlug(org: string, slug: string): string {
  return org === "" ? slug : `${org}/${slug}`;
}
