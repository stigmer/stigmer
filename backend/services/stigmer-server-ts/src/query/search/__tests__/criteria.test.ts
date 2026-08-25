/**
 * Pins SearchCriteria against Go's search_criteria_test.go tables:
 * normalization (trimming, clamps), the 500-char boundary, the three-mode
 * contract, and the #440 arm — named-but-unsearchable kinds yield an EMPTY
 * effective set, never a discover fallback. The kind_meta derivation is
 * pinned here too: 13 searchable kinds, project included (DD-D).
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_QUERY_LENGTH,
  SearchCriteria,
  searchIndexedKinds,
} from "../criteria.js";

function criteria(overrides?: {
  kinds?: ApiResourceKind[];
  query?: string;
  org?: string;
  excludePublic?: boolean;
  crossOrgPublic?: boolean;
  pageNumber?: number;
  pageSize?: number;
}): SearchCriteria {
  return SearchCriteria.create(
    overrides?.kinds ?? [],
    overrides?.query ?? "",
    overrides?.org ?? "",
    overrides?.excludePublic ?? false,
    overrides?.crossOrgPublic ?? false,
    overrides?.pageNumber ?? 1,
    overrides?.pageSize ?? 20,
  );
}

describe("searchIndexedKinds derivation (kind_meta)", () => {
  it("derives exactly the 13 searchable kinds, project included", () => {
    // Go's SearchableKinds map, pinned by its invariant test against the
    // same kind_meta derivation. project rides #14 (DD-D) although its
    // domain ports with #16 — RebuildIndex on an adopted Go database
    // must be able to re-index existing project rows.
    expect([...searchIndexedKinds()].sort((a, b) => a - b)).toEqual(
      [
        ApiResourceKind.agent,
        ApiResourceKind.skill,
        ApiResourceKind.mcp_server,
        ApiResourceKind.workflow,
        ApiResourceKind.project,
        ApiResourceKind.environment,
        ApiResourceKind.session,
        ApiResourceKind.agent_execution,
        ApiResourceKind.agent_instance,
        ApiResourceKind.execution_context,
        ApiResourceKind.organization,
        ApiResourceKind.workflow_execution,
        ApiResourceKind.workflow_instance,
      ].sort((a, b) => a - b),
    );
  });

  it("excludes not_search_indexed kinds (agent_channel, memory)", () => {
    const kinds = searchIndexedKinds();
    expect(kinds).not.toContain(ApiResourceKind.agent_channel);
    expect(kinds).not.toContain(ApiResourceKind.channel_app);
    expect(kinds).not.toContain(ApiResourceKind.memory);
  });
});

describe("SearchCriteria normalization (Go NewSearchCriteria)", () => {
  it("keeps valid input verbatim", () => {
    const c = criteria({
      kinds: [ApiResourceKind.agent, ApiResourceKind.skill],
      query: "kubernetes",
      org: "acme",
      pageNumber: 2,
      pageSize: 50,
    });
    expect(c.kinds()).toEqual([ApiResourceKind.agent, ApiResourceKind.skill]);
    expect(c.query()).toBe("kubernetes");
    expect(c.orgFilter()).toBe("acme");
    expect(c.pageNumber()).toBe(2);
    expect(c.pageSize()).toBe(50);
  });

  it("trims the query and the org filter", () => {
    const c = criteria({ query: "  hello  ", org: "  acme  " });
    expect(c.query()).toBe("hello");
    expect(c.orgFilter()).toBe("acme");
  });

  it("rejects a query over the cap with Go's exact message", () => {
    expect(() =>
      criteria({ query: "x".repeat(MAX_QUERY_LENGTH + 1) }),
    ).toThrowError(
      "search query exceeds maximum length of 500 characters",
    );
  });

  it("accepts a query at exactly the cap", () => {
    const c = criteria({ query: "x".repeat(MAX_QUERY_LENGTH) });
    expect(c.query().length).toBe(MAX_QUERY_LENGTH);
  });

  it("clamps the page number: 0 and negatives normalize to 1", () => {
    expect(criteria({ pageNumber: 0 }).pageNumber()).toBe(1);
    expect(criteria({ pageNumber: -5 }).pageNumber()).toBe(1);
    expect(criteria({ pageNumber: 3 }).pageNumber()).toBe(3);
  });

  it("clamps the page size: <1 → default, >100 → max", () => {
    expect(criteria({ pageSize: 0 }).pageSize()).toBe(DEFAULT_PAGE_SIZE);
    expect(criteria({ pageSize: -1 }).pageSize()).toBe(DEFAULT_PAGE_SIZE);
    expect(criteria({ pageSize: 1000 }).pageSize()).toBe(MAX_PAGE_SIZE);
    expect(criteria({ pageSize: MAX_PAGE_SIZE }).pageSize()).toBe(
      MAX_PAGE_SIZE,
    );
  });
});

describe("mode selection", () => {
  it("empty kinds is discover mode; requested kinds is not", () => {
    expect(criteria({ kinds: [] }).isDiscoverMode()).toBe(true);
    expect(
      criteria({ kinds: [ApiResourceKind.agent] }).isDiscoverMode(),
    ).toBe(false);
  });

  it("hasQuery: empty and whitespace-only queries mean list mode", () => {
    expect(criteria({ query: "" }).hasQuery()).toBe(false);
    expect(criteria({ query: "   " }).hasQuery()).toBe(false);
    expect(criteria({ query: "x" }).hasQuery()).toBe(true);
  });

  it("hasOrgFilter follows the trimmed org", () => {
    expect(criteria({ org: "" }).hasOrgFilter()).toBe(false);
    expect(criteria({ org: "acme" }).hasOrgFilter()).toBe(true);
  });
});

describe("effectiveKinds (the #440 contract)", () => {
  it("discover mode returns every searchable kind", () => {
    expect(criteria({ kinds: [] }).effectiveKinds()).toEqual(
      searchIndexedKinds(),
    );
  });

  it("specific kinds pass through when searchable", () => {
    expect(
      criteria({
        kinds: [ApiResourceKind.agent, ApiResourceKind.workflow],
      }).effectiveKinds(),
    ).toEqual([ApiResourceKind.agent, ApiResourceKind.workflow]);
  });

  it("non-searchable kinds are silently dropped from a mixed request", () => {
    expect(
      criteria({
        kinds: [ApiResourceKind.agent, ApiResourceKind.agent_channel],
      }).effectiveKinds(),
    ).toEqual([ApiResourceKind.agent]);
  });

  it("ONLY non-searchable kinds yields the empty set — never discover (#440)", () => {
    const c = criteria({ kinds: [ApiResourceKind.agent_channel] });
    expect(c.effectiveKinds()).toEqual([]);
    expect(c.isDiscoverMode()).toBe(false);
  });

  it("kinds() returns the request verbatim, including unsearchable ones", () => {
    const c = criteria({ kinds: [ApiResourceKind.agent_channel] });
    expect(c.kinds()).toEqual([ApiResourceKind.agent_channel]);
  });
});

describe("offset", () => {
  it("computes the zero-indexed row offset (Go Offset)", () => {
    expect(criteria({ pageNumber: 1, pageSize: 20 }).offset()).toBe(0);
    expect(criteria({ pageNumber: 2, pageSize: 20 }).offset()).toBe(20);
    expect(criteria({ pageNumber: 3, pageSize: 50 }).offset()).toBe(100);
  });
});
