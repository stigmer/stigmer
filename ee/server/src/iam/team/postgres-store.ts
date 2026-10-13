/**
 * The Team store's Postgres adapter over `ee.iam_team`, which the
 * Enterprise schema chain creates (schema/enterprise-migrations.ts).
 *
 * Shape: an own-kind table: the proto binary is the row's truth
 * (`rowToTeam` is the one correspondence), and each lookup column exists
 * for exactly one job:
 *
 *   org, slug    the insert race's backstop; UNIQUE. No read uses it: a
 *                reference and CheckDuplicate resolve a team's name
 *                through the library's name table
 *   org,         the organization's list, newest first like every list,
 *   created_at   and the organization delete's sweep
 *
 * A slug changes only through `modifyById` (the rename chain's write),
 * which writes the payload and the slug column together under the row's
 * lock. The update's `swap` is one UPDATE compared on the payload bytes
 * `readForWrite` answered, writing the payload and the slug column
 * together, so a rename in between makes it lose.
 *
 * A slug collision is `uq_iam_team_org_slug` refusing the insert. The
 * insert names the refusing constraint: a unique violation on any other
 * (the id's primary key, which the create chain's server-minted ids make
 * unreachable) is not a taken slug, and stays an infrastructure fault.
 */
import type { Pool } from "pg";

import { inTransaction } from "../../postgres/transaction.js";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";

import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";

import type { GuardedRead } from "@stigmer/server";

import type { TeamInsertOutcome, TeamStore } from "./store.js";

const TABLE = "ee.iam_team";

/** The UNIQUE constraint an organization's slugs are held by. */
const ORG_SLUG_CONSTRAINT = "uq_iam_team_org_slug";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

interface TeamRow {
  readonly data: Buffer;
}

export function newTeamStore(pool: Pool): TeamStore {
  async function query(
    where: string,
    params: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<Team>> {
    const result = await pool.query<TeamRow>(
      `SELECT data FROM ${TABLE} ${where}`,
      [...params],
    );
    return result.rows.map(rowToTeam);
  }

  return {
    async insert(team): Promise<TeamInsertOutcome> {
      const columns = columnsOf(team);
      try {
        await pool.query(
          `INSERT INTO ${TABLE} (id, data, org, slug, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            columns.id,
            Buffer.from(toBinary(TeamSchema, team)),
            columns.org,
            columns.slug,
            columns.createdAt,
          ],
        );
        return { kind: "inserted" };
      } catch (error) {
        if (isOrgSlugViolation(error)) {
          return { kind: "slug-taken" };
        }
        throw error;
      }
    },

    async readForWrite(id): Promise<GuardedRead<Team> | undefined> {
      const result = await pool.query<TeamRow>(
        `SELECT data FROM ${TABLE} WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : { row: rowToTeam(row), bytes: row.data };
    },

    async swap(id, expectedBytes, next): Promise<boolean> {
      const result = await pool.query(
        `UPDATE ${TABLE} SET data = $3, slug = $4 WHERE id = $1 AND data = $2`,
        [
          id,
          Buffer.from(expectedBytes),
          Buffer.from(toBinary(TeamSchema, next)),
          columnsOf(next).slug,
        ],
      );
      return result.rowCount === 1;
    },

    modifyById(id, modify): Promise<Team | undefined> {
      return inTransaction(pool, async (client) => {
        const locked = await client.query<TeamRow>(
          `SELECT data FROM ${TABLE} WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = locked.rows[0];
        if (row === undefined) {
          return { commit: false, value: undefined };
        }
        const team = rowToTeam(row);
        modify(team);
        await client.query(`UPDATE ${TABLE} SET data = $2, slug = $3 WHERE id = $1`, [
          id,
          Buffer.from(toBinary(TeamSchema, team)),
          columnsOf(team).slug,
        ]);
        return { commit: true, value: team };
      });
    },

    async findById(id): Promise<Team | undefined> {
      const rows = await query("WHERE id = $1", [id]);
      return rows[0];
    },

    async findByIds(ids): Promise<ReadonlyArray<Team>> {
      if (ids.length === 0) {
        return [];
      }
      return query("WHERE id = ANY($1)", [[...ids]]);
    },

    listByOrg(org): Promise<ReadonlyArray<Team>> {
      return query("WHERE org = $1 ORDER BY created_at DESC, id DESC", [org]);
    },

    async findIdsByOrg(org): Promise<ReadonlyArray<string>> {
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM ${TABLE} WHERE org = $1`,
        [org],
      );
      return result.rows.map((row) => row.id);
    },

    findAll(): Promise<ReadonlyArray<Team>> {
      return query("ORDER BY created_at, id", []);
    },

    async deleteById(id): Promise<void> {
      await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
    },
  };
}

/** The single column-to-proto correspondence. */
function rowToTeam(row: TeamRow): Team {
  return fromBinary(TeamSchema, new Uint8Array(row.data));
}

interface TeamColumns {
  readonly id: string;
  readonly org: string;
  readonly slug: string;
  readonly createdAt: Date;
}

/**
 * The lookup columns, read from the shaped envelope the create chain
 * produced (BuildNewState minted the id and stamped the audit; ResolveSlug
 * derived the slug; the request named the organization). A missing one is
 * a programming error, not bad input, and throws as such.
 */
function columnsOf(team: Team): TeamColumns {
  const id = team.metadata?.id ?? "";
  const org = team.metadata?.org ?? "";
  const slug = team.metadata?.slug ?? "";
  const createdAt = team.status?.audit?.specAudit?.createdAt;
  if (id === "" || org === "" || slug === "" || createdAt === undefined) {
    throw new Error(
      "a team reaches the store fully shaped: id, organization, slug and audit are all set by the create chain",
    );
  }
  return { id, org, slug, createdAt: timestampDate(createdAt) };
}

/** Only the org-slug constraint is a taken slug; any other violation is a fault. */
function isOrgSlugViolation(error: unknown): boolean {
  const { code, constraint } = (error ?? {}) as { code?: unknown; constraint?: unknown };
  return code === UNIQUE_VIOLATION && constraint === ORG_SLUG_CONSTRAINT;
}
