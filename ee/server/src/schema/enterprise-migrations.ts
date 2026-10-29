/**
 * The Enterprise schema chain: the tables the identity unit's stores keep
 * (federation issuers and their routes, teams, invitations, the sign-in
 * grant ledger), in their own Postgres schema `ee`, beside the OSS store's
 * `public` tables and any host's own schema in one database.
 *
 * It runs from the unit's own `start`, first (extension/enterprise-identity.ts,
 * `schema.ensure`), so every host that composes the unit gets its tables
 * without database code of its own: a multi-tenant host and a self-hosted
 * Enterprise server alike. A failure fails `start`, so a server whose
 * tables are not there never listens.
 *
 * The runner is the library's (`runSchemaChain`, `@stigmer/server`): one
 * transaction per version, the ledger `ee.schema_version` with each step's
 * digest, a session advisory lock of the chain's own ("STGMRE" + 0x01), and
 * a refusal to boot backward or against a changed step. v1 is the schema
 * 0.1.0 starts from; each later version is a new step, and a merged step
 * never changes (the server's store README, "Schema migrations").
 * `schema.snapshot.sql` beside this file is what the chain leaves on a fresh
 * database, and `migrations.sum` holds each step's digest.
 *
 * Constraint and index names are the ones the adapters key their typed
 * outcomes on (each unique index), so an adapter's refusal reads the name
 * it expects. The tables carry no foreign keys: an organization's rows go
 * with it through the unit's purge stage, and the policy rows that
 * reference a team or an issuer live in another domain's store.
 */
import { runSchemaChain } from "@stigmer/server";
import type { PostgresSchemaMigration } from "@stigmer/server";
import type { PoolClient } from "pg";

/** The schema this chain owns. */
export const ENTERPRISE_SCHEMA = "ee";

/** Advisory lock key for this chain: ASCII "STGMRE" + 0x01. */
export const ENTERPRISE_MIGRATION_LOCK_KEY = 0x5354474d524501n;

/** The chain, exported so the sum test and the snapshot script read it without a database. */
export const ENTERPRISE_MIGRATIONS: ReadonlyArray<PostgresSchemaMigration> = [
  {
    version: 1,
    statements: [
      // Federation issuers: the payload is the truth; org and slug are the
      // reference read, deleting_since the delete mark
      // (iam/issuer/postgres-store.ts says why each column exists). The
      // list pages newest first with ids in byte order.
      `CREATE TABLE ee.iam_federation_issuer (
         id TEXT PRIMARY KEY,
         data BYTEA NOT NULL,
         org TEXT NOT NULL,
         slug TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL,
         deleting_since TIMESTAMPTZ
       )`,
      `CREATE INDEX iam_federation_issuer_org_created
         ON ee.iam_federation_issuer (org, created_at DESC, id COLLATE "C" DESC)`,
      `CREATE UNIQUE INDEX iam_federation_issuer_org_slug
         ON ee.iam_federation_issuer (org, slug)`,
      // One issuer per (issuer, audience) route across the server,
      // rewritten in the issuer's own transaction on every write.
      `CREATE TABLE ee.iam_federation_issuer_route (
         issuer TEXT NOT NULL,
         audience TEXT NOT NULL,
         federation_issuer_id TEXT NOT NULL,
         CONSTRAINT iam_federation_issuer_route_pkey PRIMARY KEY (issuer, audience)
       )`,
      `CREATE INDEX iam_federation_issuer_route_issuer
         ON ee.iam_federation_issuer_route (federation_issuer_id)`,
      // Teams: the slug is unique per organization; the list pages newest
      // first with ids in byte order.
      `CREATE TABLE ee.iam_team (
         id TEXT PRIMARY KEY,
         data BYTEA NOT NULL,
         org TEXT NOT NULL,
         slug TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL
       )`,
      `CREATE INDEX idx_iam_team_org_created
         ON ee.iam_team (org, created_at DESC, id COLLATE "C" DESC)`,
      `CREATE UNIQUE INDEX uq_iam_team_org_slug
         ON ee.iam_team (org, slug)`,
      // Invitations: the token is the shareable credential the redemption
      // resolves by; the list pages newest first with ids in byte order.
      `CREATE TABLE ee.iam_invitation (
         id TEXT PRIMARY KEY,
         data BYTEA NOT NULL,
         org TEXT NOT NULL,
         token TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL
       )`,
      `CREATE INDEX iam_invitation_org_created
         ON ee.iam_invitation (org, created_at DESC, id COLLATE "C" DESC)`,
      `CREATE UNIQUE INDEX iam_invitation_token
         ON ee.iam_invitation (token)`,
      // The first sign-in of each (account, organization) through an
      // issuer; the purge removes an organization's rows by org.
      `CREATE TABLE ee.iam_sign_in_grants (
         account_id TEXT NOT NULL,
         org TEXT NOT NULL,
         federation_issuer_id TEXT NOT NULL,
         first_signed_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (account_id, org)
       )`,
      `CREATE INDEX iam_sign_in_grants_org
         ON ee.iam_sign_in_grants (org)`,
    ],
  },
];

/** Whatever version a database at this build's schema holds. */
export const ENTERPRISE_SCHEMA_VERSION = ENTERPRISE_MIGRATIONS.length;

/** How far {@link runEnterpriseMigrations} goes. */
export interface EnterpriseMigrationOptions {
  /** The last version to apply; every version when absent. Only a test passes it. */
  readonly through?: number | undefined;
}

/**
 * Brings the `ee` schema up to date on a dedicated client (the advisory
 * lock is session-scoped, and releases in the runner's finally).
 */
export async function runEnterpriseMigrations(
  client: PoolClient,
  options: EnterpriseMigrationOptions = {},
): Promise<void> {
  await runSchemaChain(client, {
    schema: ENTERPRISE_SCHEMA,
    lockKey: ENTERPRISE_MIGRATION_LOCK_KEY,
    migrations: ENTERPRISE_MIGRATIONS,
    through: options.through,
  });
}
