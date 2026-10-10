/**
 * The organization census: after a purge, which stored rows still name an
 * id the organization owned. The proof that deleting an organization
 * removes what it owned is that this answers nothing, except in the tables
 * an edition declares it keeps.
 *
 * Every table the engine's own catalogue lists (`sqlite_master`, Postgres
 * `information_schema`) must be classified here, so a table a later
 * migration adds fails the census until someone says how it names an
 * organization. The classes:
 *
 *   - `org-column`: a column holds the organization's id (`org`, `org_id`);
 *   - `id-as-value`: a column holds an id as a value (a list key's value,
 *     the server's recorded organization);
 *   - `decoded`: rows are protobuf resources; each is decoded with its
 *     kind's schema and every string it holds, at any depth (its
 *     `metadata.org`, every reference), is compared;
 *   - `none`: the table names no organization (the schema's own version);
 *   - `engine`: the search engine's own storage behind `search_index`
 *     (SQLite's FTS5 shadow tables), read through `search_index` itself.
 *
 * Every class but `none` and `engine` is scanned the same way: a row names
 * an id when any text column equals one, or, for `decoded`, when any
 * string inside the decoded resource does. The classes say why a table is
 * there; the scan stays blunt so no column escapes it.
 *
 * Driver-neutral: a driver test hands a `CensusReader` over its own
 * connection (`sqliteCensusReader`, `postgresCensusReader`).
 */
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { fromBinary } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import type { DatabaseSync } from "node:sqlite";
import type { Pool } from "pg";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { builtInModel } from "../../authorization/model/index.js";

export type CensusClass =
  | "org-column"
  | "id-as-value"
  | "decoded"
  | "none"
  | "engine";

/** Every table either driver creates, with how it names an organization. */
export const CENSUS_TABLES: Readonly<Record<string, CensusClass>> = {
  resources: "decoded",
  resource_audit: "decoded",
  resource_list_keys: "id-as-value",
  resource_names: "org-column",
  bootstrap_state: "id-as-value",
  organization_deletions: "org-column",
  search_index: "org-column",
  schedule_runs: "org-column",
  pending_oauth_state: "org-column",
  connect_link: "org-column",
  connect_attempt: "org-column",
  // A registered OAuth client is the login server's, shared by every
  // organization: it names none.
  oauth_client_registration: "none",
  schema_version: "none",
  // SQLite's own bookkeeping and the FTS5 shadow tables behind search_index.
  sqlite_sequence: "none",
  search_index_config: "engine",
  search_index_content: "engine",
  search_index_data: "engine",
  search_index_docsize: "engine",
  search_index_idx: "engine",
};

/** One row that still names an id. */
export interface CensusFinding {
  readonly table: string;
  readonly row: string;
  readonly id: string;
}

/** What the census reads: the catalogue's tables and their rows, columns as the driver returns them. */
export interface CensusReader {
  tables(): Promise<string[]>;
  rows(table: string): Promise<Array<Record<string, unknown>>>;
}

export function sqliteCensusReader(db: DatabaseSync): CensusReader {
  return {
    async tables() {
      return (
        db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
    },
    async rows(table) {
      return db.prepare(`SELECT * FROM "${table}"`).all() as Array<
        Record<string, unknown>
      >;
    },
  };
}

export function postgresCensusReader(pool: Pool, schema = "public"): CensusReader {
  return {
    async tables() {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
        [schema],
      );
      return result.rows.map((row) => row.table_name);
    },
    async rows(table) {
      const result = await pool.query(`SELECT * FROM "${schema}"."${table}"`);
      return result.rows as Array<Record<string, unknown>>;
    },
  };
}

/** The tables the catalogue lists that the census has no class for. */
export async function unclassifiedTables(reader: CensusReader): Promise<string[]> {
  return (await reader.tables())
    .filter((table) => !(table in CENSUS_TABLES))
    .sort();
}

/**
 * Every row that names one of `ids`, in every classified table. Throws when
 * a table is unclassified, or a resource row cannot be decoded (it might
 * name one).
 */
export async function organizationCensus(
  reader: CensusReader,
  ids: ReadonlySet<string>,
): Promise<CensusFinding[]> {
  const unclassified = await unclassifiedTables(reader);
  if (unclassified.length > 0) {
    throw new Error(
      `the census has no class for ${unclassified.join(", ")}: say in organization-census.ts how each names an organization`,
    );
  }
  const findings: CensusFinding[] = [];
  for (const table of (await reader.tables()).sort()) {
    const tableClass = CENSUS_TABLES[table];
    if (tableClass === "none" || tableClass === "engine") {
      continue;
    }
    for (const row of await reader.rows(table)) {
      const label = rowLabel(row);
      for (const value of Object.values(row)) {
        if (typeof value === "string" && ids.has(value)) {
          findings.push({ table, row: label, id: value });
        }
      }
      if (tableClass === "decoded") {
        for (const value of decodedStrings(table, row)) {
          if (ids.has(value)) {
            findings.push({ table, row: label, id: value });
          }
        }
      }
    }
  }
  return dedupe(findings);
}

function rowLabel(row: Record<string, unknown>): string {
  const parts = ["kind", "id", "resource_id", "key", "name", "org"]
    .map((column) => row[column])
    .filter((value): value is string => typeof value === "string" && value !== "");
  return parts.join("/");
}

/** Every string a stored resource holds, at any depth. */
function decodedStrings(table: string, row: Record<string, unknown>): string[] {
  const kindName = row.kind;
  const data = row.data;
  if (typeof kindName !== "string" || !(data instanceof Uint8Array)) {
    throw new Error(`${table}: a row with no kind or data cannot be read`);
  }
  const kind = ApiResourceKind[kindName as keyof typeof ApiResourceKind];
  const schema: DescMessage | undefined =
    typeof kind === "number" ? builtInModel.byKind(kind)?.schema : undefined;
  if (schema === undefined) {
    throw new Error(`${table}: no schema decodes kind '${kindName}'`);
  }
  const out: string[] = [];
  walk(reflect(schema, fromBinary(schema, data) as Message), out);
  return out;
}

function walk(message: ReflectMessage, out: string[]): void {
  for (const field of message.fields) {
    if (!message.isSet(field)) {
      continue;
    }
    switch (field.fieldKind) {
      case "scalar": {
        const value = message.get(field);
        if (typeof value === "string") {
          out.push(value);
        }
        break;
      }
      case "message":
        walk(message.get(field), out);
        break;
      case "list": {
        const list = message.get(field);
        for (let i = 0; i < list.size; i++) {
          const item = list.get(i);
          if (typeof item === "string") {
            out.push(item);
          } else if (field.listKind === "message") {
            walk(item as ReflectMessage, out);
          }
        }
        break;
      }
      case "map":
        for (const [key, value] of message.get(field)) {
          if (typeof key === "string") {
            out.push(key);
          }
          if (typeof value === "string") {
            out.push(value);
          } else if (field.mapKind === "message") {
            walk(value as ReflectMessage, out);
          }
        }
        break;
      case "enum":
        break;
      default: {
        const exhaustive: never = field;
        throw new Error(String(exhaustive));
      }
    }
  }
}

function dedupe(findings: CensusFinding[]): CensusFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.table}|${finding.row}|${finding.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
