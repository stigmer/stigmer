/**
 * Searchable-extractor contract — ports the query side of
 * pkg/query/search/extractor/extractor.go (the index side,
 * SearchIndexExtractor, shipped with #4 in pipeline/steps/index-search.ts;
 * this module extends it, mirroring Go's single interface).
 *
 * Go duplicates the ToSearchResult body 13× (protobuf structs cannot share
 * methods); the OUTPUT is formulaic — metadata identity, spec-audit
 * timestamps with zero-Timestamp defaults, per-kind summary — so it ports
 * ONCE as buildSearchResult, parameterized by what actually varies (kind,
 * summary, icon). Byte-visible output is identical; the per-kind summary
 * sources are pinned in each domain's search-extractor.ts and in the
 * conformance suite (D4 #14 DD-C, owner-ratified).
 *
 * Proven by search.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * the registry/extractor unit tests.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

/**
 * The full extractor contract (Go SearchableExtractor): the #4 index side
 * plus the query side this sub-project adds. One extractor per searchable
 * kind, registered in registry.ts.
 */
export interface SearchableExtractor extends SearchIndexExtractor {
  /** Go Kind(): the kind this extractor serves. */
  readonly kind: ApiResourceKind;
  /** Go NewEmptyProto(): the schema RebuildIndex unmarshals rows with. */
  readonly schema: DescMessage;
  /**
   * Go GetSearchSummary(): the display description for search results.
   * The source field varies by kind (see each domain's extractor header);
   * truncation is a presentation concern — return the full text.
   */
  getSearchSummary(resource: Message): string;
  /**
   * Go ToSearchResult(): the wire projection for one hit. Returns
   * undefined when the resource carries no metadata (Go returns nil) —
   * the caller skips the row.
   */
  toSearchResult(resource: Message, score: number): SearchResult | undefined;
}

/**
 * The formulaic SearchResult assembly every Go extractor repeats:
 * metadata identity + qualified slug, spec-audit timestamps defaulting to
 * the ZERO Timestamp when unstamped (Go sets &timestamppb.Timestamp{}),
 * and the caller's summary/icon/score.
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

/** Go buildQualifiedSlug: "org/slug", or the bare slug when org is empty. */
function buildQualifiedSlug(org: string, slug: string): string {
  return org === "" ? slug : `${org}/${slug}`;
}
