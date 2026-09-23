/**
 * The list index: what a store keeps beside a row so a list lane can read
 * one organization's or one parent's rows in creation order without
 * decoding the whole kind. Every list lane used to call `listResources`
 * and filter in memory, and the payload is opaque bytes by contract
 * (postgres/migrations.ts: audit hashes are content-addressed over them),
 * so an index is projected columns written beside the blob, never a path
 * into it.
 *
 * A kind is list-indexed exactly when its declaration appears in the one
 * explicit list the composition root hands to the store when it opens
 * (boot/list-indexes.ts) — the search registry's idiom
 * (query/search/registry.ts). A declaration lives beside the lanes that
 * filter on its keys (`domain/<kind>/list-index.ts`) and states them as
 * data, a field path or a label, so the store derives them without
 * knowing any domain: this module is the one derivation every writer, the
 * reconciliation at open and every read of an unproven row share.
 *
 * Facts are written atomically with the row, never best-effort (the one
 * deliberate divergence from search, whose index only degrades search: a
 * missing list row hides a row). A row's facts are PROVEN current when
 * its stamp equals its `updated_at` and its revision is its declaration's;
 * a row written by a binary that does not know the index (every production
 * roll overlaps the old and the new pod for a minute), or by one with
 * another revision of the declaration, is UNPROVEN, and a read evaluates
 * it from its bytes with this module and repairs it (`queryResources` in
 * interface.ts states the contract). Exactness is therefore the store's
 * guarantee, independent of timing.
 *
 * The order is one for every indexed read: newest first on the audit's
 * `spec_audit.created_at`, ties broken by id, both compared as bytes. The
 * instant is fixed-width UTC text so the drivers sort it as text and this
 * module compares it the same way; an absent stamp is the empty string,
 * which sorts last newest-first — exactly `compareCreatedAtDesc`
 * (pipeline/steps/helpers.ts), the order the session lists always had.
 *
 * Proven by __tests__/list-index.test.ts (declaration validation, the
 * derivation, the instant, the merge) and, per driver, by the list-index
 * arms of __tests__/store-contract.ts.
 */
import { ScalarType } from "@bufbuild/protobuf";
import type { DescField, DescMessage } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { apiResourceKindName } from "./proto-fields.js";

// =============================================================================
// Declarations
// =============================================================================

/** Where a list key's value is read from: a string field or a label. */
export type ListKeySource =
  | { readonly from: "field"; readonly path: string }
  | { readonly from: "label"; readonly label: string };

/** A string field of the resource, by proto field names from the root ("spec.session_id"). */
export function field(path: string): ListKeySource {
  return { from: "field", path };
}

/** A `metadata.labels` entry. */
export function label(key: string): ListKeySource {
  return { from: "label", label: key };
}

/**
 * One kind's list index. `revision` is bumped whenever `keys` changes, so
 * rows written under another revision are re-derived rather than read
 * through keys they may lack; boot/__tests__/list-indexes.test.ts pins
 * every declaration's keys to its revision so a change cannot forget it.
 */
export interface ListIndexDeclaration<K extends string = string> {
  readonly kind: ApiResourceKind;
  readonly schema: DescMessage;
  readonly revision: number;
  readonly keys: Readonly<Record<K, ListKeySource>>;
}

interface ResolvedKey {
  readonly name: string;
  readonly read: (resource: object) => string;
}

const resolvedKeys = new WeakMap<
  ListIndexDeclaration,
  ReadonlyArray<ResolvedKey>
>();

/**
 * Declares a kind's list index, resolving every key against the schema so
 * a misspelt path or a non-string field fails at module load, not as a
 * silently empty list.
 */
export function declareListIndex<K extends string>(
  declaration: ListIndexDeclaration<K>,
): ListIndexDeclaration<K> {
  if (!Number.isInteger(declaration.revision) || declaration.revision < 1) {
    throw new Error(
      `list index for ${apiResourceKindName(declaration.kind)}: revision must be a positive integer`,
    );
  }
  const keys: ResolvedKey[] = [];
  for (const [name, source] of Object.entries<ListKeySource>(
    declaration.keys,
  )) {
    keys.push({ name, read: resolveKeyReader(declaration, name, source) });
  }
  const frozen = Object.freeze({
    ...declaration,
    keys: Object.freeze({ ...declaration.keys }),
  });
  resolvedKeys.set(frozen, keys);
  return frozen;
}

function resolveKeyReader(
  declaration: ListIndexDeclaration,
  name: string,
  source: ListKeySource,
): (resource: object) => string {
  switch (source.from) {
    case "label":
      return (resource) =>
        (resource as ResourceShape).metadata?.labels?.[source.label] ?? "";
    case "field": {
      const localNames = resolveFieldPath(declaration, name, source.path);
      return (resource) => {
        let value: unknown = resource;
        for (const localName of localNames) {
          if (value === null || typeof value !== "object") {
            return "";
          }
          value = (value as Record<string, unknown>)[localName];
        }
        return typeof value === "string" ? value : "";
      };
    }
    default: {
      const exhaustive: never = source;
      throw new Error(`unknown list key source: ${String(exhaustive)}`);
    }
  }
}

function resolveFieldPath(
  declaration: ListIndexDeclaration,
  name: string,
  path: string,
): ReadonlyArray<string> {
  const where = `list index for ${apiResourceKindName(declaration.kind)}, key '${name}'`;
  const segments = path.split(".");
  const localNames: string[] = [];
  let message: DescMessage | undefined = declaration.schema;
  segments.forEach((segment, index) => {
    const found: DescField | undefined = message?.fields.find(
      (f) => f.name === segment,
    );
    if (found === undefined) {
      throw new Error(`${where}: '${path}' has no field '${segment}'`);
    }
    localNames.push(found.localName);
    const last = index === segments.length - 1;
    if (last) {
      if (found.fieldKind !== "scalar" || found.scalar !== ScalarType.STRING) {
        throw new Error(`${where}: '${path}' is not a string field`);
      }
      return;
    }
    if (found.fieldKind !== "message") {
      throw new Error(`${where}: '${segment}' in '${path}' is not a message`);
    }
    message = found.message;
  });
  return localNames;
}

/** The declaration's shape as text, for the revision pin. */
export function listIndexFingerprint(
  declaration: ListIndexDeclaration,
): string {
  const keys = Object.entries<ListKeySource>(declaration.keys)
    .map(([name, source]) =>
      source.from === "field"
        ? `${name}=field:${source.path}`
        : `${name}=label:${source.label}`,
    )
    .sort();
  return `${apiResourceKindName(declaration.kind)}{${keys.join(",")}}`;
}

// =============================================================================
// Facts
// =============================================================================

/** The facts a store keeps beside one row of a list-indexed kind. */
export interface ListIndexFacts {
  readonly org: string;
  readonly createdAt: string;
  readonly revision: number;
  readonly keys: ReadonlyArray<{
    readonly key: string;
    readonly value: string;
  }>;
}

interface TimestampShape {
  readonly seconds: bigint;
  readonly nanos: number;
}

interface ResourceShape {
  readonly metadata?: {
    readonly id?: string;
    readonly org?: string;
    readonly labels?: Readonly<Record<string, string>>;
  };
  readonly status?: {
    readonly audit?: {
      readonly specAudit?: { readonly createdAt?: TimestampShape };
    };
  };
}

/** Derives a decoded row's facts; every absence is the empty value, never a throw. */
export function listIndexFactsOf(
  declaration: ListIndexDeclaration,
  resource: object,
): ListIndexFacts {
  const shaped = resource as ResourceShape;
  const keys: Array<{ key: string; value: string }> = [];
  for (const resolved of keysOf(declaration)) {
    const value = resolved.read(resource);
    if (value !== "") {
      keys.push({ key: resolved.name, value });
    }
  }
  return {
    org: shaped.metadata?.org ?? "",
    createdAt: listIndexInstant(shaped.status?.audit?.specAudit?.createdAt),
    revision: declaration.revision,
    keys,
  };
}

/**
 * Whether two derivations would write the same key rows — the check that
 * lets an update skip rewriting them, which a status write never needs.
 */
export function sameListKeyRows(a: ListIndexFacts, b: ListIndexFacts): boolean {
  return (
    a.createdAt === b.createdAt &&
    a.keys.length === b.keys.length &&
    a.keys.every(
      (k, i) => k.key === b.keys[i]?.key && k.value === b.keys[i]?.value,
    )
  );
}

function keysOf(declaration: ListIndexDeclaration): ReadonlyArray<ResolvedKey> {
  const keys = resolvedKeys.get(declaration);
  if (keys === undefined) {
    throw new Error(
      `list index for ${apiResourceKindName(declaration.kind)} was not made by declareListIndex`,
    );
  }
  return keys;
}

// The instant is representable as four-digit-year ISO text in this range;
// outside it a stamp is treated as absent rather than mis-sorted.
const MIN_INSTANT_SECONDS = -62_135_596_800n; // 0001-01-01T00:00:00Z
const MAX_INSTANT_SECONDS = 253_402_300_799n; // 9999-12-31T23:59:59Z

/**
 * A timestamp as the index's fixed-width UTC text
 * (`YYYY-MM-DDTHH:MM:SS.nnnnnnnnnZ`), or "" when absent.
 */
export function listIndexInstant(
  timestamp: TimestampShape | undefined,
): string {
  if (
    timestamp === undefined ||
    timestamp.seconds < MIN_INSTANT_SECONDS ||
    timestamp.seconds > MAX_INSTANT_SECONDS
  ) {
    return "";
  }
  const iso = new Date(Number(timestamp.seconds) * 1000).toISOString();
  const nanos = String(
    Math.max(0, Math.min(999_999_999, timestamp.nanos)),
  ).padStart(9, "0");
  return `${iso.slice(0, 19)}.${nanos}Z`;
}

/** Epoch milliseconds as the index's instant, for a `createdAtOrAfter` bound. */
export function listIndexInstantOfMillis(millis: number): string {
  const seconds = Math.floor(millis / 1000);
  const nanos = (millis - seconds * 1000) * 1_000_000;
  return listIndexInstant({ seconds: BigInt(seconds), nanos });
}

// =============================================================================
// Queries
// =============================================================================

/** A position in the index's order: the last row a read handed out. */
export interface ListIndexCursor {
  readonly createdAt: string;
  readonly id: string;
}

/**
 * One indexed read. Every predicate is optional and they AND together;
 * `anyKey` matches a row whose value for ANY listed key equals the given
 * value (a workflow run names its workflow or its instance).
 */
export interface ListIndexQuery<K extends string = string> {
  /** One organization's rows; "" or absent reads every organization. */
  readonly org?: string;
  readonly anyKey?: ReadonlyArray<{ readonly name: K; readonly value: string }>;
  /** Rows created at or after this instant, plus rows with no creation stamp. */
  readonly createdAtOrAfter?: string;
  /** Rows strictly after this position in the order. */
  readonly after?: ListIndexCursor;
  /** At most this many rows; absent reads every matching row. */
  readonly limit?: number;
}

/** One row a read hands out, with its position for the next read. */
export interface ListIndexRow {
  readonly id: string;
  readonly data: Uint8Array;
  readonly cursor: ListIndexCursor;
}

/** Byte order, the order both drivers sort text in (Postgres `COLLATE "C"`, sqlite BINARY). */
function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative when `a` comes first in the index's newest-first order. */
export function compareListIndexOrder(
  a: ListIndexCursor,
  b: ListIndexCursor,
): number {
  const byCreated = compareBytes(b.createdAt, a.createdAt);
  return byCreated !== 0 ? byCreated : compareBytes(b.id, a.id);
}

/** Whether a row's facts satisfy a query's predicates, the cursor included. */
export function matchesListIndexQuery(
  id: string,
  facts: ListIndexFacts,
  query: ListIndexQuery,
): boolean {
  if (query.org !== undefined && query.org !== "" && facts.org !== query.org) {
    return false;
  }
  if (query.anyKey !== undefined) {
    const wanted = query.anyKey;
    if (
      !facts.keys.some((k) =>
        wanted.some((w) => w.name === k.key && w.value === k.value),
      )
    ) {
      return false;
    }
  }
  if (
    query.createdAtOrAfter !== undefined &&
    facts.createdAt !== "" &&
    compareBytes(facts.createdAt, query.createdAtOrAfter) < 0
  ) {
    return false;
  }
  if (
    query.after !== undefined &&
    compareListIndexOrder({ createdAt: facts.createdAt, id }, query.after) <= 0
  ) {
    return false;
  }
  return true;
}

/**
 * The drivers' last step: the proven rows the index answered, merged with
 * the unproven rows evaluated from their bytes, in order, without
 * duplicates, cut to the limit. Both inputs already satisfy the query.
 */
export function mergeListIndexRows(
  proven: ReadonlyArray<ListIndexRow>,
  unproven: ReadonlyArray<ListIndexRow>,
  limit: number | undefined,
): ListIndexRow[] {
  const byId = new Map<string, ListIndexRow>();
  for (const row of [...proven, ...unproven]) {
    byId.set(row.id, row);
  }
  const merged = [...byId.values()].sort((a, b) =>
    compareListIndexOrder(a.cursor, b.cursor),
  );
  return limit === undefined ? merged : merged.slice(0, limit);
}

/** Refuses a limit a caller cannot mean: zero, negative or fractional. */
export function assertListIndexLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(
      `list index limit must be a positive integer, got ${limit}`,
    );
  }
}

// =============================================================================
// The registry a store opens with
// =============================================================================

/**
 * The declarations one store was opened with, keyed by kind. A read names
 * its declaration and the store refuses one it was not opened with, so a
 * lane and the composition root cannot silently disagree about an index.
 */
export class ListIndexRegistry {
  private readonly byKind = new Map<ApiResourceKind, ListIndexDeclaration>();

  constructor(declarations: ReadonlyArray<ListIndexDeclaration>) {
    for (const declaration of declarations) {
      keysOf(declaration);
      if (this.byKind.has(declaration.kind)) {
        throw new Error(
          `list index for ${apiResourceKindName(declaration.kind)} is declared twice`,
        );
      }
      this.byKind.set(declaration.kind, declaration);
    }
  }

  /** The declaration for a kind, or undefined when the kind is not list-indexed. */
  declarationOf(kind: ApiResourceKind): ListIndexDeclaration | undefined {
    return this.byKind.get(kind);
  }

  /** Every declaration, in registration order. */
  declarations(): ReadonlyArray<ListIndexDeclaration> {
    return [...this.byKind.values()];
  }

  /** A decoded row's facts when its kind is list-indexed; undefined otherwise. */
  factsOf(kind: ApiResourceKind, resource: object): ListIndexFacts | undefined {
    const declaration = this.byKind.get(kind);
    return declaration === undefined
      ? undefined
      : listIndexFactsOf(declaration, resource);
  }

  /** Throws unless this exact declaration was registered. */
  require(declaration: ListIndexDeclaration): void {
    if (this.byKind.get(declaration.kind) !== declaration) {
      throw new Error(
        `list index for ${apiResourceKindName(declaration.kind)} is not registered with this store`,
      );
    }
  }
}
