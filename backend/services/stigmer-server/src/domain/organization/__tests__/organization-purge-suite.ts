/**
 * The organization purge's proof through a composed server, shared by the
 * SQLite and Postgres entries (organization-purge.test.ts,
 * organization-purge.postgres.test.ts): an organization holding a row of
 * every kind it can own and a record in every side table, deleted, then
 * purged; afterwards no stored row names its id or any id it owned
 * (store/__tests__/organization-census.ts), and its slug can be taken.
 *
 * The seed. The kinds a trusted-local server creates without an engine go
 * through their RPCs (an agent and its version archive, a share of it, an
 * environment holding a sealed secret, a session), so the purge meets rows
 * as their own chains wrote them; every other kind the core purges is
 * stored directly with the organization in `metadata.org` (an API key with
 * it in `spec.bound_org`), with the side-table records a run or a schedule
 * leaves (the fire ledger, a signal hold, a workflow run's events, an OAuth
 * grant and a pending OAuth state), and an access row on the agent. A
 * second organization holds the same shapes and must keep all of them.
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
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
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

const API_VERSION = "agentic.stigmer.ai/v1";

/** RUN_COMPLETED, the same number in both execution kinds' phase enums. */
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
    kind !== ApiResourceKind.environment &&
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
    let environments: Client<typeof EnvironmentCommandController>;
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
      environments = createClient(EnvironmentCommandController, transport);
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
    async function seeded(slug: string): Promise<{ org: string; ids: Set<string> }> {
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
      const environment = await environments.create({
        apiVersion: API_VERSION,
        kind: "Environment",
        metadata: { name: `${slug}-env`, org },
        spec: { data: { TOKEN: { value: "s3cr3t", isSecret: true } } },
      });
      ids.add(environment.metadata?.id ?? "");
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
      for (const kind of STORED_KINDS) {
        const schema: DescMessage | undefined = builtInModel.byKind(kind)?.schema;
        if (schema === undefined) {
          throw new Error(`no schema for ${ApiResourceKind[kind]}`);
        }
        const id = `${ApiResourceKind[kind]}_${slug}`;
        // A run stored here has finished: a server with no engine holds no
        // live run, and the purge needs the engine only for one that may be.
        const finished =
          kind === ApiResourceKind.agent_run ||
          kind === ApiResourceKind.workflow_run
            ? { status: { phase: FINISHED_PHASE } }
            : {};
        const row = create(schema, {
          metadata: { id, name: id, org },
          ...(kind === ApiResourceKind.api_key ? { spec: { boundOrg: org } } : {}),
          ...finished,
        } as never);
        await store.saveResource(kind, id, schema, row as never);
        ids.add(id);
      }
      const workflowRun = `workflow_execution_${slug}`;
      await store.appendWorkflowExecutionEvents(workflowRun, [
        {
          executionId: workflowRun,
          sequenceNumber: 1,
          eventType: "task_started",
          taskName: "t",
          data: new Uint8Array([1]),
          createdAt: "",
        },
      ]);
      await store.upsertScheduleRun({
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
      await store.signalDedupe.claim(org, "key", workflowRun, "resume", 60_000);
      await store.oauthGrants.upsert({
        identityAccountId: "ida_purge_reader",
        resourceId: `mcp_server_${slug}`,
        resourceKind: "mcp_server",
        orgId: org,
        accessTokenExpiresAt: 0,
        clientId: "c",
        authMethod: "mcp_oauth",
        tokenEndpoint: "https://example.test/token",
        accessTokenEnvVar: "TOKEN",
        refreshTokenEnvVar: "",
        environmentId: "",
        createdAt: 0,
        updatedAt: 0,
      });
      await store.pendingOAuthStates.save({
        state: `state_${slug}`,
        codeVerifier: "enc:v1:sealed",
        clientId: "c",
        clientSecret: "",
        tokenEndpoint: "https://example.test/token",
        mcpServerId: `mcp_server_${slug}`,
        identityAccountId: "ida_purge_reader",
        targetEnvVar: "TOKEN",
        authMethod: "mcp_oauth",
        tokenAuthMethod: "",
        redirectUri: "http://127.0.0.1/cb",
        org,
        createdAt: Math.floor(Date.now() / 1000),
      });
      return { org, ids };
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
