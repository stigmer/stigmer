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
// which are implementation-tunable.
//
// Error arms are pinned by CODE only: the retired Go controller mapped
// handler errors by string-matching and sanitized everything unmatched to a
// generic Internal (#478), so message text is deliberately not part of the
// wire contract here.
//
// Indexing is synchronous on resource writes in both editions' stores, so
// create-then-search needs no polling — a deliberate property this suite
// silently relies on (a flaky pass here would smell of an async index).
//
// The reach arms run on the target's enforcing lane (the primary on the
// cloud, open source's OIDC sibling on the local targets): a search naming
// no organization covers the organizations the caller belongs to, a child
// organization's people still find what its parent shares with its
// children, and a parent's admin searching inside a child finds the
// child's agents, as one of its admins. A target with no enforcing lane
// skips them visibly.
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { organizationRole } from "../support/grants";
import { uniqueName, uniqueOrg } from "../support/naming";
import { pushPlugin, thermosLike } from "../support/plugins";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let lane: EnforcingLane | undefined;
let laneReason = "";
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  const enforcing = await enforcingLaneOf(target);
  if (enforcing.lane === undefined) {
    laneReason = enforcing.reason;
  } else {
    lane = enforcing.lane;
  }
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
  it("[rpc:SearchService.search] returns the org's resources of the kind with the pinned list-mode properties", async () => {
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
    expect(response.entries).toHaveLength(2);
    expect(response.countsByKind).toEqual({ agent: 2 });
    expect(response.nextPageToken).toBe("");

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
  it("[rpc:SearchService.search] finds resources by a name token with a positive relevance score", async () => {
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
    // positive score — never a pinned value or ranking.
    expect(response.entries).toHaveLength(1);
    expect(response.entries[0]?.id).toBe(match.metadata?.id);
    expect(response.entries[0]?.score).toBeGreaterThan(0);
  });

  it("[rpc:SearchService.search] discover mode (empty kinds) spans searchable kinds, and an agent and a plugin each index themselves alone", async () => {
    const { org } = await target.provisionTenancy();
    const token = uniqueToken();
    await createAgentNamed(org, `disc-${token}-agent`);
    // The plugin carries a skill, an agent and an MCP server named after the
    // token too: they are parts of the one plugin row, never rows of their own.
    await pushPlugin(clients, fixtures, org, thermosLike(`disc-${token}-plg`, { skill: `disc-${token}-skill` }));

    const response = await clients.search.search({ query: token, org });

    // Two hits from two writes: neither an agent nor a plugin install writes
    // a row beside itself. Compared on the NON-ZERO
    // entries: whether zero-count kinds appear in the map is an edition
    // presentation difference (the multi-tenant edition enumerates every
    // kind at 0; local omits them), while the non-zero membership is the
    // shared contract.
    expect(response.entries).toHaveLength(2);
    const nonZeroCounts = Object.fromEntries(
      Object.entries(response.countsByKind).filter(([, count]) => count > 0),
    );
    expect(nonZeroCounts).toEqual({
      agent: 1,
      plugin: 1,
    });
  });

  it("[rpc:SearchService.search] naming ONLY non-searchable kinds returns empty — never a discover fallback (#440)", async () => {
    const { org } = await target.provisionTenancy();
    const token = uniqueToken();
    await createAgentNamed(org, `nofallback-${token}`);

    // channel is not_search_indexed by proto kind_meta in BOTH
    // editions — a request naming only it must answer emptiness, not
    // silently widen to every searchable kind.
    const response = await clients.search.search({
      kinds: [ApiResourceKind.channel],
      org,
      query: token,
    });

    expect(response.entries).toHaveLength(0);
    expect(response.nextPageToken).toBe("");
  });
});

describe("Search conformance — org scoping", () => {
  it("[rpc:SearchService.search] a strict org filter never admits another org's resources, whatever their level", async () => {
    const { org: orgA } = await target.provisionTenancy();
    const { org: orgB } = await target.provisionTenancy();
    const token = uniqueToken();
    const mine = await createAgentNamed(orgA, `scoped-${token}-a`);
    await createAgentNamed(orgB, `scoped-${token}-b`);

    const strict = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org: orgA,
      query: token,
    });
    expect(strict.entries.map((e) => e.id)).toEqual([mine.metadata?.id]);

    // There is no request shape that widens an org filter: another
    // organization's rows are reached through the plugins that install
    // them, never through Search.
    const theirs = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org: orgB,
      query: token,
    });
    expect(theirs.entries.map((e) => e.id)).not.toContain(mine.metadata?.id);
  });
});

// An organization the lane's founder owns, cleaned up after the arm.
async function laneTenancy(on: EnforcingLane): Promise<TenancyContext> {
  const context = await on.provisionTenancy();
  fixtures.defer(() => on.cleanupTenancy(context));
  return context;
}

// A child of `parent`, created by the lane's founder; deleted before its
// parent by the fixtures' reverse order.
async function laneChildOf(on: EnforcingLane, parent: TenancyContext): Promise<string> {
  const created = await on.clients.organizationCommand.create({
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: uniqueOrg() },
    spec: { parentOrg: parent.org, externalId: uniqueName("cust") },
  });
  const org = created.metadata?.id ?? "";
  fixtures.defer(() => on.clients.organizationCommand.delete({ value: org }));
  return org;
}

// A fresh person holding exactly `role` in `org` and nothing else.
async function lanePersonWith(
  on: EnforcingLane,
  org: string,
  role: string,
): Promise<ConformanceClients> {
  const person = await on.provisionIdentity();
  const id = await on.accountIdOf(person);
  await on.clients.grantCommand.create(organizationRole(id, role, org));
  return person;
}

// An agent the lane's founder creates in `org` at `visibility`.
async function laneAgent(
  on: EnforcingLane,
  org: string,
  name: string,
  visibility = ApiResourceVisibility.visibility_org,
): Promise<string> {
  const input = makeAgent({ org, name });
  const agent = await on.clients.agentCommand.create({
    ...input,
    metadata: { ...input.metadata, visibility },
  });
  const id = agent.metadata?.id ?? "";
  fixtures.defer(() => on.clients.agentCommand.delete({ value: id }));
  return id;
}

describe("Search conformance — reach", () => {
  it("[rpc:SearchService.search] a search naming no organization finds the caller's organizations' agents and no one else's", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const mine = await laneTenancy(on);
    const theirs = await laneTenancy(on);
    const member = await lanePersonWith(on, mine.org, "member");
    const token = uniqueToken();
    const inMine = await laneAgent(on, mine.org, `reach-${token}-mine`);
    await laneAgent(on, theirs.org, `reach-${token}-theirs`);

    const found = await member.search.search({
      kinds: [ApiResourceKind.agent],
      query: token,
    });
    expect(found.entries.map((entry) => entry.id)).toEqual([inMine]);
    expect(found.countsByKind).toEqual({ agent: 1 });
  });

  it("[rpc:SearchService.search] a child's member searching no organization finds what the parent shares with children, not the rest of the parent", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await laneTenancy(on);
    const child = await laneChildOf(on, parent);
    const member = await lanePersonWith(on, child, "member");
    const token = uniqueToken();
    const shared = await laneAgent(
      on,
      parent.org,
      `reach-${token}-shared`,
      ApiResourceVisibility.visibility_child_orgs,
    );
    await laneAgent(on, parent.org, `reach-${token}-parents-own`);
    // The child's own agent, made by its member (members create agents by
    // default).
    const childAgent = await member.agentCommand.create(
      makeAgent({ org: child, name: `reach-${token}-child` }),
    );
    const inChild = childAgent.metadata?.id ?? "";
    fixtures.defer(() => member.agentCommand.delete({ value: inChild }));

    const found = await member.search.search({
      kinds: [ApiResourceKind.agent],
      query: token,
    });
    expect(found.entries.map((entry) => entry.id).sort()).toEqual(
      [shared, inChild].sort(),
    );

    const inParent = await member.search.search({
      kinds: [ApiResourceKind.agent],
      org: parent.org,
      query: token,
    });
    expect(
      inParent.entries.map((entry) => entry.id),
      "naming the parent finds only what it shares with its children",
    ).toEqual([shared]);
  });

  it("[rpc:SearchService.search] a parent's admin searching inside a child finds the child's agents, and inside the parent none of a child's", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await laneTenancy(on);
    const child = await laneChildOf(on, parent);
    const token = uniqueToken();
    const inChild = await laneAgent(on, child, `reach-${token}-child`);
    const inParent = await laneAgent(on, parent.org, `reach-${token}-parent`);

    const searchIn = async (org: string): Promise<ReadonlyArray<string>> =>
      (
        await on.clients.search.search({
          kinds: [ApiResourceKind.agent],
          org,
          query: token,
        })
      ).entries.map((entry) => entry.id);
    expect(await searchIn(child)).toEqual([inChild]);
    expect(await searchIn(parent.org)).toEqual([inParent]);
  });
});

describe("Search conformance — pagination", () => {
  it("[rpc:SearchService.search] pages by token in relevance order, clamping an oversize page instead of erroring", async () => {
    const { org } = await target.provisionTenancy();
    const token = uniqueToken();
    for (let i = 0; i < 3; i++) {
      await createAgentNamed(org, `page-${token}-${i}`);
    }

    const firstPage = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org,
      query: token,
      pageSize: 2,
    });
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.countsByKind).toEqual({ agent: 3 });
    expect(firstPage.nextPageToken, "a partial page carries a token").not.toBe("");

    const secondPage = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org,
      query: token,
      pageSize: 2,
      pageToken: firstPage.nextPageToken,
    });
    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.nextPageToken, "the last page carries none").toBe("");
    // The two pages partition the result set.
    const seen = new Set([...firstPage.entries, ...secondPage.entries].map((e) => e.id));
    expect(seen.size).toBe(3);

    // A token is bound to its query: the same token on another query is
    // refused, never read as a position in a different result set.
    await expectGrpcCode(
      () =>
        clients.search.search({
          kinds: [ApiResourceKind.agent],
          org,
          query: `${token}-other`,
          pageSize: 2,
          pageToken: firstPage.nextPageToken,
        }),
      Code.InvalidArgument,
      "a token reused on another query",
    );

    // Clamping, not refusal: a size above the 100 maximum reads as 100 and
    // the request still succeeds.
    const clamped = await clients.search.search({
      kinds: [ApiResourceKind.agent],
      org,
      query: token,
      pageSize: 1000,
    });
    expect(clamped.entries).toHaveLength(3);
    expect(clamped.nextPageToken).toBe("");
  });
});

describe("Search conformance — validation arms (codes only)", () => {
  it("[rpc:SearchService.search] rejects an over-length query (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.search.search({ query: "x".repeat(501) }),
      Code.InvalidArgument,
      "query above the 500-character cap",
    );
  });

  it("[rpc:SearchService.search] rejects a malformed org slug (InvalidArgument — the proto pattern)", async () => {
    await expectGrpcCode(
      () => clients.search.search({ org: "NotASlug" }),
      Code.InvalidArgument,
      "org violating the slug pattern",
    );
  });
});
