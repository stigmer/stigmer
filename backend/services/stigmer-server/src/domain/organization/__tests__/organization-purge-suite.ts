/**
 * The organization purge's proof through a composed server, shared by the
 * SQLite and Postgres entries (organization-purge.test.ts,
 * organization-purge.postgres.test.ts): an organization holding a row of
 * every kind it can own and a record in every side table, deleted, then
 * purged; afterwards no stored row names its id or any id it owned
 * (store/__tests__/organization-census.ts), and its slug can be taken.
 *
 * The seed. The kinds a trusted-local server creates without an engine go
 * through their RPCs (an agent and its version archive, a share of it, a
 * shared vault holding a sealed secret and an external id, the caller's My
 * vault, a session), so the purge meets rows as their own chains wrote
 * them, and the two vaults' name claims (the external id's, and the
 * person's one My vault per organization) as the vault chains took them; every other kind the core purges is
 * stored directly with the organization in `metadata.org` (an API key with
 * it in `spec.bound_org`, a login app with an address it holds as a name
 * claim), with the side-table records a run, a schedule or a vault leaves
 * (the fire ledger, a pending OAuth state and a Connect link), and
 * an access row on the agent. A
 * second organization holds the same shapes and must keep all of them.
 * The census sees both vault name claims before the purge and neither
 * after, so the doomed organization's external id and its person's My
 * vault can be taken again.
 *
 * A unit's stage runs twice: in its place and again in the final stage's
 * sweep, for a row written after it first passed; it reads the
 * organization's sessions through its context's row reader.
 *
 * Between the delete and the purge, the organization answers not-found on
 * the wire and on the in-process lane, where server code starts work
 * (a create naming it is refused), so nothing new lands while it is purged.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DescMessage } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { builtInModel } from "../../../authorization/model/index.js";
import { loadConfig } from "../../../boot/config.js";
import { createLogger } from "../../../boot/logger.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { CORE_PURGED_KINDS } from "../../../boot/organization-purge.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import {
  organizationCensus,
  postgresCensusReader,
  sqliteCensusReader,
} from "../../../store/__tests__/organization-census.js";
import type { CensusReader } from "../../../store/__tests__/organization-census.js";
import { triple } from "../../iampolicy/__tests__/support.js";
import { oauthAppAddressKey } from "../../vault/login-app.js";

const API_VERSION = "agentic.stigmer.ai/v1";

/** A run stored by the seed has finished. */
const FINISHED_PHASE = RunPhase.RUN_COMPLETED;

/** How the suite reaches the database the composed server writes. */
export interface PurgeSuiteDatabase {
  /** The server config's storage keys: DB_PATH or DATABASE_URL. */
  readonly config: (dir: string) => Record<string, string>;
  /** A census reader over the same database. */
  readonly census: (dir: string) => Promise<{ reader: CensusReader; close(): Promise<void> }>;
}

export const sqliteDatabase: PurgeSuiteDatabase = {
  config: (dir) => ({ DB_PATH: path.join(dir, "stigmer.db") }),
  async census(dir) {
    const db = new DatabaseSync(path.join(dir, "stigmer.db"), { readOnly: true });
    return { reader: sqliteCensusReader(db), close: async () => db.close() };
  },
};

export function postgresDatabase(databaseUrl: string): PurgeSuiteDatabase {
  return {
    config: () => ({ DATABASE_URL: databaseUrl }),
    async census() {
      const pool = new pg.Pool({ connectionString: databaseUrl });
      return { reader: postgresCensusReader(pool), close: () => pool.end() };
    },
  };
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the call to fail");
}

/** The kinds the core purges that the seed stores directly (the rest are made by their RPCs or are policies). */
const STORED_KINDS = [...CORE_PURGED_KINDS].filter(
  (kind) =>
    kind !== ApiResourceKind.iam_policy &&
    kind !== ApiResourceKind.agent &&
    kind !== ApiResourceKind.agent_share &&
    kind !== ApiResourceKind.vault &&
    kind !== ApiResourceKind.session,
);

export function describeOrganizationPurge(
  label: string,
  database: () => PurgeSuiteDatabase,
): void {
  describe(`organization purge (composed server, ${label})`, () => {
    let dir: string;
    let server: ComposedServer;
    let organizations: Client<typeof OrganizationCommandController>;
    let organizationQuery: Client<typeof OrganizationQueryController>;
    let agents: Client<typeof AgentCommandController>;
    let shares: Client<typeof AgentShareCommandController>;
    let vaults: Client<typeof VaultCommandController>;
    let sessions: Client<typeof SessionCommandController>;
    let internalSessions: Client<typeof SessionCommandController>;
    let platform: Client<typeof IamPolicyCommandController>;

    /** Organizations the purge holds until the test lets go. */
    const held = new Set<string>();
    /** How often the unit's stage finished for each organization. */
    const finished = new Map<string, number>();
    /** The sessions the unit's stage read through its context's row reader, by organization. */
    const sessionsRead = new Map<string, ReadonlyArray<string>>();
    /** The session each seeded organization holds. */
    const sessionIds = new Map<string, string>();
    const holding: ServerExtension = {
      name: "purge-hold",
      orgPurge: {
        stages: [
          {
            name: "test-hold",
            async run(context) {
              if (held.has(context.org.id)) {
                return { more: true, wait: true };
              }
              finished.set(context.org.id, (finished.get(context.org.id) ?? 0) + 1);
              if (!sessionsRead.has(context.org.id)) {
                const page = await context.rows.ids(ApiResourceKind.session, SessionSchema, {
                  after: "",
                  limit: 10,
                });
                sessionsRead.set(context.org.id, page.ids);
              }
              return { more: false };
            },
          },
        ],
      },
    };

    beforeAll(async () => {
      dir = mkdtempSync(path.join(tmpdir(), "organization-purge-"));
      server = await composeServer({
        config: loadConfig({
          STIGMER_MODEL_REGISTRY_REFRESH: "off",
          TEMPORAL_HOST_PORT: "127.0.0.1:1",
          STORAGE_PATH: path.join(dir, "storage"),
          ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
          ...database().config(dir),
        }),
        logger: process.env.PURGE_DEBUG === "1" ? createLogger({ level: "warn", pretty: false }) : silentLogger,
        extensions: [holding],
        portOverride: 0,
        host: "127.0.0.1",
      });
      const port = await server.start();
      const transport = createGrpcTransport({
        baseUrl: `http://127.0.0.1:${port}`,
      });
      organizations = createClient(OrganizationCommandController, transport);
      organizationQuery = createClient(OrganizationQueryController, transport);
      agents = createClient(AgentCommandController, transport);
      shares = createClient(AgentShareCommandController, transport);
      vaults = createClient(VaultCommandController, transport);
      sessions = createClient(SessionCommandController, transport);
      internalSessions = createClient(
        SessionCommandController,
        server.inProcessTransport,
      );
      platform = createClient(
        IamPolicyCommandController,
        server.inProcessTransport,
      );
    });

    afterAll(async () => {
      await server.shutdown();
      rmSync(dir, { recursive: true, force: true });
    });

    /** An organization holding a row of every kind and a record in every side table; answers every id it owns. */
    async function seeded(
      slug: string,
    ): Promise<{ org: string; ids: Set<string>; vaultIds: ReadonlyArray<string>; claimHolders: ReadonlyArray<string> }> {
      const created = await organizations.create({
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { name: slug, slug, org: "" },
      });
      const org = created.metadata?.id ?? "";
      const ids = new Set<string>([org]);
      const agent = await agents.create({
        apiVersion: API_VERSION,
        kind: "Agent",
        metadata: { name: `${slug}-agent`, org },
        spec: {
          description: "seeded for the purge proof",
          instructions: "You are seeded for the purge proof.",
        },
      });
      const agentId = agent.metadata?.id ?? "";
      ids.add(agentId);
      const share = await shares.create({
        apiVersion: API_VERSION,
        kind: "AgentShare",
        metadata: { org },
        spec: { agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata?.slug ?? "" }, enabled: true },
      });
      ids.add(share.metadata?.id ?? "");
      const vault = await vaults.create({
        apiVersion: API_VERSION,
        kind: "Vault",
        metadata: { name: `${slug}-vault`, org },
        spec: { description: "seeded for the purge proof", externalId: `${slug}-external` },
      });
      const vaultId = vault.metadata?.id ?? "";
      await vaults.setSecrets({
        vault: { org, vault: { case: "id", value: vaultId } },
        secrets: { TOKEN: { value: "s3cr3t", description: "" } },
      });
      ids.add(vaultId);
      const mine = await vaults.setSecrets({
        vault: { org, vault: { case: "mine", value: true } },
        secrets: { MINE: { value: "m1ne", description: "" } },
      });
      const myVaultId = mine.metadata?.id ?? "";
      ids.add(myVaultId);
      const session = await sessions.create({
        apiVersion: API_VERSION,
        kind: "Session",
        metadata: { name: `${slug}-session`, org },
        spec: { agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata?.slug ?? "" } },
      });
      const sessionId = session.metadata?.id ?? "";
      ids.add(sessionId);
      sessionIds.set(org, sessionId);
      await platform.bootstrapPolicy(
        triple({ kind: "identity_account", id: "ida_purge_reader" }, "viewer", {
          kind: "agent",
          id: agentId,
        }),
      );

      const store = server.store;
      const claimHolders: string[] = [];
      for (const kind of STORED_KINDS) {
        const schema: DescMessage | undefined = builtInModel.byKind(kind)?.schema;
        if (schema === undefined) {
          throw new Error(`no schema for ${ApiResourceKind[kind]}`);
        }
        const id = `${ApiResourceKind[kind]}_${slug}`;
        // A run stored here has finished: a server with no engine holds no
        // live run, and the purge needs the engine only for one that may be.
        const finished =
          kind === ApiResourceKind.run
            ? { status: { phase: FINISHED_PHASE } }
            : {};
        const address = `https://mcp.${slug}.example/mcp`;
        const row = create(schema, {
          metadata: { id, name: id, org },
          ...(kind === ApiResourceKind.api_key ? { spec: { boundOrg: org } } : {}),
          ...(kind === ApiResourceKind.oauth_app ? { spec: { addresses: [address] } } : {}),
          ...finished,
        } as never);
        await store.saveResource(kind, id, schema, row as never);
        ids.add(id);
        if (kind === ApiResourceKind.oauth_app) {
          // The login app holds its address as a name claim, as its chain takes it.
          await store.resourceNames.claim(oauthAppAddressKey(org, address), id, new Date().toISOString());
          claimHolders.push(id);
        }
      }
      const now = Math.floor(Date.now() / 1000);
      await store.connectLinks.create({
        tokenHash: `link_${slug}`,
        org,
        vaultId,
        address: `https://mcp.${slug}.example/mcp`,
        returnUrl: "https://app.example.test/back",
        createdBy: "ida_purge_reader",
        createdByClass: "user",
        createdByBoundOrg: "",
        createdAt: now,
        expiresAt: now + 1800,
        usedAt: 0,
      });
      // A connect in flight: its attempt names the organization.
      await store.connectAttempts.create({
        id: `connect-mcp_${slug}-attempt`,
        org,
        createdBy: "ida_purge_reader",
        person: "ida_purge_reader",
        mcpServerId: `mcp_${slug}`,
        runId: "",
        createdAt: now,
        expiresAt: now + 600,
      });
      await store.upsertScheduleFire({
        scheduleId: `schedule_${slug}`,
        org,
        nominalFireTime: new Date().toISOString(),
        origin: "CRON",
        outcome: "",
        reason: "",
        executionId: "",
        recordedAt: new Date().toISOString(),
        completedAt: "",
      });
      await store.pendingOAuthStates.save({
        state: `state_${slug}`,
        codeVerifier: "enc:v1:sealed",
        clientId: "c",
        clientSecret: "",
        tokenEndpoint: "https://example.test/token",
        identityAccountId: "ida_purge_reader",
        authMethod: "mcp_oauth",
        tokenAuthMethod: "",
        redirectUri: "http://127.0.0.1/cb",
        org,
        vaultId: "",
        address: "",
        loginApp: "",
        resource: "",
        clientRegistration: "",
        connectLink: "",
        providerName: "",
        userinfoUrl: "",
        createdAt: Math.floor(Date.now() / 1000),
      });
      return { org, ids, vaultIds: [vaultId, myVaultId], claimHolders };
    }

    async function purged(org: string): Promise<void> {
      held.delete(org);
      await vi.waitFor(
        async () => {
          await server.organizationPurge.runPass();
          expect(await server.store.organizationDeletions.isDeleting(org)).toBe(false);
        },
        { timeout: 10_000 },
      );
    }

    it("leaves no stored row naming the organization or anything it owned, keeps another organization's, and frees its slug", async () => {
      const doomed = await seeded("purge-doomed");
      const kept = await seeded("purge-kept");

      const before = await database().census(dir);
      try {
        const claimed = (await organizationCensus(before.reader, doomed.ids))
          .filter((finding) => finding.table === "resource_names")
          .map((finding) => finding.id);
        expect(
          new Set(claimed),
          "the seed's vaults and login app hold their name claims (the external id's, the My vault's, the address's)",
        ).toEqual(new Set([doomed.org, ...doomed.vaultIds, ...doomed.claimHolders]));
      } finally {
        await before.close();
      }

      held.add(doomed.org);
      await organizations.delete({ value: doomed.org });

      const gone = await grpcError(() =>
        organizationQuery.get({ value: doomed.org }),
      );
      expect(gone.code).toBe(Code.NotFound);
      const refused = await grpcError(() =>
        internalSessions.create({
          apiVersion: API_VERSION,
          kind: "Session",
          metadata: { name: "late", org: doomed.org },
        }),
      );
      expect(refused.code, "server code starts nothing inside it").toBe(Code.NotFound);
      expect(refused.rawMessage).toBe(`Organization not found: ${doomed.org}`);

      await purged(doomed.org);
      expect(
        finished.get(doomed.org),
        "the unit's stage runs in its place and again in the final stage's sweep",
      ).toBe(2);
      expect(
        sessionsRead.get(doomed.org),
        "the stage reads the organization's sessions, and no other's, through its context",
      ).toEqual([sessionIds.get(doomed.org)]);

      const census = await database().census(dir);
      try {
        expect(await organizationCensus(census.reader, doomed.ids)).toEqual([]);
        const keptClaims = (await organizationCensus(census.reader, kept.ids))
          .filter((finding) => finding.table === "resource_names")
          .map((finding) => finding.id);
        expect(
          new Set(keptClaims),
          "another organization's vaults and login app keep their name claims",
        ).toEqual(new Set([kept.org, ...kept.vaultIds, ...kept.claimHolders]));
        const survivors = await organizationCensus(census.reader, kept.ids);
        expect(
          new Set(survivors.map((finding) => finding.id)),
          "another organization keeps everything",
        ).toEqual(kept.ids);
      } finally {
        await census.close();
      }

      const reborn = await organizations.create({
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { name: "purge-doomed", slug: "purge-doomed", org: "" },
      });
      expect(reborn.metadata?.id).not.toBe(doomed.org);
    });
  });
}
