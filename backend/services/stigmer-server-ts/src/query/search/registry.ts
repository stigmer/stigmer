/**
 * Searchable-resource registry — ports
 * pkg/query/search/extractor/registry.go with the composition-root idiom
 * in place of Go's init() self-registration (house rule: no import side
 * effects). The ENTIRE searchable surface is this one explicit list; a
 * kind is searchable exactly when its extractor appears here AND kind_meta
 * declares it search-indexed — the registry unit test pins the two sets
 * equal (Go's #439 invariant, TS home).
 *
 * Duplicate registration throws at construction (Go panics at init).
 * validateExpectedKinds is WARN-only at boot, exactly Go's posture
 * (registry.go ValidateExpectedKinds; server.go:509): a missing extractor
 * degrades that kind to unsearchable, never refuses boot.
 *
 * The project extractor is registered here by THIS sub-project (#14)
 * although the project DOMAIN ports with #16 — boot RebuildIndex re-indexes
 * every registered kind from the resources table, and an adopted Go
 * database may already hold projects; without the extractor those rows
 * would silently vanish from search (D4 #14 DD-D, owner-ratified).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { agentSearchExtractor } from "../../domain/agent/search-extractor.js";
import { agentExecutionSearchExtractor } from "../../domain/agentexecution/search-extractor.js";
import { agentInstanceSearchExtractor } from "../../domain/agentinstance/search-extractor.js";
import { environmentSearchExtractor } from "../../domain/environment/search-extractor.js";
import { executionContextSearchExtractor } from "../../domain/executioncontext/search-extractor.js";
import { mcpServerSearchExtractor } from "../../domain/mcpserver/search-extractor.js";
import { organizationSearchExtractor } from "../../domain/organization/search-extractor.js";
import { projectSearchExtractor } from "../../domain/project/search-extractor.js";
import { sessionSearchExtractor } from "../../domain/session/search-extractor.js";
import { skillSearchExtractor } from "../../domain/skill/search-extractor.js";
import { workflowSearchExtractor } from "../../domain/workflow/search-extractor.js";
import { workflowExecutionSearchExtractor } from "../../domain/workflowexecution/search-extractor.js";
import { workflowInstanceSearchExtractor } from "../../domain/workflowinstance/search-extractor.js";
import type { Logger } from "../../boot/logger.js";
import { searchIndexedKinds } from "./criteria.js";
import type { SearchableExtractor } from "./extractor.js";

/** Go SearchableResourceRegistry — kind → extractor, read-only after build. */
export class SearchableResourceRegistry {
  private readonly extractors: ReadonlyMap<ApiResourceKind, SearchableExtractor>;

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

  /** Go GetExtractorOrNil — undefined when the kind is not registered. */
  getExtractor(kind: ApiResourceKind): SearchableExtractor | undefined {
    return this.extractors.get(kind);
  }

  /**
   * Go SupportedKinds: registered kinds sorted by their NAME strings
   * (Go sorts on kind.String()) — RebuildIndex's deterministic order.
   */
  supportedKinds(): readonly ApiResourceKind[] {
    return [...this.extractors.keys()].sort((a, b) =>
      (ApiResourceKind[a] ?? "").localeCompare(ApiResourceKind[b] ?? ""),
    );
  }

  /**
   * Go ValidateExpectedKinds (server.go:509): warn about searchable kinds
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
    agentInstanceSearchExtractor,
    environmentSearchExtractor,
    executionContextSearchExtractor,
    mcpServerSearchExtractor,
    organizationSearchExtractor,
    projectSearchExtractor,
    sessionSearchExtractor,
    skillSearchExtractor,
    workflowSearchExtractor,
    workflowExecutionSearchExtractor,
    workflowInstanceSearchExtractor,
  ]);
}
