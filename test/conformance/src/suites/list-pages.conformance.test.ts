// List conformance — every list pages one way (Class A).
// Domain: every kind a person populates; the shape every paged list keeps.
//
// A list request takes page_size and page_token and its response returns
// entries and next_page_token. Each arm below seeds three rows and walks the
// list with page_size 1, following tokens to the end:
//
//   - a list scoped to one parent (an agent's channels, shares and
//     schedules, an agent's sessions, a version history) holds only the
//     seeded rows, so the walk is exactly three pages of one entry, newest
//     first, a token on the first two and none after the third;
//   - a list of an organization or of the caller (agents, skills, plugins,
//     channels, shares, schedules, vaults, memories, sessions, API keys,
//     OAuth apps, channel apps, platform clients, the caller's
//     organizations, search) may also hold rows the edition provisions with
//     an organization, and a page may be short, even empty, under a read
//     scope, so the walk proves the seeded rows come back once each, newest
//     first, no page holds more than one entry, and the last page carries
//     no token;
//   - the caller's own organizations and API keys are every one that
//     identity ever made, hundreds on a long-lived target, so those two
//     walks stop once the seeded rows, the newest, have come back.
//
// Every list of resources filters by label, an exact AND match. Each
// label arm seeds three rows carrying a label only that walk uses, with
// unlabelled rows before and among them, and walks the filtered list at
// page_size 1: only the labelled rows come back, newest first, and no page
// holds more than one. A page may be short, even empty, and still carry a
// token, since the filter is each row's keep under the examine budget.
// Plugins take no labels at push, and the lists whose rows only a runner
// or the edition writes take their filtered walks in the server's own
// tests: runs and a session's runs (domain/run run.test.ts), a run's and a
// session's scores (score.test.ts), an agent's flagged grades
// (quality.test.ts), an agent's and a plugin's evals (each steps.test.ts),
// service accounts (service-accounts.test.ts), child organizations
// (children.test.ts), and Enterprise's teams, federation issuers and
// invitations (each handlers.test.ts).
//
// page_size 0 asks for the default page of 50: one arm per edition proves
// it end to end; the page loop's unit test and the list-shape inventory pin
// it for every lane. A version pushed between two pages repeats nothing,
// because the history pages by keyset on its audit order.
//
// Lists whose rows only a runner writes (runs, scores, evals), and the
// Enterprise and cloud lists the open-source server does not route (teams,
// identity providers, invitations, the billing catalog), are walked where
// their rows are made: the execution suites and the cloud composition.
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { AGENT_API_VERSION, AGENT_KIND, agentRefOf, makeAgent, makeAgentSpec } from "../support/agents";
import { makeAgentShare } from "../support/agentshares";
import { makeSlackChannelApp } from "../support/channelapps";
import { MEMORY_CAP, makeMemory } from "../support/memories";
import { uniqueName } from "../support/naming";
import { makeOAuthApp } from "../support/oauthapps";
import { createPlatformClient, deletePlatformClient } from "../support/platformclients";
import { mcpOnly, pushPlugin } from "../support/plugins";
import { makeSchedule } from "../support/schedules";
import { makeSession } from "../support/sessions";
import { makeSkillArtifact } from "../support/skills";
import { makeSharedVault } from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

const ORG_API_VERSION = "tenancy.stigmer.ai/v1";
const ORG_KIND = "Organization";

// The default page a request naming no size gets, and the list contract's
// maximum: the numbers every list's page_size comment states.
const DEFAULT_PAGE_SIZE = 50;

// A walk that has not ended after this many pages is a list that never
// stops handing out tokens.
const MAX_PAGES = 1000;

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();
// Read at collection time so an edition without a capability reports its
// cases SKIPPED, never as passes that returned early.
const capabilities = createTarget().capabilities;

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

// =============================================================================
// The walk
// =============================================================================

interface Page<T> {
  readonly entries: readonly T[];
  readonly nextPageToken: string;
}

interface Walk {
  /** The ids in the order the pages returned them. */
  readonly ids: string[];
  /** How many entries each page held. */
  readonly sizes: number[];
}

/** Follows a list's tokens from `from` ("" is the first page) to the last. */
async function walk<T>(
  read: (pageToken: string) => Promise<Page<T>>,
  idOf: (entry: T) => string,
  from = "",
): Promise<Walk> {
  const ids: string[] = [];
  const sizes: number[] = [];
  let pageToken = from;
  do {
    const page = await read(pageToken);
    sizes.push(page.entries.length);
    ids.push(...page.entries.map(idOf));
    pageToken = page.nextPageToken;
    expect(sizes.length, "the walk ends").toBeLessThanOrEqual(MAX_PAGES);
  } while (pageToken !== "");
  return { ids, sizes };
}

/**
 * Follows a caller-wide list's tokens until every `seeded` id has come back.
 * A caller's organizations and keys are every one that identity ever made,
 * which on a long-lived target is hundreds, so reading to the last page
 * proves nothing more and can outrun the test. The seeded rows are the
 * newest, so they come back first, on the walk's first pages.
 */
async function walkUntilSeen<T>(
  read: (pageToken: string) => Promise<Page<T>>,
  idOf: (entry: T) => string,
  seeded: readonly string[],
): Promise<Walk> {
  const ids: string[] = [];
  const sizes: number[] = [];
  let pageToken = "";
  do {
    const page = await read(pageToken);
    sizes.push(page.entries.length);
    ids.push(...page.entries.map(idOf));
    pageToken = page.nextPageToken;
    expect(sizes.length, "the walk reaches the seeded rows").toBeLessThanOrEqual(MAX_PAGES);
  } while (pageToken !== "" && !seeded.every((id) => ids.includes(id)));
  return { ids, sizes };
}

/**
 * A list that holds exactly the seeded rows: three pages of one entry,
 * newest first. `seeded` is in creation order.
 */
function expectExactWalk(walked: Walk, seeded: readonly string[]): void {
  expect(walked.sizes, "three pages of one entry; a token on the first two only").toEqual([1, 1, 1]);
  expect(walked.ids, "newest first").toEqual([...seeded].reverse());
}

/**
 * A list that may hold other rows too: the seeded rows come back once each,
 * newest first, and no page exceeds page_size 1. `seeded` is in creation
 * order.
 */
function expectSeededWalk(walked: Walk, seeded: readonly string[]): void {
  expect(new Set(walked.ids).size, "no row is returned twice").toBe(walked.ids.length);
  for (const size of walked.sizes) {
    expect(size, "a page never exceeds page_size").toBeLessThanOrEqual(1);
  }
  const positions = seeded.map((id) => walked.ids.indexOf(id));
  for (const position of positions) {
    expect(position, "every seeded row is listed").toBeGreaterThanOrEqual(0);
  }
  expect(positions, "newest first").toEqual([...positions].sort((a, b) => b - a));
}

/** Runs `create` three times in sequence, returning the ids in creation order. */
async function seedThree(create: (i: number) => Promise<string>): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    ids.push(await create(i));
  }
  return ids;
}

// =============================================================================
// Fixtures
// =============================================================================

async function createAgent(org: string) {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("list-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));
  return agent;
}

async function createChannel(org: string, agentSlug: string): Promise<string> {
  const channel = await clients.agentChannelCommand.create(
    makeSlackAgentChannel(org, uniqueName("list-channel"), agentSlug),
  );
  fixtures.defer(() => clients.agentChannelCommand.delete({ value: channel.metadata!.id }));
  return channel.metadata!.id;
}

async function createShare(org: string, agentSlug: string): Promise<string> {
  const share = await clients.agentShareCommand.create(
    makeAgentShare(org, agentSlug, { name: uniqueName("list-share") }),
  );
  fixtures.defer(() => clients.agentShareCommand.delete({ value: share.metadata!.id }));
  return share.metadata!.id;
}

async function createSchedule(org: string, agentSlug: string): Promise<string> {
  const schedule = await clients.scheduleCommand.create(makeSchedule(org, uniqueName("list-sched"), agentSlug));
  fixtures.defer(() => clients.scheduleCommand.delete({ value: schedule.metadata!.id }));
  return schedule.metadata!.id;
}

async function createSession(org: string, agent: Awaited<ReturnType<typeof createAgent>>): Promise<string> {
  const session = await clients.sessionCommand.create(
    makeSession({ org, name: uniqueName("list-session"), agentRef: agentRefOf(agent) }),
  );
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }).catch(() => undefined));
  return session.metadata!.id;
}

// =============================================================================
// Lists of one parent: exactly three pages
// =============================================================================

describe("List conformance — a parent's lists walk exactly three pages", () => {
  it("[rpc:AgentChannelQueryController.listByAgent] an agent's channels page one at a time, newest first", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seeded = await seedThree(() => createChannel(org, agent.metadata!.slug));

    const walked = await walk(
      (pageToken) => clients.agentChannelQuery.listByAgent({ agentId: agent.metadata!.id, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectExactWalk(walked, seeded);
  });

  it("[rpc:AgentShareQueryController.listByAgent] an agent's shares page one at a time, newest first", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seeded = await seedThree(() => createShare(org, agent.metadata!.slug));

    const walked = await walk(
      (pageToken) => clients.agentShareQuery.listByAgent({ agentId: agent.metadata!.id, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectExactWalk(walked, seeded);
  });

  it("[rpc:ScheduleQueryController.listByAgent] an agent's schedules page one at a time, newest first", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seeded = await seedThree(() => createSchedule(org, agent.metadata!.slug));

    const walked = await walk(
      (pageToken) => clients.scheduleQuery.listByAgent({ agentId: agent.metadata!.id, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectExactWalk(walked, seeded);
  });

  it("[rpc:SessionQueryController.listByAgent] an agent's sessions page one at a time, newest first", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seeded = await seedThree(() => createSession(org, agent));

    const walked = await walk(
      (pageToken) => clients.sessionQuery.listByAgent({ agentId: agent.metadata!.id, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectExactWalk(walked, seeded);
  });

  it("[rpc:AgentQueryController.listVersions] a version saved between two pages repeats nothing in the walk", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("list-versions");
    const apply = async (label: string) =>
      clients.agentCommand.apply({
        apiVersion: AGENT_API_VERSION,
        kind: AGENT_KIND,
        metadata: { name, org },
        spec: makeAgentSpec({ instructions: `List version fixture, ${label}.` }),
      });
    const v1 = await apply("v1");
    fixtures.defer(() => clients.agentCommand.delete({ value: v1.metadata!.id }).catch(() => undefined));
    const v2 = await apply("v2");
    const v3 = await apply("v3");
    const slug = v1.metadata!.slug;

    const first = await clients.agentQuery.listVersions({ org, slug, pageSize: 1 });
    expect(first.entries.map((entry) => entry.versionHash)).toEqual([v3.status?.versionHash]);
    expect(first.nextPageToken, "a partial page carries a token").not.toBe("");

    // A save between two pages lands above the walk's position: it is the
    // newest version, and the rest of the walk neither repeats v3 nor
    // skips v2 or v1.
    const v4 = await apply("v4");
    expect(v4.status?.versionHash).not.toBe(v3.status?.versionHash);

    const rest = await walk(
      (pageToken) => clients.agentQuery.listVersions({ org, slug, pageSize: 1, pageToken }),
      (entry) => entry.versionHash,
      first.nextPageToken,
    );
    expect(rest.ids, "the walk continues where it stopped").toEqual([v2.status?.versionHash, v1.status?.versionHash]);
    expect(rest.sizes, "one entry a page, then the end").toEqual([1, 1]);

    const fresh = await clients.agentQuery.listVersions({ org, slug, pageSize: 1 });
    expect(fresh.entries.map((entry) => entry.versionHash), "a fresh walk starts at the new head").toEqual([
      v4.status?.versionHash,
    ]);
    expect(fresh.entries[0]?.isCurrent).toBe(true);
  });
});

// =============================================================================
// Lists of an organization or of the caller: the seeded rows, once, in order
// =============================================================================

describe("List conformance — an organization's lists walk every seeded row once, newest first", () => {
  it("[rpc:AgentQueryController.list] agents", async () => {
    const { org } = await target.provisionTenancy();
    const seeded = await seedThree(async () => (await createAgent(org)).metadata!.id);

    const walked = await walk(
      (pageToken) => clients.agentQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:SkillQueryController.list] skills", async () => {
    const { org } = await target.provisionTenancy();
    const seeded = await seedThree(async () => {
      const skill = await clients.skillCommand.push({
        org,
        artifact: makeSkillArtifact({ name: uniqueName("list-skill"), description: "a listed skill" }),
      });
      fixtures.defer(() => clients.skillCommand.delete({ value: skill.metadata!.id }));
      return skill.metadata!.id;
    });

    const walked = await walk(
      (pageToken) => clients.skillQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:PluginQueryController.list] plugins", async () => {
    const { org } = await target.provisionTenancy();
    const seeded = await seedThree(
      async () => (await pushPlugin(clients, fixtures, org, mcpOnly(uniqueName("list-plugin")))).metadata!.id,
    );

    const walked = await walk(
      (pageToken) => clients.pluginQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:AgentChannelQueryController.list] agent channels", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seeded = await seedThree(() => createChannel(org, agent.metadata!.slug));

    const walked = await walk(
      (pageToken) => clients.agentChannelQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:AgentShareQueryController.list] agent shares", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seeded = await seedThree(() => createShare(org, agent.metadata!.slug));

    const walked = await walk(
      (pageToken) => clients.agentShareQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:ScheduleQueryController.list] schedules", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seeded = await seedThree(() => createSchedule(org, agent.metadata!.slug));

    const walked = await walk(
      (pageToken) => clients.scheduleQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:VaultQueryController.list] vaults", async () => {
    const { org } = await target.provisionTenancy();
    const seeded = await seedThree(async () => {
      const vault = await clients.vaultCommand.create(makeSharedVault({ org, name: uniqueName("list-vault") }));
      fixtures.defer(() => clients.vaultCommand.delete({ resourceId: vault.metadata!.id }));
      return vault.metadata!.id;
    });

    const walked = await walk(
      (pageToken) => clients.vaultQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it.skipIf(!capabilities.firstPartyMemoryCapture)("[rpc:MemoryQueryController.list] memories", async () => {
    const created = await clients.organizationCommand.create({
      apiVersion: ORG_API_VERSION,
      kind: ORG_KIND,
      metadata: { name: uniqueName("list-memorg") },
      spec: { preferences: { memoryEnabled: true } },
    });
    fixtures.defer(() => clients.organizationCommand.delete({ value: created.metadata!.id }));
    const org = created.metadata!.id;
    const seeded = await seedThree(async (i) => {
      const memory = await clients.memoryCommand.create(makeMemory(org, { content: `Listed fact ${i}.` }));
      fixtures.defer(() => clients.memoryCommand.delete({ value: memory.metadata!.id }).catch(() => undefined));
      return memory.metadata!.id;
    });

    const walked = await walk(
      (pageToken) => clients.memoryQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
    expect(walked.ids.length, "a memory list stays under its cap").toBeLessThanOrEqual(MEMORY_CAP);
  });

  it("[rpc:SessionQueryController.list] sessions", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seeded = await seedThree(() => createSession(org, agent));

    const walked = await walk(
      (pageToken) => clients.sessionQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:OAuthAppQueryController.list] OAuth apps", async () => {
    const { org } = await target.provisionTenancy();
    const seeded = await seedThree(async () => {
      const app = await clients.oauthAppCommand.create(makeOAuthApp(org, uniqueName("list-oauth")));
      fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: app.metadata!.id }));
      return app.metadata!.id;
    });

    const walked = await walk(
      (pageToken) => clients.oauthAppQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:ChannelAppQueryController.list] channel apps", async () => {
    const { org } = await target.provisionTenancy();
    const seeded = await seedThree(async () => {
      const app = await clients.channelAppCommand.create(makeSlackChannelApp(org, uniqueName("list-chapp")));
      fixtures.defer(() => clients.channelAppCommand.delete({ resourceId: app.metadata!.id }));
      return app.metadata!.id;
    });

    const walked = await walk(
      (pageToken) => clients.channelAppQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:PlatformClientQueryController.list] platform clients", async () => {
    const context = await target.provisionTenancy();
    fixtures.defer(() => target.cleanupTenancy(context));
    const { org } = context;
    const seeded = await seedThree(async () => {
      const client = await createPlatformClient(clients, { org, name: uniqueName("list-pc") });
      fixtures.defer(async () => {
        try {
          await deletePlatformClient(clients, client.id);
        } catch {
          // Already gone with its tenancy.
        }
      });
      return client.id;
    });

    const walked = await walk(
      (pageToken) => clients.platformClientQuery.list({ org, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:ApiKeyQueryController.list] the caller's API keys", async () => {
    const { org } = await target.provisionTenancy();
    const seeded = await seedThree(async () => {
      const key = await clients.apiKeyCommand.create({
        apiVersion: "iam.stigmer.ai/v1",
        kind: "ApiKey",
        metadata: { name: uniqueName("list-key"), org },
        spec: {},
      });
      fixtures.defer(() => clients.apiKeyCommand.delete({ value: key.metadata!.id }).catch(() => undefined));
      return key.metadata!.id;
    });

    const walked = await walkUntilSeen(
      (pageToken) => clients.apiKeyQuery.list({ pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
      seeded,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:OrganizationQueryController.listMine] the caller's organizations", async () => {
    const seeded = await seedThree(async () => {
      const created = await clients.organizationCommand.create({
        apiVersion: ORG_API_VERSION,
        kind: ORG_KIND,
        metadata: { name: uniqueName("list-org") },
      });
      fixtures.defer(() => clients.organizationCommand.delete({ value: created.metadata!.id }).catch(() => undefined));
      return created.metadata!.id;
    });

    const walked = await walkUntilSeen(
      (pageToken) => clients.organizationQuery.listMine({ pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
      seeded,
    );
    expectSeededWalk(walked, seeded);
  });

  it("[rpc:SearchService.search] search's list mode walks its pages by token", async () => {
    const { org } = await target.provisionTenancy();
    const seeded = await seedThree(async () => (await createAgent(org)).metadata!.id);

    const walked = await walk(
      (pageToken) => clients.search.search({ kinds: [ApiResourceKind.agent], org, pageSize: 1, pageToken }),
      (entry) => entry.id,
    );
    expectSeededWalk(walked, seeded);
  });
});


// =============================================================================
// The label filter
// =============================================================================

/** A label only one walk's rows carry: the walk's filter. */
function walkLabels(): Record<string, string> {
  return { "list-walk": uniqueName("walk") };
}

/** `message` with `labels` on its metadata. */
function labelled<T extends { metadata?: object }>(message: T, labels: Record<string, string>): T {
  return { ...message, metadata: { ...message.metadata, labels } };
}

/**
 * Seeds an unlabelled row, two rows carrying a fresh label, another
 * unlabelled row and a third labelled one, then walks the list filtered by
 * that label at page_size 1: only the labelled rows, newest first.
 */
async function expectLabelledWalk<T>(
  seed: (labels: Record<string, string>) => Promise<string>,
  read: (labels: Record<string, string>, pageToken: string) => Promise<Page<T>>,
  idOf: (entry: T) => string,
): Promise<void> {
  const labels = walkLabels();
  await seed({});
  const ids = [await seed(labels), await seed(labels)];
  await seed({});
  ids.push(await seed(labels));

  const walked = await walk((pageToken) => read(labels, pageToken), idOf);
  expect(walked.ids, "only the labelled rows, newest first").toEqual([...ids].reverse());
  for (const size of walked.sizes) {
    expect(size, "a page never exceeds page_size").toBeLessThanOrEqual(1);
  }
}

describe("List conformance — a label filter walks only the rows carrying every label named", () => {
  it("[rpc:AgentQueryController.list] agents", async () => {
    const { org } = await target.provisionTenancy();
    await expectLabelledWalk(
      async (labels) => {
        const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("lbl-agent"), labels }));
        fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));
        return agent.metadata!.id;
      },
      (labels, pageToken) => clients.agentQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:SkillQueryController.list] skills", async () => {
    const { org } = await target.provisionTenancy();
    await expectLabelledWalk(
      async (labels) => {
        const skill = await clients.skillCommand.push({
          org,
          labels,
          artifact: makeSkillArtifact({ name: uniqueName("lbl-skill"), description: "a labelled skill" }),
        });
        fixtures.defer(() => clients.skillCommand.delete({ value: skill.metadata!.id }));
        return skill.metadata!.id;
      },
      (labels, pageToken) => clients.skillQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:AgentChannelQueryController.list] [rpc:AgentChannelQueryController.listByAgent] agent channels, of the organization and of one agent", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seed = async (labels: Record<string, string>) => {
      const channel = await clients.agentChannelCommand.create(
        labelled(makeSlackAgentChannel(org, uniqueName("lbl-channel"), agent.metadata!.slug), labels),
      );
      fixtures.defer(() => clients.agentChannelCommand.delete({ value: channel.metadata!.id }));
      return channel.metadata!.id;
    };
    await expectLabelledWalk(
      seed,
      (labels, pageToken) => clients.agentChannelQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    await expectLabelledWalk(
      seed,
      (labels, pageToken) =>
        clients.agentChannelQuery.listByAgent({ agentId: agent.metadata!.id, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:AgentShareQueryController.list] [rpc:AgentShareQueryController.listByAgent] agent shares, of the organization and of one agent", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seed = async (labels: Record<string, string>) => {
      const share = await clients.agentShareCommand.create(
        labelled(makeAgentShare(org, agent.metadata!.slug, { name: uniqueName("lbl-share") }), labels),
      );
      fixtures.defer(() => clients.agentShareCommand.delete({ value: share.metadata!.id }));
      return share.metadata!.id;
    };
    await expectLabelledWalk(
      seed,
      (labels, pageToken) => clients.agentShareQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    await expectLabelledWalk(
      seed,
      (labels, pageToken) =>
        clients.agentShareQuery.listByAgent({ agentId: agent.metadata!.id, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:ScheduleQueryController.list] [rpc:ScheduleQueryController.listByAgent] schedules, of the organization and of one agent", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seed = async (labels: Record<string, string>) => {
      const schedule = await clients.scheduleCommand.create(
        labelled(makeSchedule(org, uniqueName("lbl-sched"), agent.metadata!.slug), labels),
      );
      fixtures.defer(() => clients.scheduleCommand.delete({ value: schedule.metadata!.id }));
      return schedule.metadata!.id;
    };
    await expectLabelledWalk(
      seed,
      (labels, pageToken) => clients.scheduleQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    await expectLabelledWalk(
      seed,
      (labels, pageToken) =>
        clients.scheduleQuery.listByAgent({ agentId: agent.metadata!.id, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:SessionQueryController.list] [rpc:SessionQueryController.listByAgent] sessions, of the organization and of one agent", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const seed = async (labels: Record<string, string>) => {
      const session = await clients.sessionCommand.create(
        makeSession({ org, name: uniqueName("lbl-session"), agentRef: agentRefOf(agent), labels }),
      );
      fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }).catch(() => undefined));
      return session.metadata!.id;
    };
    await expectLabelledWalk(
      seed,
      (labels, pageToken) => clients.sessionQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    await expectLabelledWalk(
      seed,
      (labels, pageToken) =>
        clients.sessionQuery.listByAgent({ agentId: agent.metadata!.id, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:VaultQueryController.list] vaults", async () => {
    const { org } = await target.provisionTenancy();
    await expectLabelledWalk(
      async (labels) => {
        const vault = await clients.vaultCommand.create(
          labelled(makeSharedVault({ org, name: uniqueName("lbl-vault") }), labels),
        );
        fixtures.defer(() => clients.vaultCommand.delete({ resourceId: vault.metadata!.id }));
        return vault.metadata!.id;
      },
      (labels, pageToken) => clients.vaultQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it.skipIf(!capabilities.firstPartyMemoryCapture)("[rpc:MemoryQueryController.list] memories", async () => {
    const created = await clients.organizationCommand.create({
      apiVersion: ORG_API_VERSION,
      kind: ORG_KIND,
      metadata: { name: uniqueName("lbl-memorg") },
      spec: { preferences: { memoryEnabled: true } },
    });
    fixtures.defer(() => clients.organizationCommand.delete({ value: created.metadata!.id }));
    const org = created.metadata!.id;
    let fact = 0;
    await expectLabelledWalk(
      async (labels) => {
        fact += 1;
        const memory = await clients.memoryCommand.create(
          labelled(makeMemory(org, { content: `Labelled fact ${fact}.` }), labels),
        );
        fixtures.defer(() => clients.memoryCommand.delete({ value: memory.metadata!.id }).catch(() => undefined));
        return memory.metadata!.id;
      },
      (labels, pageToken) => clients.memoryQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:OAuthAppQueryController.list] OAuth apps", async () => {
    const { org } = await target.provisionTenancy();
    await expectLabelledWalk(
      async (labels) => {
        const app = await clients.oauthAppCommand.create(labelled(makeOAuthApp(org, uniqueName("lbl-oauth")), labels));
        fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: app.metadata!.id }));
        return app.metadata!.id;
      },
      (labels, pageToken) => clients.oauthAppQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:ChannelAppQueryController.list] channel apps", async () => {
    const { org } = await target.provisionTenancy();
    await expectLabelledWalk(
      async (labels) => {
        const app = await clients.channelAppCommand.create(
          labelled(makeSlackChannelApp(org, uniqueName("lbl-chapp")), labels),
        );
        fixtures.defer(() => clients.channelAppCommand.delete({ resourceId: app.metadata!.id }));
        return app.metadata!.id;
      },
      (labels, pageToken) => clients.channelAppQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:PlatformClientQueryController.list] platform clients", async () => {
    const context = await target.provisionTenancy();
    fixtures.defer(() => target.cleanupTenancy(context));
    const { org } = context;
    await expectLabelledWalk(
      async (labels) => {
        const client = await createPlatformClient(clients, { org, name: uniqueName("lbl-pc"), labels });
        fixtures.defer(async () => {
          try {
            await deletePlatformClient(clients, client.id);
          } catch {
            // Already gone with its tenancy.
          }
        });
        return client.id;
      },
      (labels, pageToken) => clients.platformClientQuery.list({ org, labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:ApiKeyQueryController.list] the caller's API keys", async () => {
    const { org } = await target.provisionTenancy();
    await expectLabelledWalk(
      async (labels) => {
        const key = await clients.apiKeyCommand.create({
          apiVersion: "iam.stigmer.ai/v1",
          kind: "ApiKey",
          metadata: { name: uniqueName("lbl-key"), org, labels },
          spec: {},
        });
        fixtures.defer(() => clients.apiKeyCommand.delete({ value: key.metadata!.id }).catch(() => undefined));
        return key.metadata!.id;
      },
      (labels, pageToken) => clients.apiKeyQuery.list({ labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:OrganizationQueryController.listMine] the caller's organizations", async () => {
    await expectLabelledWalk(
      async (labels) => {
        const created = await clients.organizationCommand.create({
          apiVersion: ORG_API_VERSION,
          kind: ORG_KIND,
          metadata: { name: uniqueName("lbl-org"), labels },
        });
        fixtures.defer(() => clients.organizationCommand.delete({ value: created.metadata!.id }).catch(() => undefined));
        return created.metadata!.id;
      },
      (labels, pageToken) => clients.organizationQuery.listMine({ labels, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
  });

  it("[rpc:AgentQueryController.list] two labels match only the rows carrying both", async () => {
    const { org } = await target.provisionTenancy();
    const team = walkLabels();
    const both = { ...team, tier: "gold" };
    const create = async (labels: Record<string, string>) => {
      const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("lbl-two"), labels }));
      fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));
      return agent.metadata!.id;
    };
    const first = await create(both);
    await create(team);
    await create({ tier: "gold" });
    const last = await create(both);

    const walked = await walk(
      (pageToken) => clients.agentQuery.list({ org, labels: both, pageSize: 1, pageToken }),
      (entry) => entry.metadata!.id,
    );
    expect(walked.ids).toEqual([last, first]);
  });
});

// =============================================================================
// The page size rule
// =============================================================================

describe("List conformance — the page size rule", () => {
  it("[rpc:AgentQueryController.list] page_size 0 answers the default page of 50 and a token for the rest", async () => {
    const { org } = await target.provisionTenancy();
    const before = await walk(
      (pageToken) => clients.agentQuery.list({ org, pageSize: 100, pageToken }),
      (entry) => entry.metadata!.id,
    );
    const seed = DEFAULT_PAGE_SIZE + 1 - before.ids.length;
    for (let i = 0; i < seed; i++) {
      await createAgent(org);
    }

    const first = await clients.agentQuery.list({ org });
    expect(first.entries, "0 is the default page, never every row").toHaveLength(DEFAULT_PAGE_SIZE);
    expect(first.nextPageToken, "a token follows to the rest").not.toBe("");

    const second = await clients.agentQuery.list({ org, pageToken: first.nextPageToken });
    expect(second.entries).toHaveLength(1);
    expect(second.nextPageToken).toBe("");
  });

  it("[rpc:AgentQueryController.list] a negative page_size is refused, and a token is bound to the request it was issued for", async () => {
    const { org } = await target.provisionTenancy();
    const other = await target.provisionTenancy();
    await createAgent(org);
    await createAgent(org);

    await expectGrpcCode(
      () => clients.agentQuery.list({ org, pageSize: -1 }),
      Code.InvalidArgument,
      "a negative page_size",
    );

    const first = await clients.agentQuery.list({ org, pageSize: 1 });
    expect(first.nextPageToken).not.toBe("");
    await expectGrpcCode(
      () => clients.agentQuery.list({ org: other.org, pageSize: 1, pageToken: first.nextPageToken }),
      Code.InvalidArgument,
      "a token reused on another organization's list",
    );
  });
});
