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
 * Its discipline is the library's own chain's: one
 * transaction per version, a version ledger (`ee.schema_version`, seeded
 * at v1), a session advisory lock of its own ("STGMRE" + 0x01, distinct
 * from the OSS chain's "STGMR1" and any host chain's),
 * and a refusal to boot backward: a server must never run against a newer
 * Enterprise schema than it knows.
 *
 * v1 is these tables' first version in this chain, with the names the
 * adapters key on (each unique constraint and index), so an adapter's
 * refusal reads the constraint it expects. v2 added the access move
 * tickets. v3 drops them, with v1's single sign-on column and index:
 * Stigmer has no single sign-on of its own, and an identity provider is
 * trust in another platform's tokens. The two versions stay as written so
 * a database that ran them moves forward instead of sitting ahead of the
 * chain. v4 gives the team and identity provider lists the keyset index
 * invitations page over, `(org, created_at DESC, id COLLATE "C" DESC)`:
 * every list pages by token, newest first with ties in byte order
 * (postgres/keyset.ts), and the team index's default-collation id could not
 * serve that order. v5 renames the identity provider's tables, their
 * indexes and constraints, and the columns that name one, for the kind's
 * new name, federation issuer, and rewrites each issuer row's kind string:
 * a row carries its kind's name in its bytes, which a read returns and an
 * update of a fetched row sends back under the contract's const. v1 to v4
 * keep the old names: they are what a database that ran them holds.
 *
 * A version runs SQL, then, when it has one, its row rewrite, in the same
 * transaction: v5's rows are decoded, which SQL cannot do. A row that does
 * not decode fails the version, naming the row, and the transaction rolls
 * back, the rule the library's own data migrations keep.
 *
 * The tables carry no foreign keys: an organization's rows go with it
 * through the unit's purge stage, and the policy rows that reference a
 * team or a provider live in another domain's store.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { FederationIssuerSchema } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import type { PoolClient } from "pg";

/** Whatever version a database at this build's schema holds. */
export const ENTERPRISE_SCHEMA_VERSION = 5;

/** Advisory lock key for this chain: ASCII "STGMRE" + 0x01. */
export const ENTERPRISE_MIGRATION_LOCK_KEY = 0x5354474d524501n;

/** The chain, exported so static tests read a version's statements without a database. */
export const ENTERPRISE_MIGRATIONS: ReadonlyArray<{
  readonly version: number;
  readonly statements: ReadonlyArray<string>;
  /** Rows the version rewrites after its statements, in its transaction. */
  readonly rewrite?: (client: PoolClient) => Promise<void>;
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
      // reference read, is_sso the login page's discovery (dropped at v3),
      // deleting_since the delete mark (iam/issuer/postgres-store.ts says
      // why each column exists).
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
  {
    version: 2,
    statements: [
      // Access move tickets: a hash of each single-use ticket that moved an
      // account's access in one organization to the account its single
      // sign-on provider signed the same person in as. v3 drops them.
      `CREATE TABLE ee.iam_access_move_tickets (
         token_hash TEXT PRIMARY KEY,
         account_id TEXT NOT NULL,
         org TEXT NOT NULL,
         expires_at TIMESTAMPTZ NOT NULL,
         redeemed_at TIMESTAMPTZ,
         redeemer_id TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX iam_access_move_tickets_org
         ON ee.iam_access_move_tickets (org)`,
      `CREATE INDEX iam_access_move_tickets_expires
         ON ee.iam_access_move_tickets (expires_at)`,
    ],
  },
  {
    version: 3,
    statements: [
      // Single sign-on leaves the platform: the access move's tickets, the
      // one-live-SSO-provider index and the column it read. Dropping the
      // table drops its indexes.
      `DROP TABLE ee.iam_access_move_tickets`,
      `DROP INDEX ee.iam_identity_provider_one_live_sso`,
      `ALTER TABLE ee.iam_identity_provider DROP COLUMN is_sso`,
    ],
  },
  {
    version: 4,
    statements: [
      // The team and provider lists page by token over the same keyset as
      // invitations: newest first, ties broken by id in byte order.
      `DROP INDEX ee.idx_iam_team_org_created`,
      `CREATE INDEX idx_iam_team_org_created
         ON ee.iam_team (org, created_at DESC, id COLLATE "C" DESC)`,
      `CREATE INDEX iam_identity_provider_org_created
         ON ee.iam_identity_provider (org, created_at DESC, id COLLATE "C" DESC)`,
    ],
  },
  {
    version: 5,
    statements: [
      // The identity provider is a federation issuer: its tables, their
      // indexes and constraints, and the columns that name one.
      `ALTER TABLE ee.iam_identity_provider RENAME TO iam_federation_issuer`,
      `ALTER TABLE ee.iam_federation_issuer
         RENAME CONSTRAINT iam_identity_provider_pkey TO iam_federation_issuer_pkey`,
      `ALTER INDEX ee.iam_identity_provider_org_slug RENAME TO iam_federation_issuer_org_slug`,
      `ALTER INDEX ee.iam_identity_provider_org_created RENAME TO iam_federation_issuer_org_created`,
      `ALTER TABLE ee.iam_identity_provider_route RENAME TO iam_federation_issuer_route`,
      `ALTER TABLE ee.iam_federation_issuer_route
         RENAME CONSTRAINT iam_identity_provider_route_pkey TO iam_federation_issuer_route_pkey`,
      `ALTER TABLE ee.iam_federation_issuer_route
         RENAME COLUMN identity_provider_id TO federation_issuer_id`,
      `ALTER INDEX ee.iam_identity_provider_route_provider RENAME TO iam_federation_issuer_route_issuer`,
      `ALTER TABLE ee.iam_sign_in_grants
         RENAME COLUMN identity_provider_id TO federation_issuer_id`,
    ],
    rewrite: renameIssuerKindStrings,
  },
];

/** How many issuer rows v5 decodes per page. */
export const ISSUER_RENAME_PAGE_SIZE = 500;

/**
 * v5's row rewrite: every issuer row whose bytes spell the kind
 * `IdentityProvider` is written back spelling `FederationIssuer`, read in
 * keyset pages on its id in byte order; every other byte is kept, its id
 * (an `idp_` one included) among them.
 */
async function renameIssuerKindStrings(client: PoolClient): Promise<void> {
  for (let after = ""; ; ) {
    const rows = (
      await client.query<{ id: string; data: Buffer }>(
        `SELECT id, data FROM ee.iam_federation_issuer
          WHERE id COLLATE "C" > $1 ORDER BY id COLLATE "C" LIMIT $2`,
        [after, ISSUER_RENAME_PAGE_SIZE],
      )
    ).rows;
    for (const row of rows) {
      let data: Uint8Array | undefined;
      try {
        const issuer = fromBinary(FederationIssuerSchema, new Uint8Array(row.data));
        if (issuer.kind === "IdentityProvider") {
          issuer.kind = "FederationIssuer";
          data = toBinary(FederationIssuerSchema, issuer);
        }
      } catch (error) {
        throw new Error(
          `the federation issuer row ${row.id} cannot be read for the rename of the identity provider: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
      if (data !== undefined) {
        await client.query(`UPDATE ee.iam_federation_issuer SET data = $1 WHERE id = $2`, [Buffer.from(data), row.id]);
      }
    }
    if (rows.length < ISSUER_RENAME_PAGE_SIZE) {
      return;
    }
    after = rows[rows.length - 1]!.id;
  }
}

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
        await migration.rewrite?.(client);
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
