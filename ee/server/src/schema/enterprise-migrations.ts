/**
 * The Enterprise schema chain: the tables the identity unit's stores keep
 * (identity providers and their routes, teams, invitations, the sign-in
 * grant ledger), in their own Postgres schema `ee`, beside the OSS store's
 * `public` tables and any host's own schema in one database.
 *
 * It runs from the unit's own `start`, first (extension/enterprise-identity.ts,
 * `schema.ensure`), so every host that composes the unit gets its tables
 * without database code of its own: a multi-tenant host and a self-hosted
 * Enterprise server alike. A failure fails `start`, so a server whose
 * tables are not there never listens.
 *
 * Its discipline is the library's own chain's: one
 * transaction per version, a version ledger (`ee.schema_version`, seeded
 * at v1), a session advisory lock of its own ("STGMRE" + 0x01, distinct
 * from the OSS chain's "STGMR1" and any host chain's),
 * and a refusal to boot backward: a server must never run against a newer
 * Enterprise schema than it knows.
 *
 * v1 is these tables' first version in this chain, with the names the
 * adapters key on (each unique constraint and index), so an adapter's
 * refusal reads the constraint it expects.
 *
 * The tables carry no foreign keys: an organization's rows go with it
 * through the unit's purge stage, and the policy rows that reference a
 * team or a provider live in another domain's store.
 */
import type { PoolClient } from "pg";

/** Whatever version a database at this build's schema holds. */
export const ENTERPRISE_SCHEMA_VERSION = 1;

/** Advisory lock key for this chain: ASCII "STGMRE" + 0x01. */
export const ENTERPRISE_MIGRATION_LOCK_KEY = 0x5354474d524501n;

/** The chain, exported so static tests read a version's statements without a database. */
export const ENTERPRISE_MIGRATIONS: ReadonlyArray<{
  readonly version: number;
  readonly statements: ReadonlyArray<string>;
}> = [
  {
    version: 1,
    statements: [
      `CREATE SCHEMA IF NOT EXISTS ee`,
      `CREATE TABLE ee.schema_version (
         version INTEGER NOT NULL
       )`,
      `INSERT INTO ee.schema_version (version) VALUES (1)`,
      // Identity providers: the payload is the truth; org and slug are the
      // reference read, is_sso the login page's discovery, deleting_since
      // the delete mark (iam/provider/postgres-store.ts says why each
      // column exists).
      `CREATE TABLE ee.iam_identity_provider (
         id TEXT PRIMARY KEY,
         data BYTEA NOT NULL,
         org TEXT NOT NULL,
         slug TEXT NOT NULL,
         is_sso BOOLEAN NOT NULL DEFAULT FALSE,
         created_at TIMESTAMPTZ NOT NULL,
         deleting_since TIMESTAMPTZ
       )`,
      `CREATE UNIQUE INDEX iam_identity_provider_org_slug
         ON ee.iam_identity_provider (org, slug)`,
      // One live SSO provider per organization; a provider being deleted
      // leaves the place free.
      `CREATE UNIQUE INDEX iam_identity_provider_one_live_sso
         ON ee.iam_identity_provider (org)
         WHERE is_sso AND deleting_since IS NULL`,
      // One provider per (issuer, audience) route across the server,
      // rewritten in the provider's own transaction on every write.
      `CREATE TABLE ee.iam_identity_provider_route (
         issuer TEXT NOT NULL,
         audience TEXT NOT NULL,
         identity_provider_id TEXT NOT NULL,
         CONSTRAINT iam_identity_provider_route_pkey PRIMARY KEY (issuer, audience)
       )`,
      `CREATE INDEX iam_identity_provider_route_provider
         ON ee.iam_identity_provider_route (identity_provider_id)`,
      // Teams: the slug is unique per organization; the list reads newest
      // first.
      `CREATE TABLE ee.iam_team (
         id TEXT PRIMARY KEY,
         data BYTEA NOT NULL,
         org TEXT NOT NULL,
         slug TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL
       )`,
      `CREATE UNIQUE INDEX uq_iam_team_org_slug
         ON ee.iam_team (org, slug)`,
      `CREATE INDEX idx_iam_team_org_created
         ON ee.iam_team (org, created_at DESC, id DESC)`,
      // Invitations: the token is the shareable credential the redemption
      // resolves by; the list pages newest first with ids in byte order.
      `CREATE TABLE ee.iam_invitation (
         id TEXT PRIMARY KEY,
         data BYTEA NOT NULL,
         org TEXT NOT NULL,
         token TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL
       )`,
      `CREATE UNIQUE INDEX iam_invitation_token
         ON ee.iam_invitation (token)`,
      `CREATE INDEX iam_invitation_org_created
         ON ee.iam_invitation (org, created_at DESC, id COLLATE "C" DESC)`,
      // The first sign-in of each (account, organization) through a
      // provider; the purge removes an organization's rows by org.
      `CREATE TABLE ee.iam_sign_in_grants (
         account_id TEXT NOT NULL,
         org TEXT NOT NULL,
         identity_provider_id TEXT NOT NULL,
         first_signed_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (account_id, org)
       )`,
      `CREATE INDEX iam_sign_in_grants_org
         ON ee.iam_sign_in_grants (org)`,
    ],
  },
];

/** How far {@link runEnterpriseMigrations} goes. */
export interface EnterpriseMigrationOptions {
  /** The last version to apply; every version when absent. Only a test passes it. */
  readonly through?: number | undefined;
}

/**
 * Applies every pending version in order, serialized across servers by the
 * advisory lock (session-scoped: the caller supplies a dedicated client,
 * and the lock releases in the finally). A database ahead of this build
 * refuses the boot.
 */
export async function runEnterpriseMigrations(
  client: PoolClient,
  options: EnterpriseMigrationOptions = {},
): Promise<void> {
  const through = options.through ?? ENTERPRISE_SCHEMA_VERSION;
  await client.query("SELECT pg_advisory_lock($1)", [ENTERPRISE_MIGRATION_LOCK_KEY]);
  try {
    const current = await currentVersion(client);
    if (current > ENTERPRISE_SCHEMA_VERSION) {
      throw new Error(
        `Enterprise schema is at v${current}, newer than this build's v${ENTERPRISE_SCHEMA_VERSION}; refusing to boot backward`,
      );
    }
    for (const migration of ENTERPRISE_MIGRATIONS) {
      if (migration.version <= current || migration.version > through) {
        continue;
      }
      await client.query("BEGIN");
      try {
        for (const statement of migration.statements) {
          await client.query(statement);
        }
        await client.query("UPDATE ee.schema_version SET version = $1", [migration.version]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ENTERPRISE_MIGRATION_LOCK_KEY]);
  }
}

/** 0 when the chain has never run (no `ee.schema_version` yet). */
async function currentVersion(client: PoolClient): Promise<number> {
  const exists = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'ee' AND table_name = 'schema_version'`,
  );
  if (exists.rowCount === 0) {
    return 0;
  }
  const result = await client.query<{ version: number }>("SELECT version FROM ee.schema_version");
  return result.rows[0]?.version ?? 0;
}
