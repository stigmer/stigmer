/**
 * Names (../names.ts): every named kind's slug is a claimed name in the one
 * name table. What the tests pin:
 *
 *   - NAMED_KINDS answers for every kind in ApiResourceKind, and the kinds
 *     that claim are exactly the listed ones, so a new kind, or a kind
 *     that stops claiming, is a reviewed change here;
 *   - claimName on both drivers: a free name is won; a name the id already
 *     holds counts as won; a live holder keeps it; a holder that no longer
 *     holds it is freed only once its claim is old enough; a name equal to
 *     its holder's id is never freed;
 *   - on a composed server on both drivers, two creates of one agent slug
 *     racing in one organization: exactly one lands and the other is
 *     refused AlreadyExists (stigmer#2153); the same slug in another
 *     organization lands; a lookup by slug reads the winner; a delete
 *     frees the slug for a new agent, which gets a new id, and frees the
 *     names its cascade deletes (its channel's slug) at once;
 *   - findResourceByName reads an empty organization as the platform's own
 *     scope, never every organization, and refuses a kind whose slugs are
 *     not names;
 *   - releaseNameAfterFailure lets a name go only when its row never landed;
 *   - the steps' own faults: a claim with no slug or id, a name table that
 *     faults, and a name table alone with no holder are INTERNAL; a
 *     release after a failed create or a delete that faults is logged,
 *     never thrown, and ReleaseNames with no loaded row is INTERNAL.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ChannelCommandController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/command_pb";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import {
  ApiResourceKind,
  ApiResourceKindSchema,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import {
  organizationId,
  seedOrganizations,
} from "../../../domain/organization/__tests__/support.js";
import {
  dropPostgresFixture,
  driverFixtures,
} from "../../../authorization/__tests__/drivers.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
} from "../../../store/postgres/__tests__/support.js";
import type { TestDatabase } from "../../../store/postgres/__tests__/support.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import { EXISTING_RESOURCE_KEY } from "../load-existing.js";
import {
  ABANDONED_NAME_AFTER_MS,
  NAMED_KINDS,
  claimName,
  claimNameOf,
  findResourceByName,
  newClaimNameStep,
  newReleaseNamesStep,
  portHolder,
  releaseNameAfterFailure,
  resourceNameKey,
  storedRowHolder,
} from "../names.js";
import type { NameTable } from "../names.js";
import type { Store } from "../../../store/interface.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const ACME = "org_01jz00000000000000000acme0";

/** The kinds whose slugs are names. A change here is a change to the contract every kind meets. */
const CLAIMING_KINDS = [
  ApiResourceKind.identity_account,
  ApiResourceKind.federation_issuer,
  ApiResourceKind.oauth_app,
  ApiResourceKind.team,
  ApiResourceKind.organization,
  ApiResourceKind.agent,
  ApiResourceKind.session,
  ApiResourceKind.skill,
  ApiResourceKind.channel,
  ApiResourceKind.channel_app,
  ApiResourceKind.schedule,
  ApiResourceKind.memory,
  ApiResourceKind.plugin,
  ApiResourceKind.vault,
  ApiResourceKind.score,
  ApiResourceKind.scoring_rule,
  ApiResourceKind.eval,
  ApiResourceKind.eval_run,
];

describe("NAMED_KINDS", () => {
  it("answers for every kind, and exactly the listed kinds claim their slugs", () => {
    const every = ApiResourceKindSchema.values.map((value) => value.number as ApiResourceKind);
    expect(Object.keys(NAMED_KINDS).map(Number).sort((a, b) => a - b)).toEqual(
      [...every].sort((a, b) => a - b),
    );
    const claiming = every.filter((kind) => NAMED_KINDS[kind].claims);
    expect(claiming.sort((a, b) => a - b)).toEqual(
      [...CLAIMING_KINDS].sort((a, b) => a - b),
    );
    for (const kind of every) {
      const named = NAMED_KINDS[kind];
      if (!named.claims) {
        expect(named.reason, `${ApiResourceKind[kind]} says why it claims nothing`).not.toBe("");
      }
    }
  });
});

describe.each(driverFixtures([ApiResourceKind.agent]))("claimName ($name)", (fixture) => {
  afterAll(dropPostgresFixture);

  // Each case its own slug: Postgres's test database is shared across the
  // cases, and its name table is not cleared between them.
  const keyFor = (slug: string) => resourceNameKey(ApiResourceKind.agent, ACME, slug);
  const holdsNothing = { holds: async () => false };
  const holdsAll = { holds: async () => true };
  const longAgo = new Date(Date.now() - ABANDONED_NAME_AFTER_MS - 60_000);

  it.skipIf(fixture.skip)("wins a free name, and counts a name the id holds as won", async () => {
    const opened = await fixture.open();
    try {
      const store = opened.store;
      const key = keyFor("won");
      const first = await claimName(store, key, "agt_a", new Date(), holdsNothing);
      expect(first).toMatchObject({ claimed: true, entry: { id: "agt_a", state: "current" } });
      const again = await claimName(store, key, "agt_a", new Date(), holdsNothing);
      expect(again).toMatchObject({ claimed: true, entry: { id: "agt_a" } });
    } finally {
      await opened.close();
    }
  });

  it.skipIf(fixture.skip)("leaves a live holder its name, and a gone one its name while its claim is young", async () => {
    const opened = await fixture.open();
    try {
      const store = opened.store;
      const key = keyFor("live");
      await claimName(store, key, "agt_a", new Date(), holdsAll);
      const live = await claimName(store, key, "agt_b", new Date(), holdsAll);
      expect(live).toMatchObject({ claimed: false, entry: { id: "agt_a" } });
      const young = await claimName(store, key, "agt_b", new Date(), holdsNothing);
      expect(young, "a create holds its claim a step before its row").toMatchObject({
        claimed: false,
        entry: { id: "agt_a" },
      });
    } finally {
      await opened.close();
    }
  });

  it.skipIf(fixture.skip)("frees a name whose holder is gone once its claim is old, but never a name equal to its id", async () => {
    const opened = await fixture.open();
    try {
      const store = opened.store;
      const key = keyFor("gone");
      await store.resourceNames.claim(key, "agt_gone", longAgo.toISOString());
      const taken = await claimName(store, key, "agt_b", new Date(), holdsNothing);
      expect(taken).toMatchObject({ claimed: true, entry: { id: "agt_b" } });

      const legacy = resourceNameKey(ApiResourceKind.agent, ACME, "agt_legacy");
      await store.resourceNames.claim(legacy, "agt_legacy", longAgo.toISOString());
      const refused = await claimName(store, legacy, "agt_c", new Date(), holdsNothing);
      expect(refused).toMatchObject({ claimed: false, entry: { id: "agt_legacy" } });
    } finally {
      await opened.close();
    }
  });

  it.skipIf(fixture.skip)("lets a failed create's name go only when its row never landed", async () => {
    const opened = await fixture.open();
    try {
      const store = opened.store;
      const agent = create(AgentSchema, {
        metadata: { id: "agt_unstored", org: ACME, slug: "draft", name: "draft" },
      });
      const ctx = new RequestContext(AgentSchema, agent, testCallerIdentity(), ApiResourceKind.agent);
      await newClaimNameStep(store, ApiResourceKind.agent).execute(ctx);
      await releaseNameAfterFailure(store, silentLogger, ctx);
      expect(
        await store.resourceNames.resolve(
          resourceNameKey(ApiResourceKind.agent, ACME, "draft"),
          new Date().toISOString(),
        ),
      ).toBeUndefined();

      const stored = create(AgentSchema, {
        metadata: { id: "agt_stored", org: ACME, slug: "kept", name: "kept" },
      });
      const storedCtx = new RequestContext(AgentSchema, stored, testCallerIdentity(), ApiResourceKind.agent);
      await newClaimNameStep(store, ApiResourceKind.agent).execute(storedCtx);
      await store.saveResource(ApiResourceKind.agent, "agt_stored", AgentSchema, stored);
      await releaseNameAfterFailure(store, silentLogger, storedCtx);
      expect(
        (
          await store.resourceNames.resolve(
            resourceNameKey(ApiResourceKind.agent, ACME, "kept"),
            new Date().toISOString(),
          )
        )?.id,
        "a Persist that stored the row keeps its name",
      ).toBe("agt_stored");
      expect(
        await storedRowHolder(store, ApiResourceKind.agent, AgentSchema).holds({
          kind: "agent",
          org: ACME,
          name: "kept",
          id: "agt_stored",
          state: "current",
          claimedAt: "",
          expiresAt: "",
        }),
      ).toBe(true);
    } finally {
      await opened.close();
    }
  });

  it.skipIf(fixture.skip)("reads an empty organization as the platform's scope, never every organization, and refuses a kind whose slugs are not names", async () => {
    const opened = await fixture.open();
    try {
      const store = opened.store;
      await store.resourceNames.claim(keyFor("scoped"), "agt_acme", new Date().toISOString());
      await store.saveResource(
        ApiResourceKind.agent,
        "agt_acme",
        AgentSchema,
        create(AgentSchema, { metadata: { id: "agt_acme", org: ACME, slug: "scoped" } }),
      );
      expect(
        await findResourceByName(store, ApiResourceKind.agent, AgentSchema, "", "scoped"),
      ).toBeUndefined();
      await expect(
        findResourceByName(opened.store, ApiResourceKind.run, RunSchema, ACME, "run-1"),
      ).rejects.toThrow("failed to look the resource up by name");
    } finally {
      await opened.close();
    }
  });
});

/** What `run` throws, or undefined when it resolves. */
async function failureOf(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("the name steps' own faults", () => {
  const agent = (metadata: { id?: string; slug?: string }) =>
    create(AgentSchema, { metadata: { org: ACME, ...metadata } });
  const contextOf = (resource: ReturnType<typeof agent>) =>
    new RequestContext(AgentSchema, resource, testCallerIdentity(), ApiResourceKind.agent);
  const entryOf = (id: string) => ({
    kind: "agent",
    org: ACME,
    name: "support",
    id,
    state: "current" as const,
    claimedAt: new Date().toISOString(),
    expiresAt: "",
  });
  const recording = () => {
    const errors: string[] = [];
    const logger = createLogger({ level: "error", pretty: false, write: () => {} });
    logger.error = (message: string) => {
      errors.push(message);
    };
    return { logger, errors };
  };
  const tableThat = (resourceNames: Partial<Store["resourceNames"]>): NameTable =>
    ({ resourceNames }) as unknown as NameTable;

  it("a port holder holds a name while its port finds the row", async () => {
    const holder = portHolder(async (id) => (id === "agt_live" ? {} : undefined));
    expect(await holder.holds(entryOf("agt_live"))).toBe(true);
    expect(await holder.holds(entryOf("agt_gone"))).toBe(false);
  });

  it("ClaimName with no slug or id, a name table that faults, and a name table alone with no holder are INTERNAL", async () => {
    const claimed = tableThat({ claim: async () => ({ claimed: true, entry: entryOf("agt_1") }) });
    const holder = portHolder(async () => undefined);
    for (const resource of [agent({ id: "agt_1" }), agent({ slug: "support" })]) {
      const error = await failureOf(() =>
        newClaimNameStep(claimed, ApiResourceKind.agent, holder).execute(contextOf(resource)),
      );
      expect(ConnectError.from(error).code).toBe(Code.Internal);
    }
    const faulting = tableThat({
      claim: async () => {
        throw new Error("name table down");
      },
    });
    const fault = await failureOf(() =>
      newClaimNameStep(faulting, ApiResourceKind.agent, holder).execute(
        contextOf(agent({ id: "agt_1", slug: "support" })),
      ),
    );
    expect(ConnectError.from(fault).rawMessage).toBe("failed to claim the resource's name");
    const holderless = await claimNameOf(
      contextOf(agent({ id: "agt_1", slug: "support" })),
      claimed,
      ApiResourceKind.agent,
      agent({ id: "agt_1", slug: "support" }),
      AgentSchema,
    ).catch((caught: unknown) => caught);
    expect(ConnectError.from(holderless).code).toBe(Code.Internal);
  });

  it("a failed create's release that faults is logged, never thrown", async () => {
    const { logger, errors } = recording();
    const ctx = contextOf(agent({ id: "agt_1", slug: "support" }));
    const table = tableThat({
      claim: async () => ({ claimed: true, entry: entryOf("agt_1") }),
      release: async () => {
        throw new Error("name table down");
      },
    });
    await newClaimNameStep(table, ApiResourceKind.agent, portHolder(async () => undefined)).execute(ctx);
    await expect(releaseNameAfterFailure(table, logger, ctx)).resolves.toBeUndefined();
    expect(errors).toEqual([expect.stringMatching(/could not be released/)]);
  });

  it("ReleaseNames with no loaded row is INTERNAL, and a release that faults is logged, never thrown", async () => {
    const { logger, errors } = recording();
    const table = tableThat({
      release: async () => {
        throw new Error("name table down");
      },
    });
    const step = newReleaseNamesStep(table, logger, ApiResourceKind.agent);
    const missing = await failureOf(() => step.execute(contextOf(agent({}))));
    expect(ConnectError.from(missing).code).toBe(Code.Internal);

    const loaded = contextOf(agent({}));
    loaded.set(EXISTING_RESOURCE_KEY, agent({ id: "agt_1", slug: "support" }));
    await expect(step.execute(loaded)).resolves.toBeUndefined();
    expect(errors).toEqual([expect.stringMatching(/names could not be released/)]);
  });
});

interface ComposedDriver {
  readonly name: string;
  readonly skip: boolean;
  config(dir: string): Record<string, string>;
}

let postgresDatabase: TestDatabase | undefined;

const COMPOSED_DRIVERS: ReadonlyArray<ComposedDriver> = [
  {
    name: "sqlite",
    skip: false,
    config: (dir) => ({ DB_PATH: path.join(dir, "stigmer.db") }),
  },
  {
    name: "postgres",
    skip: testDatabaseAdminUrl() === undefined,
    config: () => ({ DATABASE_URL: postgresDatabase?.databaseUrl ?? "" }),
  },
];

describe.each(COMPOSED_DRIVERS)("one agent slug per organization, raced on a composed server ($name)", (driver) => {
  let dir: string;
  let server: ComposedServer;
  let transport: Transport;
  let command: Client<typeof AgentCommandController>;
  let query: Client<typeof AgentQueryController>;
  let acmeId: string;

  beforeAll(async () => {
    if (driver.skip) {
      return;
    }
    if (driver.name === "postgres") {
      postgresDatabase = await createTestDatabase();
    }
    dir = mkdtempSync(path.join(tmpdir(), "names-race-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        ...driver.config(dir),
      }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    const ids = await seedOrganizations(transport, ["acme", "globex"]);
    acmeId = organizationId(ids, "acme");
    command = createClient(AgentCommandController, transport);
    query = createClient(AgentQueryController, transport);
  });

  afterAll(async () => {
    if (driver.skip) {
      return;
    }
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    await postgresDatabase?.drop();
    postgresDatabase = undefined;
  });

  const agentInput = (org: string, name: string) => ({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name, org },
    spec: { instructions: `Agent instructions for ${name}.` },
  });

  it.skipIf(driver.skip)("lands exactly one of two racing creates, and refuses the other AlreadyExists", async () => {
    const outcomes = await Promise.allSettled([
      command.create(agentInput("acme", "support")),
      command.create(agentInput("acme", "support")),
    ]);
    const landed = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const refused = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(landed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const refusal = ConnectError.from(refused[0]!.reason);
    expect(refusal.code).toBe(Code.AlreadyExists);
    expect(refusal.rawMessage).toMatch(/^Agent already exists: slug 'support' in org '/);

    const winner = (landed[0] as PromiseFulfilledResult<{ metadata?: { id: string } }>).value;
    const found = await query.getByReference({
      kind: ApiResourceKind.agent,
      org: acmeId,
      slug: "support",
    });
    expect(found.metadata?.id).toBe(winner.metadata?.id);
  });

  it.skipIf(driver.skip)("frees the names an agent's delete cascades to: its channel's slug is free at once", async () => {
    const channels = createClient(ChannelCommandController, transport);
    const webChannelInput = (agentSlug: string) => ({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Channel",
      metadata: { name: "cascade-share", org: "acme" },
      spec: {
        agentRef: { kind: ApiResourceKind.agent, slug: agentSlug },
        enabled: true,
        type: { case: "web" as const, value: { audience: ChannelAudience.public } },
      },
    });
    const first = await command.create(agentInput("acme", "cascading"));
    await channels.create(webChannelInput("cascading"));
    await command.delete({ value: first.metadata?.id ?? "" });

    await command.create(agentInput("acme", "cascaded-again"));
    const again = await channels.create(webChannelInput("cascaded-again"));
    expect(again.metadata?.slug).toBe("cascade-share");
  });

  it.skipIf(driver.skip)("lets another organization take the same slug", async () => {
    const created = await command.create(agentInput("globex", "support"));
    expect(created.metadata?.slug).toBe("support");
  });

  it.skipIf(driver.skip)("frees a deleted agent's slug for a new agent with a new id", async () => {
    const first = await command.create(agentInput("acme", "triage"));
    await command.delete({ value: first.metadata?.id ?? "" });
    const second = await command.create(agentInput("acme", "triage"));
    expect(second.metadata?.id).not.toBe(first.metadata?.id);
    const found = await query.getByReference({
      kind: ApiResourceKind.agent,
      org: acmeId,
      slug: "triage",
    });
    expect(found.metadata?.id).toBe(second.metadata?.id);
  });
});
