/**
 * The FederationIssuer store's Postgres adapter over `ee.iam_federation_issuer`
 * and its adapter-private route side table `ee.iam_federation_issuer_route`,
 * both created by the Enterprise schema chain (schema/enterprise-migrations.ts).
 *
 * Shape: an own-kind table: the proto binary is the row's truth, and each
 * lookup column exists for exactly one job:
 *
 *   org, slug    the insert race's backstop; UNIQUE
 *                (`iam_federation_issuer_org_slug`). No read uses the
 *                slug: a reference and CheckDuplicate resolve a
 *                provider's name through the library's name table. Its
 *                `org` prefix serves the organization's sweep.
 *   org,         the organization's list, newest first like every list,
 *   created_at   over the `(org, created_at DESC, id COLLATE "C" DESC)`
 *                index through the shared keyset source
 *                (postgres/keyset.ts).
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

import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerSchema } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";

import type { GuardedRead } from "@stigmer/server";
import { stampEtag } from "@stigmer/server";

import { pageOrgRows } from "../../postgres/keyset.js";
import { inTransaction } from "../../postgres/transaction.js";
import { routesOf, type IssuerRoute } from "./routes.js";
import type {
  FederationIssuerStore,
  IssuerInsertOutcome,
  IssuerSwapOutcome,
} from "./store.js";

const TABLE = "ee.iam_federation_issuer";
const ROUTE_TABLE = "ee.iam_federation_issuer_route";

/** The UNIQUE index an organization's slugs are held by. */
const ORG_SLUG_CONSTRAINT = "iam_federation_issuer_org_slug";
/** The side table's primary key: a route belongs to one provider. */
const ROUTE_CONSTRAINT = "iam_federation_issuer_route_pkey";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

interface IssuerRow {
  readonly data: Buffer;
}

/** A claim a unique constraint refused, named by the constraint. */
type Claim = "slug" | "route";

export function newFederationIssuerStore(pool: Pool): FederationIssuerStore {
  async function query(
    where: string,
    params: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<FederationIssuer>> {
    const result = await pool.query<IssuerRow>(
      `SELECT data FROM ${TABLE} ${where}`,
      [...params],
    );
    return result.rows.map(rowToIssuer);
  }

  async function queryOne(
    where: string,
    params: ReadonlyArray<unknown>,
  ): Promise<FederationIssuer | undefined> {
    const rows = await query(`${where} LIMIT 1`, params);
    return rows[0];
  }

  async function providerIdByRoute(issuer: string, audience: string): Promise<string | undefined> {
    const result = await pool.query<{ federation_issuer_id: string }>(
      `SELECT federation_issuer_id FROM ${ROUTE_TABLE} WHERE issuer = $1 AND audience = $2`,
      [issuer, audience],
    );
    return result.rows[0]?.federation_issuer_id;
  }

  return {
    async insert(provider): Promise<IssuerInsertOutcome> {
      const columns = columnsOf(provider);
      return inTransaction<IssuerInsertOutcome>(pool, async (client) => {
        const refused = await claiming(() =>
          client.query(
            `INSERT INTO ${TABLE} (id, data, org, slug, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [columns.id, payloadOf(provider), columns.org, columns.slug, columns.createdAt],
          ),
        );
        if (refused === "slug") {
          return { commit: false, value: { kind: "slug-taken" } };
        }
        const taken = await claimRoutes(client, columns.id, columns.routes);
        return taken === undefined
          ? { commit: true, value: { kind: "inserted" } }
          : { commit: false, value: { kind: "route-taken", route: taken } };
      });
    },

    async readForWrite(id): Promise<GuardedRead<FederationIssuer> | undefined> {
      const result = await pool.query<IssuerRow>(
        `SELECT data FROM ${TABLE} WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : { row: rowToIssuer(row), bytes: new Uint8Array(row.data) };
    },

    async swap(id, expectedBytes, provider): Promise<IssuerSwapOutcome> {
      const columns = columnsOf(provider);
      return inTransaction<IssuerSwapOutcome>(pool, async (client) => {
        const locked = await client.query<IssuerRow>(
          `SELECT data FROM ${TABLE} WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const held = locked.rows[0];
        if (held === undefined || !held.data.equals(Buffer.from(expectedBytes))) {
          return { commit: false, value: { kind: "changed" } };
        }
        refuseSlugChange(rowToIssuer(held), provider);
        // The row is locked and held, so the UPDATE writes it.
        await client.query(`UPDATE ${TABLE} SET data = $2 WHERE id = $1`, [id, payloadOf(provider)]);
        await client.query(
          `DELETE FROM ${ROUTE_TABLE} WHERE federation_issuer_id = $1`,
          [id],
        );
        const taken = await claimRoutes(client, id, columns.routes);
        return taken === undefined
          ? { commit: true, value: { kind: "replaced" } }
          : { commit: false, value: { kind: "route-taken", route: taken } };
      });
    },

    modifyById(id, modify): Promise<FederationIssuer | undefined> {
      return inTransaction<FederationIssuer | undefined>(pool, async (client) => {
        const locked = await client.query<IssuerRow>(
          `SELECT data FROM ${TABLE} WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const held = locked.rows[0];
        if (held === undefined) {
          return { commit: false, value: undefined };
        }
        const provider = rowToIssuer(held);
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
          `DELETE FROM ${ROUTE_TABLE} WHERE federation_issuer_id = $1`,
          [id],
        );
        await client.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
        return { commit: true, value: undefined };
      });
    },

    findById(id) {
      return queryOne("WHERE id = $1", [id]);
    },

    pageByOrg(org, after, limit) {
      return pageOrgRows(pool, { table: TABLE, org, after, limit });
    },

    async findIdsByOrg(org): Promise<ReadonlyArray<string>> {
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM ${TABLE} WHERE org = $1`,
        [org],
      );
      return result.rows.map((row) => row.id);
    },

    findIssuerIdByRoute(issuer, audience) {
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
  routes: ReadonlyArray<IssuerRoute>,
): Promise<IssuerRoute | undefined> {
  for (const route of routes) {
    const refused = await claiming(() =>
      client.query(
        `INSERT INTO ${ROUTE_TABLE} (issuer, audience, federation_issuer_id) VALUES ($1, $2, $3)`,
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
    case ROUTE_CONSTRAINT:
      return "route";
    default:
      return undefined;
  }
}

/**
 * Refuses a swap that moves the slug: the slug column is rename's
 * (`modifyById`), and a swap writes the payload only, so a payload naming
 * another slug would disagree with the column every name read trusts.
 */
function refuseSlugChange(held: FederationIssuer, next: FederationIssuer): void {
  if ((held.metadata?.slug ?? "") !== (next.metadata?.slug ?? "")) {
    throw new Error("a swap keeps a provider's slug; a rename changes it");
  }
}

/**
 * Refuses a `modifyById` that moved what only `swap` may: the
 * organization or a route claim.
 */
function refuseClaimChange(before: IssuerColumns, after: IssuerColumns): void {
  const routeKey = (routes: ReadonlyArray<IssuerRoute>) =>
    routes.map((route) => `${route.issuer}\u0000${route.audience}`).sort().join("\u0001");
  if (
    before.org !== after.org ||
    routeKey(before.routes) !== routeKey(after.routes)
  ) {
    throw new Error(
      "modifyById changes a provider's payload and slug alone; its organization and routes change through an update",
    );
  }
}

/** The single column-to-proto correspondence. */
function rowToIssuer(row: IssuerRow): FederationIssuer {
  return fromBinary(FederationIssuerSchema, new Uint8Array(row.data));
}

/** A provider's stored bytes, stamped with its etag first, as every store write is (`@stigmer/server`'s store/etag.ts). */
function payloadOf(provider: FederationIssuer): Buffer {
  stampEtag(FederationIssuerSchema, provider);
  return Buffer.from(toBinary(FederationIssuerSchema, provider));
}

interface IssuerColumns {
  readonly id: string;
  readonly org: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly routes: ReadonlyArray<IssuerRoute>;
}

/**
 * The lookup columns, read from the shaped envelope the chains produced
 * (BuildNewState minted the id and stamped the audit; ResolveSlug derived
 * the slug; the request named the organization). A missing one is a
 * programming error, not bad input, and throws as such.
 */
function columnsOf(provider: FederationIssuer): IssuerColumns {
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
    createdAt: timestampDate(createdAt),
    routes: routesOf(provider),
  };
}
