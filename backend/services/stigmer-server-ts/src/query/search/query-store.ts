/**
 * Search query store — ports
 * pkg/query/search/store/sqlite_search_query_store.go: the CQRS read path
 * over the FTS5 index. The SQL itself lives in the storage driver
 * (Store.querySearchIndex / clearSearchIndex — OD-3: no DB() escape
 * hatch); this module owns what Go's store layer owned around the SQL —
 * MATCH-expression escaping, BM25 score normalization, per-hit
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
 * the scope-filter matrix) and search.conformance.test.ts on local-ts.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
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
   * Wipes and repopulates the FTS5 index from the resources table.
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
        matchExpression: criteria.hasQuery()
          ? escapeFTS5Query(criteria.query())
          : undefined,
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
        normalizeScore(hit.rank),
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

/**
 * Go escapeFTS5Query: every whitespace-delimited token individually
 * double-quoted (operator syntax — NOT/NEAR, column filters — becomes
 * literal text); embedded double quotes stripped; a single token gets a
 * trailing `*` for prefix matching (valid on quoted terms); multi-token
 * queries use FTS5's implicit AND. The porter unicode61 tokenizer still
 * stems inside quotes.
 */
export function escapeFTS5Query(query: string): string {
  const trimmed = query.trim();
  if (trimmed === "") {
    return trimmed;
  }

  const quoted: string[] = [];
  for (const word of trimmed.split(/\s+/)) {
    const clean = word.replaceAll('"', "");
    if (clean === "") {
      continue;
    }
    quoted.push(`"${clean}"`);
  }

  if (quoted.length === 0) {
    return "";
  }
  if (quoted.length === 1) {
    return `${quoted[0]}*`;
  }
  return quoted.join(" ");
}

/**
 * Go normalizeScore: FTS5 bm25() is negative (lower = better); map to the
 * wire's 0–1 (higher = better). Non-negative input (list mode's pinned
 * 1.0) → exactly 1.0; else 1 + bm25/10, clamped to [0, 1] — the linear
 * mapping for bm25's typical −5..0 range.
 */
export function normalizeScore(bm25Score: number): number {
  if (bm25Score >= 0) {
    return 1.0;
  }
  const score = 1.0 + bm25Score / 10.0;
  if (score < 0) {
    return 0;
  }
  if (score > 1) {
    return 1;
  }
  return score;
}

/** Go parseKind: the enum-name string back to the enum value. */
export function parseKind(kindName: string): ApiResourceKind | undefined {
  const value = (ApiResourceKind as unknown as Record<string, unknown>)[
    kindName
  ];
  return typeof value === "number" ? (value as ApiResourceKind) : undefined;
}
