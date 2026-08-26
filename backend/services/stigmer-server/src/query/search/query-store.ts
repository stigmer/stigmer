/**
 * Search query store — ports
 * pkg/query/search/store/sqlite_search_query_store.go: the CQRS read path
 * over the search index. The SQL, engine query syntax, and score
 * normalization all live in the storage driver (Store.querySearchIndex /
 * clearSearchIndex — OD-3: no DB() escape hatch; DD-009: engine
 * specifics inside each driver); this module owns query SHAPING — the
 * engine-neutral tokenization of the user's query — plus per-hit
 * load-and-convert through the extractor registry, and RebuildIndex.
 *
 * Per-hit loading is Go's shape ported faithfully: each page row loads
 * its resource individually and converts through the kind's extractor;
 * a row that fails to parse, load, or convert logs a warning and is
 * SKIPPED — the request never fails over one bad row. (The N+1 read is
 * disclosed in the PR — parity over optimization, laptop-scale by
 * design.)
 *
 * Proven by __tests__/query-store.test.ts (Go's store test tables +
 * the scope-filter matrix) and search.conformance.test.ts on local.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import { goFields } from "../../gocompat/trim.js";
import { apiResourceKindName } from "../../store/sqlite/proto-fields.js";
import type { Store } from "../../store/interface.js";
import type { SearchCriteria } from "./criteria.js";
import { emptyResult, newSearchPagedResult } from "./paged-result.js";
import type { SearchPagedResult } from "./paged-result.js";
import type { SearchableResourceRegistry } from "./registry.js";

/** Go SearchQueryStore, the handler's read seam. */
export interface SearchQueryStore {
  search(criteria: SearchCriteria): Promise<SearchPagedResult>;
  /**
   * Wipes and repopulates the search index from the resources table.
   * Returns the indexed-row count; throws AFTER indexing what it could
   * when one or more kinds failed (the caller warns and boots on —
   * Go server.go:617's posture).
   */
  rebuildIndex(): Promise<number>;
}

export class SqliteSearchQueryStore implements SearchQueryStore {
  constructor(
    private readonly store: Store,
    private readonly registry: SearchableResourceRegistry,
    private readonly logger: Logger,
  ) {}

  async search(criteria: SearchCriteria): Promise<SearchPagedResult> {
    const effectiveKinds = criteria.effectiveKinds();
    // A request naming only non-searchable kinds answers emptiness —
    // never a discover fallback (stigmer/stigmer#440).
    if (effectiveKinds.length === 0) {
      return emptyResult();
    }

    const { countsByKind, totalCount, hits } =
      await this.store.querySearchIndex({
        kinds: effectiveKinds.map((kind) => apiResourceKindName(kind)),
        // Engine-neutral tokenization: whitespace terms via the gocompat
        // twin of Go's strings.Fields (JS \s+ disagrees with Go on
        // U+FEFF/U+0085 — the #8 BOM divergence class; criteria.query()
        // is already goTrimSpace'd). Engine syntax is the driver's job.
        terms: criteria.hasQuery() ? goFields(criteria.query()) : undefined,
        orgFilter: criteria.orgFilter(),
        crossOrgPublic: criteria.crossOrgPublic(),
        excludePublic: criteria.excludePublic(),
        limit: criteria.pageSize(),
        offset: criteria.offset(),
      });

    if (totalCount === 0) {
      return emptyResult();
    }

    const results: SearchResult[] = [];
    for (const hit of hits) {
      const kind = parseKind(hit.kind);
      if (kind === undefined) {
        this.logger.warn("Unknown resource kind in search index", {
          kind: hit.kind,
        });
        continue;
      }
      const result = await this.loadAndConvertResource(
        kind,
        hit.resourceId,
        hit.score,
      );
      if (result !== undefined) {
        results.push(result);
      }
    }

    return newSearchPagedResult(
      results,
      countsByKind,
      totalCount,
      criteria.pageSize(),
    );
  }

  /** Go loadAndConvertResource: load the hit, convert via its extractor. */
  private async loadAndConvertResource(
    kind: ApiResourceKind,
    resourceId: string,
    score: number,
  ): Promise<SearchResult | undefined> {
    const extractor = this.registry.getExtractor(kind);
    if (extractor === undefined) {
      this.logger.warn("Failed to load resource", {
        kind: ApiResourceKind[kind],
        id: resourceId,
        error: "no SearchableExtractor registered",
      });
      return undefined;
    }
    try {
      const resource = await this.store.getResource(
        kind,
        resourceId,
        extractor.schema,
      );
      return extractor.toSearchResult(resource, score);
    } catch (error) {
      // A stale index row (resource deleted between the page query and
      // this load) or a corrupt row: warn and skip, exactly Go.
      this.logger.warn("Failed to load resource", {
        kind: ApiResourceKind[kind],
        id: resourceId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  async rebuildIndex(): Promise<number> {
    this.logger.info("Rebuilding search index...");
    await this.store.clearSearchIndex();

    let totalIndexed = 0;
    const indexErrors: string[] = [];

    for (const kind of this.registry.supportedKinds()) {
      try {
        const count = await this.indexKind(kind);
        totalIndexed += count;
        this.logger.info("Indexed resources", {
          kind: ApiResourceKind[kind],
          count,
        });
      } catch (error) {
        this.logger.warn(
          "Failed to index kind (continuing with remaining kinds)",
          {
            kind: ApiResourceKind[kind],
            error: error instanceof Error ? error.message : String(error),
          },
        );
        indexErrors.push(
          `${ApiResourceKind[kind]}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (indexErrors.length > 0) {
      this.logger.warn("Search index rebuild completed with errors", {
        total: totalIndexed,
        failed_kinds: indexErrors.length,
      });
      throw new Error(
        `failed to index ${indexErrors.length} kind(s): ${indexErrors.join("; ")}`,
      );
    }

    this.logger.info("Search index rebuild complete", { total: totalIndexed });
    return totalIndexed;
  }

  /** Go indexKind: every row of the kind through its extractor. */
  private async indexKind(kind: ApiResourceKind): Promise<number> {
    const extractor = this.registry.getExtractor(kind);
    if (extractor === undefined) {
      // supportedKinds() only yields registered kinds; this arm guards
      // the same impossible state Go's GetExtractor error return does.
      throw new Error("no SearchableExtractor registered");
    }

    const rows = await this.store.listResources(kind);
    let count = 0;
    for (const data of rows) {
      let resource;
      try {
        resource = fromBinary(extractor.schema, data);
      } catch (error) {
        this.logger.warn("Failed to unmarshal resource", {
          kind: ApiResourceKind[kind],
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const entry = extractor.getSearchIndexEntry(resource);
      if (entry === undefined) {
        continue;
      }
      // The resource ID rides the SearchResult projection (it has the
      // metadata access) — Go's exact two-step.
      const result = extractor.toSearchResult(resource, 1.0);
      if (result === undefined) {
        continue;
      }

      try {
        await this.store.upsertSearchIndex(kind, result.id, entry);
      } catch (error) {
        this.logger.warn("Failed to index resource", {
          kind: ApiResourceKind[kind],
          id: result.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      count += 1;
    }
    return count;
  }
}

/** Go parseKind: the enum-name string back to the enum value. */
export function parseKind(kindName: string): ApiResourceKind | undefined {
  const value = (ApiResourceKind as unknown as Record<string, unknown>)[
    kindName
  ];
  return typeof value === "number" ? (value as ApiResourceKind) : undefined;
}
