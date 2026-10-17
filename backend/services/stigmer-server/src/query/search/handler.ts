/**
 * Search handler — ports pkg/query/search/handler/search_handler.go: the
 * plain 4-step CQRS pipeline (validate → criteria → store → response).
 * Deliberately NOT the domain pipeline library — Go's query side doesn't
 * use its pipeline either; queries have no persist/audit lifecycle.
 *
 * Pages follow the relevance order, which has no keyset, so a page token
 * carries the rank position the next page starts at and the request's
 * fingerprint, through the token codec every list uses (list-page.ts): a
 * token is refused for a request other than the one it was issued to.
 *
 * Step 1's protovalidate run is Go's defensive twin: the interceptor
 * chain has already validated the request on every wire and in-process
 * path (chain position 3; Go server.go:246 "protovalidate runs first"),
 * so this arm is unreachable from the wire — ported because Go carries
 * it, and because the handler contract ("Handle validates") must not
 * silently depend on the caller's chain.
 *
 * With a composed list read scope every effective kind's allowlist is
 * built by the kind's reach (reach.ts), and every effective kind is put in
 * the map the store reads: a kind left out of it is unrestricted. The
 * organizations an organization's kinds are read from are the one the
 * request names, or, when it names none, the organizations the directory
 * lists for the caller and the parent of each child among them, whose
 * rows a child's people reach when the parent shares them with its
 * children (the restrict verb decides which). Where the caller's
 * organizations cannot be named (no directory composed, or a directory
 * that answers every organization), the kind's enumeration answers, as it
 * did before reach. The server acting as itself (the `internal` class) and
 * a composition with no scope are unscoped, as `restrictListByReadScope`
 * answers them. The store query, paging and the exact `counts_by_kind` do
 * not depend on how the allowlists were found.
 *
 * Proven by __tests__/handler.test.ts and search.conformance.test.ts on
 * local.
 */
import { create } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import type { Validator } from "@bufbuild/protovalidate";

import {
  SearchRequestSchema,
  SearchResponseSchema,
} from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import type {
  SearchRequest,
  SearchResponse,
} from "@stigmer/apis/ai/stigmer/search/v1/io_pb";

import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  loadOrganization,
  parentOrgOf,
} from "../../domain/organization/children.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { ScopedListResource } from "../../extensions/list-read-scope.js";
import type { OrganizationDirectory } from "../../extensions/organization-directory.js";
import { ALL_ORGANIZATIONS } from "../../extensions/organization-directory.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import {
  decodeListPageToken,
  encodeListPageToken,
  listPageFingerprint,
} from "../../pipeline/steps/list-page.js";
import type { ListPageTokenCursor } from "../../pipeline/steps/list-page.js";
import type { Store } from "../../store/interface.js";
import { apiResourceKindName } from "../../store/proto-fields.js";
import { SearchCriteria } from "./criteria.js";
import type { SearchPagedResult } from "./paged-result.js";
import type { SearchQueryStore } from "./query-store.js";
import type { OrganizationReach } from "./reach.js";
import { searchReachOf } from "./reach.js";

export interface SearchHandlerDeps {
  /** The search index the page and the counts are read from. */
  readonly store: SearchQueryStore;
  /** The rows an organization's kinds are offered from, and the organizations' parents. */
  readonly rows: Pick<Store, "queryResources" | "getResource">;
  /** The organizations a search naming none covers; undefined = not composed. */
  readonly organizationDirectory: OrganizationDirectory | undefined;
  /** undefined = no scope composed: every kind unrestricted. */
  readonly listReadScope: ListReadScope | undefined;
  readonly logger: Logger;
}

/** The organizations an organization's kinds are read from, or every organization. */
type SearchedOrganizations = ReadonlyArray<string> | typeof ALL_ORGANIZATIONS;

export class SearchHandler {
  private readonly validator: Validator;

  constructor(private readonly deps: SearchHandlerDeps) {
    this.validator = createValidator();
  }

  /**
   * Go Handle: validate → build criteria → execute → build response.
   * Errors carry Go's exact wrap prefixes — the controller's error
   * mapping string-matches them (#478 sanitization contract).
   *
   * With a composed ListReadScope the
   * store read ALWAYS carries a per-effective-kind authorized-id map for
   * every caller but the server itself (`authorizedIdsByKind`). There is
   * no request shape that skips the scope: the one that did (the retired
   * public level's cross-organization discovery, which the engine
   * filtered by visibility with FGA never consulted) left with the level.
   * A scope, directory or row-read failure answers the sanitized
   * Internal, never a silently unscoped result.
   */
  async handle(
    request: SearchRequest,
    identity: CallerIdentity,
  ): Promise<SearchResponse> {
    const validation = this.validator.validate(SearchRequestSchema, request);
    if (validation.kind !== "valid") {
      throw new Error(`validation failed: ${validation.error.message}`);
    }

    const fingerprint = listPageFingerprint({
      kinds: request.kinds,
      query: request.query,
      org: request.org,
    });
    // A token's refusal is the codec's own InvalidArgument, raised before
    // the criteria so it is never wrapped (controller.ts passes it on).
    const offset =
      request.pageToken === ""
        ? 0
        : positionOf(decodeListPageToken(request.pageToken, fingerprint));

    let criteria: SearchCriteria;
    try {
      criteria = SearchCriteria.create(
        request.kinds,
        request.query,
        request.org,
        offset,
        request.pageSize,
      );
    } catch (error) {
      throw new Error(
        `build criteria failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    let authorizedIdsByKind: Map<string, ReadonlySet<string>> | undefined;
    try {
      authorizedIdsByKind = await this.authorizedIdsByKind(criteria, identity);
    } catch (error) {
      // The cause is logged here: the controller logs only the message,
      // and the wire answer stays the sanitized Internal whatever the
      // cause's text says.
      this.deps.logger.error("Search candidates failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw internalError(error, "search candidates failed");
    }

    let result: SearchPagedResult;
    try {
      result = await this.deps.store.search(criteria, authorizedIdsByKind);
    } catch (error) {
      throw new Error(
        `search failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    const next = criteria.offset() + criteria.pageSize();
    const response = create(SearchResponseSchema, {
      entries: [...result.results],
      countsByKind: { ...result.countsByKind },
      nextPageToken:
        next < result.totalCount
          ? encodeListPageToken(NO_CURSOR, fingerprint, next)
          : "",
    });

    this.deps.logger.debug("Search completed", {
      results: response.entries.length,
      total: result.totalCount,
      has_query: criteria.hasQuery(),
    });

    return response;
  }

  /**
   * The allowlist of every effective kind, by its reach (reach.ts), or
   * undefined (unscoped) with no scope composed or for the server acting
   * as itself, which `restrictListByReadScope` answers with every row. The
   * searched organizations are read once per request, and only when an
   * effective kind needs them.
   */
  private async authorizedIdsByKind(
    criteria: SearchCriteria,
    identity: CallerIdentity,
  ): Promise<Map<string, ReadonlySet<string>> | undefined> {
    const scope = this.deps.listReadScope;
    if (scope === undefined || identity.callerClass === "internal") {
      return undefined;
    }
    let mine: Promise<SearchedOrganizations> | undefined;
    const myOrganizations = (): Promise<SearchedOrganizations> => {
      mine ??= this.myOrganizations(identity);
      return mine;
    };
    const byKind = new Map<string, ReadonlySet<string>>();
    for (const kind of criteria.effectiveKinds()) {
      const reach = searchReachOf(kind);
      let ids: ReadonlySet<string>;
      if (reach.reach === "person") {
        ids = await scope.authorizedResourceIds(identity, kind);
      } else if (reach.reach === "directory") {
        const organizations = await myOrganizations();
        ids =
          organizations === ALL_ORGANIZATIONS
            ? await scope.authorizedResourceIds(identity, kind)
            : new Set(organizations);
      } else {
        const organizations = criteria.hasOrgFilter()
          ? [criteria.orgFilter()]
          : await this.withParents(await myOrganizations());
        ids =
          organizations === ALL_ORGANIZATIONS
            ? await scope.authorizedResourceIds(identity, kind)
            : await this.readableRowIds(
                scope,
                identity,
                kind,
                reach,
                organizations,
              );
      }
      byKind.set(apiResourceKindName(kind), ids);
    }
    return byKind;
  }

  /** The organizations the directory lists for the caller; every one with none composed. */
  private async myOrganizations(
    identity: CallerIdentity,
  ): Promise<SearchedOrganizations> {
    const directory = this.deps.organizationDirectory;
    return directory === undefined
      ? ALL_ORGANIZATIONS
      : directory.listMyOrganizationIds(identity);
  }

  /**
   * `organizations` and the parent of each child among them: what a parent
   * shares with its children is a candidate for each child's people. One
   * primary-key read per organization; one that is gone adds nothing.
   */
  private async withParents(
    organizations: SearchedOrganizations,
  ): Promise<SearchedOrganizations> {
    if (organizations === ALL_ORGANIZATIONS) {
      return ALL_ORGANIZATIONS;
    }
    const searched = new Set(organizations);
    for (const id of organizations) {
      const organization = await loadOrganization(this.deps.rows, id);
      const parent =
        organization === undefined ? "" : parentOrgOf(organization);
      if (parent !== "") {
        searched.add(parent);
      }
    }
    return [...searched];
  }

  /**
   * The ids of `organizations`' rows of `kind` the caller may read: each
   * organization's rows through the kind's list index, offered to the
   * restrict verb in one call. A row that will not decode is skipped and
   * logged, as the list lanes skip one.
   */
  private async readableRowIds(
    scope: ListReadScope,
    identity: CallerIdentity,
    kind: ApiResourceKind,
    reach: OrganizationReach,
    organizations: ReadonlyArray<string>,
  ): Promise<ReadonlySet<string>> {
    const candidates: ScopedListResource[] = [];
    for (const org of organizations) {
      for (const row of await this.deps.rows.queryResources(reach.index, {
        org,
      })) {
        try {
          candidates.push(reach.decode(row.data));
        } catch (error) {
          this.deps.logger.warn("Failed to unmarshal search candidate, skipping", {
            kind: apiResourceKindName(kind),
            id: row.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    const readable = await restrictListByReadScope(
      scope,
      identity,
      kind,
      candidates,
      "",
    );
    return new Set(readable.map((resource) => resource.metadata?.id ?? ""));
  }
}

/**
 * A search token's cursor: the relevance order has no row cursor, so the
 * token's cursor fields are empty and its position is the rank.
 */
const NO_CURSOR = { createdAt: "", id: "" } as const;

/** The rank a search token carries; a token with no position is not one of search's. */
function positionOf(token: ListPageTokenCursor): number {
  if (token.position === undefined) {
    throw invalidArgumentError("invalid page_token");
  }
  return token.position;
}
