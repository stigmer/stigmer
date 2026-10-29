/**
 * Searchable-resource registry, built at the composition root (house
 * rule: no import side effects). The ENTIRE searchable surface is this one explicit list; a
 * kind is searchable exactly when its extractor appears here AND kind_meta
 * declares it search-indexed — the registry unit test pins the two sets
 * equal (stigmer/stigmer#439).
 *
 * Duplicate registration throws at construction.
 * validateExpectedKinds is WARN-only at boot: a missing extractor
 * degrades that kind to unsearchable, never refuses boot.
 *
 * Boot RebuildIndex re-indexes every registered kind from the resources
 * table, so a kind with no extractor here is a kind whose rows vanish from
 * search on the next boot; a domain and its extractor land together.
 */
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { agentSearchExtractor } from "../../domain/agent/search-extractor.js";
import { agentExecutionSearchExtractor } from "../../domain/run/search-extractor.js";
import { organizationSearchExtractor } from "../../domain/organization/search-extractor.js";
import { pluginSearchExtractor } from "../../domain/plugin/search-extractor.js";
import { sessionSearchExtractor } from "../../domain/session/search-extractor.js";
import { skillSearchExtractor } from "../../domain/skill/search-extractor.js";
import type { Logger } from "../../boot/logger.js";
import { searchIndexedKinds } from "./criteria.js";
import type { SearchableExtractor } from "./extractor.js";

/** Kind → extractor, read-only after build. */
export class SearchableResourceRegistry {
  private readonly extractors: ReadonlyMap<
    ApiResourceKind,
    SearchableExtractor
  >;

  constructor(extractors: readonly SearchableExtractor[]) {
    const map = new Map<ApiResourceKind, SearchableExtractor>();
    for (const extractor of extractors) {
      if (map.has(extractor.kind)) {
        throw new Error(
          `duplicate SearchableExtractor for kind ${ApiResourceKind[extractor.kind]}`,
        );
      }
      map.set(extractor.kind, extractor);
    }
    this.extractors = map;
  }

  /** Undefined when the kind is not registered. */
  getExtractor(kind: ApiResourceKind): SearchableExtractor | undefined {
    return this.extractors.get(kind);
  }

  /**
   * Registered kinds sorted by their NAME strings — RebuildIndex's
   * deterministic order. Code-unit `<`, not localeCompare: locale
   * collation could reorder names around `_` (not wire-visible, but log/error order is
   * part of the operator-facing contract).
   */
  supportedKinds(): readonly ApiResourceKind[] {
    return [...this.extractors.keys()].sort((a, b) => {
      const nameA = ApiResourceKind[a] ?? "";
      const nameB = ApiResourceKind[b] ?? "";
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });
  }

  /**
   * Warns about searchable kinds
   * with no extractor — those kinds are silently unsearchable — or log
   * the healthy roster. Never throws: boot proceeds either way.
   */
  validateExpectedKinds(logger: Logger): void {
    const missing = searchIndexedKinds()
      .filter((kind) => !this.extractors.has(kind))
      .map((kind) => ApiResourceKind[kind] ?? String(kind));
    if (missing.length > 0) {
      logger.warn(
        "SearchableResourceRegistry is missing extractors. These kinds will not be searchable.",
        { missing_kinds: missing },
      );
      return;
    }
    logger.info("SearchableResourceRegistry initialized successfully", {
      count: this.extractors.size,
      kinds: this.supportedKinds().map((kind) => ApiResourceKind[kind]),
    });
  }
}

/**
 * The production registry — every searchable kind's extractor, in one
 * place. Growing the searchable surface = one entry here + the domain's
 * extractor file (the registry test fails until both exist).
 */
export function newSearchableResourceRegistry(): SearchableResourceRegistry {
  return new SearchableResourceRegistry([
    agentSearchExtractor,
    agentExecutionSearchExtractor,
    organizationSearchExtractor,
    pluginSearchExtractor,
    sessionSearchExtractor,
    skillSearchExtractor,
  ]);
}
