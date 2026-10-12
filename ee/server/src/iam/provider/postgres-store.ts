/**
 * The IdentityProvider store's Postgres adapter over `ee.iam_identity_provider`
 * and its adapter-private route side table `ee.iam_identity_provider_route`,
 * both created by the Enterprise schema chain (schema/enterprise-migrations.ts).
 *
 * Shape: an own-kind table: the proto binary is the row's truth, and each
 * lookup column exists for exactly one job:
 *
 *   org, slug    the insert race's backstop; UNIQUE
 *                (`iam_identity_provider_org_slug`). No read uses the
 *                slug: a reference and CheckDuplicate resolve a
 *                provider's name through the library's name table. Its
 *                `org` prefix serves the organization's list and sweep;
 *                the list's newest-first sort runs over the
 *                organization's few rows (an organization keeps a few
 *                providers at most).
 *   org, is_sso  the login page's SSO discovery, and the one-SSO rule:
 *                UNIQUE over the live SSO rows
 *                (`iam_identity_provider_one_live_sso`), so the matrix's
 *                check and a racing write cannot leave an organization two
 *                SSO providers. A provider being deleted is outside it and
 *                leaves the place free.
 *   deleting_since  the delete mark: null while the provider is live. Read
 *                with the row, never on its own, so it has no index.
 *   route        the side table's primary key, the pair (canonical issuer,
 *                audience). Rewritten in the same transaction as the row on
 *                every write, so the handlers' uniqueness check and the
 *                constraint answer from the same rows and can never
 *                disagree.
 *
 * A write names the refusing constraint by its name and answers which claim
 * was taken. A unique violation on any other constraint (the id's primary
 * key included, which the create lane's server-minted ids make
 * unreachable) is not a claim anyone holds; it stays an infrastructure
 * fault. The route table is written only in the provider's own
 * transaction.
 */
import type { Pool, PoolClient } from "pg";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";

import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";

import { inTransaction } from "../../postgres/transaction.js";
import { routesOf, type ProviderRoute } from "./routes.js";
import type {
  IdentityProviderStore,
  ProviderInsertOutcome,
  ProviderReplaceOutcome,
} from "./store.js";

const TABLE = "ee.iam_identity_provider";
const ROUTE_TABLE = "ee.iam_identity_provider_route";

/** The UNIQUE index an organization's slugs are held by. */
const ORG_SLUG_CONSTRAINT = "iam_identity_provider_org_slug";
/** The side table's primary key: a route belongs to one provider. */
const ROUTE_CONSTRAINT = "iam_identity_provider_route_pkey";
/** The UNIQUE partial index an organization's one live SSO provider is held by. */
const ONE_LIVE_SSO_CONSTRAINT = "iam_identity_provider_one_live_sso";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

interface ProviderRow {
  readonly data: Buffer;
}

/** A claim a unique constraint refused, named by the constraint. */
type Claim = "slug" | "sso" | "route";

export function newIdentityProviderStore(pool: Pool): IdentityProviderStore {
  async function query(
    where: string,
    params: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<IdentityProvider>> {
    const result = await pool.query<ProviderRow>(
      `SELECT data FROM ${TABLE} ${where}`,
      [...params],
    );
    return result.rows.map(rowToProvider);
  }

  async function queryOne(
    where: string,
    params: ReadonlyArray<unknown>,
  ): Promise<IdentityProvider | undefined> {
    const rows = await query(`${where} LIMIT 1`, params);
    return rows[0];
  }

  async function providerIdByRoute(issuer: string, audience: string): Promise<string | undefined> {
    const result = await pool.query<{ identity_provider_id: string }>(
      `SELECT identity_provider_id FROM ${ROUTE_TABLE} WHERE issuer = $1 AND audience = $2`,
      [issuer, audience],
    );
    return result.rows[0]?.identity_provider_id;
  }

  return {
    async insert(provider): Promise<ProviderInsertOutcome> {
      const columns = columnsOf(provider);
      return inTransaction<ProviderInsertOutcome>(pool, async (client) => {
        const refused = await claiming(() =>
          client.query(
            `INSERT INTO ${TABLE} (id, data, org, slug, is_sso, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              columns.id,
              payloadOf(provider),
              columns.org,
              columns.slug,
              columns.isSso,
              columns.createdAt,
            ],
          ),
        );
        if (refused === "slug") {
          return { commit: false, value: { kind: "slug-taken" } };
        }
        if (refused === "sso") {
          return { commit: false, value: { kind: "sso-taken" } };
        }
        const taken = await claimRoutes(client, columns.id, columns.routes);
        return taken === undefined
          ? { commit: true, value: { kind: "inserted" } }
          : { commit: false, value: { kind: "route-taken", route: taken } };
      });
    },

    async replace(provider): Promise<ProviderReplaceOutcome> {
      const columns = columnsOf(provider);
      return inTransaction<ProviderReplaceOutcome>(pool, async (client) => {
        const locked = await client.query<ProviderRow>(
          `SELECT data FROM ${TABLE} WHERE id = $1 FOR UPDATE`,
          [columns.id],
        );
        const held = locked.rows[0];
        if (held === undefined) {
          return { commit: false, value: { kind: "missing" } };
        }
        const storedSlug = rowToProvider(held).metadata?.slug;
        if (provider.metadata !== undefined && storedSlug !== undefined) {
          provider.metadata.slug = storedSlug;
        }
        let rowCount = 0;
        const refused = await claiming(async () => {
          const updated = await client.query(
            `UPDATE ${TABLE} SET data = $2, is_sso = $3 WHERE id = $1`,
            [columns.id, payloadOf(provider), columns.isSso],
          );
          rowCount = updated.rowCount ?? 0;
        });
        if (refused === "sso") {
          return { commit: false, value: { kind: "sso-taken" } };
        }
        if (rowCount === 0) {
          return { commit: false, value: { kind: "missing" } };
        }
        await client.query(
          `DELETE FROM ${ROUTE_TABLE} WHERE identity_provider_id = $1`,
          [columns.id],
        );
        const taken = await claimRoutes(client, columns.id, columns.routes);
        return taken === undefined
          ? { commit: true, value: { kind: "replaced" } }
          : { commit: false, value: { kind: "route-taken", route: taken } };
      });
    },

    modifyById(id, modify): Promise<IdentityProvider | undefined> {
      return inTransaction<IdentityProvider | undefined>(pool, async (client) => {
        const locked = await client.query<ProviderRow>(
          `SELECT data FROM ${TABLE} WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const held = locked.rows[0];
        if (held === undefined) {
          return { commit: false, value: undefined };
        }
        const provider = rowToProvider(held);
        const before = columnsOf(provider);
        modify(provider);
        const after = columnsOf(provider);
        refuseClaimChange(before, after);
        await client.query(`UPDATE ${TABLE} SET data = $2, slug = $3 WHERE id = $1`, [
          id,
          payloadOf(provider),
          after.slug,
        ]);
        return { commit: true, value: provider };
      });
    },

    async deleteById(id): Promise<void> {
      await inTransaction(pool, async (client) => {
        await client.query(
          `DELETE FROM ${ROUTE_TABLE} WHERE identity_provider_id = $1`,
          [id],
        );
        await client.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
        return { commit: true, value: undefined };
      });
    },

    findById(id) {
      return queryOne("WHERE id = $1", [id]);
    },

    findByOrg(org) {
      return query("WHERE org = $1 ORDER BY created_at DESC, id DESC", [org]);
    },

    async findIdsByOrg(org): Promise<ReadonlyArray<string>> {
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM ${TABLE} WHERE org = $1`,
        [org],
      );
      return result.rows.map((row) => row.id);
    },

    findSsoProviderByOrg(org) {
      return queryOne("WHERE org = $1 AND is_sso AND deleting_since IS NULL", [org]);
    },

    findProviderIdByRoute(issuer, audience) {
      return providerIdByRoute(issuer, audience);
    },

    findAll() {
      return query("", []);
    },

    findLive() {
      return query("WHERE deleting_since IS NULL", []);
    },

    async markDeleting(id): Promise<void> {
      await pool.query(
        `UPDATE ${TABLE} SET deleting_since = now() WHERE id = $1 AND deleting_since IS NULL`,
        [id],
      );
    },

    async isLive(id): Promise<boolean> {
      const result = await pool.query(
        `SELECT 1 FROM ${TABLE} WHERE id = $1 AND deleting_since IS NULL`,
        [id],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}

/**
 * Claims each route for the provider, in order; the first one another
 * provider holds is the answer, and the caller rolls the whole write back.
 */
async function claimRoutes(
  client: PoolClient,
  id: string,
  routes: ReadonlyArray<ProviderRoute>,
): Promise<ProviderRoute | undefined> {
  for (const route of routes) {
    const refused = await claiming(() =>
      client.query(
        `INSERT INTO ${ROUTE_TABLE} (issuer, audience, identity_provider_id) VALUES ($1, $2, $3)`,
        [route.issuer, route.audience, id],
      ),
    );
    if (refused === "route") {
      return route;
    }
  }
  return undefined;
}

/**
 * Runs one statement and answers the claim a unique constraint refused,
 * or undefined when it succeeded. Any other failure, a unique violation on
 * a constraint that holds no claim included, is rethrown as it came.
 */
async function claiming(statement: () => Promise<unknown>): Promise<Claim | undefined> {
  try {
    await statement();
    return undefined;
  } catch (error) {
    const claim = claimOf(error);
    if (claim === undefined) {
      throw error;
    }
    return claim;
  }
}

function claimOf(error: unknown): Claim | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  if (code !== UNIQUE_VIOLATION) {
    return undefined;
  }
  switch (constraint) {
    case ORG_SLUG_CONSTRAINT:
      return "slug";
    case ONE_LIVE_SSO_CONSTRAINT:
      return "sso";
    case ROUTE_CONSTRAINT:
      return "route";
    default:
      return undefined;
  }
}

/**
 * Refuses a `modifyById` that moved what only `replace` may: the
 * organization, the SSO flag or a route claim.
 */
function refuseClaimChange(before: ProviderColumns, after: ProviderColumns): void {
  const routeKey = (routes: ReadonlyArray<ProviderRoute>) =>
    routes.map((route) => `${route.issuer}\u0000${route.audience}`).sort().join("\u0001");
  if (
    before.org !== after.org ||
    before.isSso !== after.isSso ||
    routeKey(before.routes) !== routeKey(after.routes)
  ) {
    throw new Error(
      "modifyById changes a provider's payload and slug alone; its organization, SSO flag and routes change through replace",
    );
  }
}

/** The single column-to-proto correspondence. */
function rowToProvider(row: ProviderRow): IdentityProvider {
  return fromBinary(IdentityProviderSchema, new Uint8Array(row.data));
}

function payloadOf(provider: IdentityProvider): Buffer {
  return Buffer.from(toBinary(IdentityProviderSchema, provider));
}

interface ProviderColumns {
  readonly id: string;
  readonly org: string;
  readonly slug: string;
  readonly isSso: boolean;
  readonly createdAt: Date;
  readonly routes: ReadonlyArray<ProviderRoute>;
}

/**
 * The lookup columns, read from the shaped envelope the chains produced
 * (BuildNewState minted the id and stamped the audit; ResolveSlug derived
 * the slug; the request named the organization). A missing one is a
 * programming error, not bad input, and throws as such.
 */
function columnsOf(provider: IdentityProvider): ProviderColumns {
  const id = provider.metadata?.id ?? "";
  const org = provider.metadata?.org ?? "";
  const slug = provider.metadata?.slug ?? "";
  const createdAt = provider.status?.audit?.specAudit?.createdAt;
  if (id === "" || org === "" || slug === "" || createdAt === undefined) {
    throw new Error(
      "a provider reaches the store fully shaped: id, organization, slug and audit are all set by its chain",
    );
  }
  return {
    id,
    org,
    slug,
    isSso: provider.spec?.isSsoProvider === true,
    createdAt: timestampDate(createdAt),
    routes: routesOf(provider),
  };
}
