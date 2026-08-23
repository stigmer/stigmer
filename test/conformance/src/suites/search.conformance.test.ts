// Search conformance — the unified list/search/discover RPC: mode selection,
// org and visibility scoping, kind filtering (#440), and pagination
// clamping (Class A).
// Domain: conformance suites.
//
// SearchService.search is one RPC whose behavior forks on its parameters:
// empty query = list mode (created_at ordering, score pinned 1.0), non-empty
// query = full-text search (relevance ordering), empty kinds = discover
// across every searchable kind. The suite asserts MEMBERSHIP and
// stable-property contracts only — never BM25 scores or relative ranking,
// which are implementation-tunable (D1's explicit instruction).
//
// Error arms are pinned by CODE only (ratified guard P2): the Go
// controller maps handler errors by string-matching and sanitizes
// everything unmatched to a generic Internal (#478), so message text is
// deliberately not part of the wire contract here.
//
// Indexing is synchronous on resource writes in both editions' stores, so
// create-then-search needs no polling — a deliberate property this suite
// silently relies on (a flaky pass here would smell of an async index).
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { makeWorkflow } from "../support/workflows";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

// A single FTS-safe token (no hyphens — the porter unicode61 tokenizer
// splits on them) unique per call, embedded in resource names so text
// queries hit exactly the fixtures that carry it.
function uniqueToken(): string {
  return `conf${Math.random().toString(36).slice(2, 10)}`;
}

async function createAgentNamed(org: string, name: string) {
  const agent = await clients.agentCommand.create(makeAgent({ org, name }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

describe("Search conformance — list mode (empty query)", () => {
  it("returns the org's resources of the kind with the pinned list-mode properties", async () => {
    const { org } = await target.provisionTenancy();
    const first = await createAgentNamed(org, uniqueName("list-agent"));
    const second = await createAgentNamed(org, uniqueName("list-agent"));

    const response = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org,
    });

    const ids = response.entries.map((e) => e.id);
    expect(ids).toContain(first.metadata?.id);
    expect(ids).toContain(second.metadata?.id);
    expect(response.totalCount).toBe(2);
    expect(response.countsByKind).toEqual({ agent: 2 });
    expect(response.totalPages).toBe(1);

    for (const entry of response.entries) {
      // List mode pins score to exactly 1.0 — relevance is meaningless
      // without a query.
      expect(entry.score).toBe(1);
      expect(entry.kind).toBe(ApiResourceKind.agent);
      expect(entry.org).toBe(org);
      expect(entry.qualifiedSlug).toBe(`${org}/${entry.slug}`);
    }
  });
});

describe("Search conformance — search mode (text query)", () => {
  it("finds resources by a name token with a positive relevance score", async () => {
    const { org } = await target.provisionTenancy();
    const token = uniqueToken();
    const match = await createAgentNamed(org, `needle-${token}`);
    await createAgentNamed(org, uniqueName("chaff-agent"));

    const response = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org,
      query: token,
    });

    // Membership only: exactly the token-carrying agent, with SOME
    // positive score — never a pinned value or ranking (D1).
    expect(response.entries).toHaveLength(1);
    expect(response.entries[0]?.id).toBe(match.metadata?.id);
    expect(response.entries[0]?.score).toBeGreaterThan(0);
  });

  it("discover mode (empty kinds) spans searchable kinds — including the default instances", async () => {
    const { org } = await target.provisionTenancy();
    const token = uniqueToken();
    await createAgentNamed(org, `disc-${token}-agent`);
    const workflow = await clients.workflowCommand.create(
      makeWorkflow({ org, name: `disc-${token}-flow` }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

    const response = await clients.search.search({ query: token, org });

    // Four hits from two creates: agent and workflow creates each spawn a
    // system-managed default INSTANCE named for its parent, and instances
    // are search-indexed by kind_meta — discover truthfully surfaces all
    // of them. Compared on the NON-ZERO entries: whether zero-count kinds
    // appear in the map is an edition presentation difference (the
    // multi-tenant edition enumerates every kind at 0; local omits them),
    // while the non-zero membership is the shared contract.
    expect(response.totalCount).toBe(4);
    const nonZeroCounts = Object.fromEntries(
      Object.entries(response.countsByKind).filter(([, count]) => count > 0),
    );
    expect(nonZeroCounts).toEqual({
      agent: 1,
      agent_instance: 1,
      workflow: 1,
      workflow_instance: 1,
    });
  });

  it("naming ONLY non-searchable kinds returns empty — never a discover fallback (#440)", async () => {
    const { org } = await target.provisionTenancy();
    const token = uniqueToken();
    await createAgentNamed(org, `nofallback-${token}`);

    // agent_channel is not_search_indexed by proto kind_meta in BOTH
    // editions — a request naming only it must answer emptiness, not
    // silently widen to every searchable kind.
    const response = await clients.search.search({
      kinds: [ApiResourceKind.agent_channel],
      org,
      query: token,
    });

    expect(response.entries).toHaveLength(0);
    expect(response.totalCount).toBe(0);
  });
});

describe("Search conformance — org & visibility scoping", () => {
  it("a strict org filter never leaks another org's private resources", async () => {
    const { org: orgA } = await target.provisionTenancy();
    const { org: orgB } = await target.provisionTenancy();
    const token = uniqueToken();
    const mine = await createAgentNamed(orgA, `scoped-${token}-a`);
    await createAgentNamed(orgB, `scoped-${token}-b`);

    // Strict filter (cross_org_public unset): only orgA's resource.
    const strict = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org: orgA,
      query: token,
    });
    expect(strict.entries.map((e) => e.id)).toEqual([mine.metadata?.id]);

    // cross_org_public widens to PUBLIC resources of other orgs — orgB's
    // agent is private, so nothing changes.
    const widened = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org: orgA,
      query: token,
      crossOrgPublic: true,
    });
    expect(widened.entries.map((e) => e.id)).toEqual([mine.metadata?.id]);
  });

  it("cross_org_public admits other orgs' PUBLIC resources; exclude_public removes them", async (ctx) => {
    // Minting a public resource needs the unguarded local write door (the
    // agentshare suite's gating precedent).
    if (!target.capabilities.clientPublicVisibilityWrites) return ctx.skip();
    const { org: orgA } = await target.provisionTenancy();
    const { org: orgB } = await target.provisionTenancy();
    const token = uniqueToken();
    const mine = await createAgentNamed(orgA, `vis-${token}-mine`);
    const theirs = await createAgentNamed(orgB, `vis-${token}-public`);
    await clients.agentCommand.updateVisibility({
      resourceId: theirs.metadata!.id,
      visibility: ApiResourceVisibility.visibility_public,
    });

    // The "All" library scope: my org's resources plus the marketplace.
    const widened = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org: orgA,
      query: token,
      crossOrgPublic: true,
    });
    expect(new Set(widened.entries.map((e) => e.id))).toEqual(
      new Set([mine.metadata?.id, theirs.metadata?.id]),
    );

    // Strict org filter: the public foreign resource disappears.
    const strict = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org: orgA,
      query: token,
    });
    expect(strict.entries.map((e) => e.id)).toEqual([mine.metadata?.id]);

    // exclude_public is an independent subtraction on top of any scope.
    const excluded = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      query: token,
      excludePublic: true,
    });
    expect(excluded.entries.map((e) => e.id)).toEqual([mine.metadata?.id]);
  });
});

describe("Search conformance — pagination clamping", () => {
  it("pages by size with totals, clamping oversize and zero values instead of erroring", async () => {
    const { org } = await target.provisionTenancy();
    const token = uniqueToken();
    for (let i = 0; i < 3; i++) {
      await createAgentNamed(org, `page-${token}-${i}`);
    }

    const firstPage = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org,
      query: token,
      page: { num: 1, size: 2 },
    });
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.totalCount).toBe(3);
    expect(firstPage.totalPages).toBe(2);

    const secondPage = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org,
      query: token,
      page: { num: 2, size: 2 },
    });
    expect(secondPage.entries).toHaveLength(1);
    // The two pages partition the result set.
    const seen = new Set([...firstPage.entries, ...secondPage.entries].map((e) => e.id));
    expect(seen.size).toBe(3);

    // Clamping, not refusal: size above the 100 cap and num 0 both
    // normalize (size→100, num→1) — the request still succeeds.
    const clamped = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org,
      query: token,
      page: { num: 0, size: 1000 },
    });
    expect(clamped.entries).toHaveLength(3);
    expect(clamped.totalPages).toBe(1);
  });
});

describe("Search conformance — validation arms (codes only, P2)", () => {
  it("rejects an over-length query (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.search.search({ query: "x".repeat(501) }),
      Code.InvalidArgument,
      "query above the 500-character cap",
    );
  });

  it("rejects a malformed org slug (InvalidArgument — the proto pattern)", async () => {
    await expectGrpcCode(
      () => clients.search.search({ org: "NotASlug" }),
      Code.InvalidArgument,
      "org violating the slug pattern",
    );
  });
});
