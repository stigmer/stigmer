/**
 * One page of a list lane read through the list index — the one
 * implementation of the page loop every paged lane calls, so the rules
 * below hold everywhere by construction:
 *
 * - The store narrows by the request's own predicates (organization, key,
 *   creation window) and orders newest first (store/list-index.ts). The
 *   lane's per-row filter runs on each batch, then the read scope, which
 *   stays the last per-row predicate (extensions/list-read-scope.ts);
 *   neither reorders, so a page is in the store's order.
 * - `page_size` 0 reads every matching row and returns no token, the
 *   behaviour every list lane had before it paged; a positive size is
 *   capped at `LIST_PAGE_MAX_SIZE`.
 * - A page fills batch by batch until it is full, the rows run out, or
 *   `examineBudgetOf(size)` rows have been examined. A caller who may see
 *   few of the organization's rows gets a short page, possibly empty, with
 *   a token (the timeline's cursor contract, agentchannel/v1
 *   conversation_io.proto), never an unbounded walk.
 * - The token's cursor is the last row RETURNED when the page was cut,
 *   else the last row EXAMINED, so no row is skipped and no refused row is
 *   read twice. The token is opaque and versioned, carries a fingerprint
 *   of the request's other fields (a mismatch is refused), and carries no
 *   authority: every page re-runs the scope.
 *
 * Proven by __tests__/list-page.test.ts (the loop, the budget, the cut,
 * the token) and end-to-end by the paging arms of the conformance suites.
 */
import { createHash } from "node:crypto";

import type { Store } from "../../store/interface.js";
import type {
  ListIndexCursor,
  ListIndexDeclaration,
  ListIndexQuery,
  ListIndexRow,
} from "../../store/list-index.js";
import { internalError, invalidArgumentError } from "../errors.js";

/** The most entries one page returns, the contract's word on every paged request. */
export const LIST_PAGE_MAX_SIZE = 100;

/**
 * The most rows one request examines for a page of `size`: five pages'
 * worth, at least 100, at most 500. It bounds what one request asks of a
 * composed read scope (on the hosted edition one authorization key per
 * row, 50 per round trip) when the caller can see few of the rows.
 */
export function examineBudgetOf(size: number): number {
  return Math.min(500, Math.max(100, size * 5));
}

/** The request fields every paged lane carries. */
export interface ListPageRequest {
  readonly pageSize: number;
  readonly pageToken: string;
}

export interface ListPageParams<T, K extends string> {
  readonly store: Store;
  readonly declaration: ListIndexDeclaration<K>;
  /** The request's own predicates, pushed into the store's indexed read. */
  readonly query: Omit<ListIndexQuery<K>, "after" | "limit">;
  readonly request: ListPageRequest;
  /**
   * The request's other fields, as text: a token is valid only for the
   * request it was issued to.
   */
  readonly fingerprint: string;
  /** Decodes a row; undefined skips it (the lane logs, as it always has). */
  readonly decode: (data: Uint8Array) => T | undefined;
  /** The lane's per-row filter beyond the indexed predicates. */
  readonly keep?: (row: T) => boolean;
  /** The read scope, bound by the lane to its caller and kind. */
  readonly scope: (rows: T[]) => Promise<T[]>;
  /** The failure copy for a store fault. */
  readonly failure: string;
}

export interface ListPage<T> {
  readonly entries: T[];
  /** "" when the list is complete. */
  readonly nextPageToken: string;
}

/** Reads one page (or, at `page_size` 0, the whole list) through the list index. */
export async function readListPage<T, K extends string>(
  params: ListPageParams<T, K>,
): Promise<ListPage<T>> {
  const { request } = params;
  if (request.pageSize < 0) {
    throw invalidArgumentError("page_size must not be negative");
  }
  let after =
    request.pageToken === ""
      ? undefined
      : decodeListPageToken(request.pageToken, params.fingerprint).cursor;

  if (request.pageSize === 0) {
    const rows = await queryOrFail(params, after, undefined);
    return {
      entries: await admit(params, rows).then((a) => a.map((e) => e.row)),
      nextPageToken: "",
    };
  }

  const size = Math.min(request.pageSize, LIST_PAGE_MAX_SIZE);
  const budget = examineBudgetOf(size);
  const kept: Array<Admitted<T>> = [];
  let examined = 0;
  for (;;) {
    // One row past the batch is read only to learn whether more follow,
    // so a list that ends exactly on a page carries no token (and no
    // empty page behind it); the next batch reads that row again.
    const batchSize = Math.min(size, budget - examined);
    const read = await queryOrFail(params, after, batchSize + 1);
    const more = read.length > batchSize;
    const rows = more ? read.slice(0, batchSize) : read;
    examined += rows.length;
    kept.push(...(await admit(params, rows)));
    const last = rows[rows.length - 1];
    if (last !== undefined) {
      after = last.cursor;
    }

    if (kept.length >= size) {
      const page = kept.slice(0, size);
      const exhausted = !more && kept.length === size;
      return {
        entries: page.map((e) => e.row),
        nextPageToken: exhausted
          ? ""
          : encodeListPageToken(
              page[page.length - 1]!.cursor,
              params.fingerprint,
            ),
      };
    }
    if (!more) {
      return { entries: kept.map((e) => e.row), nextPageToken: "" };
    }
    if (examined >= budget) {
      return {
        entries: kept.map((e) => e.row),
        nextPageToken: encodeListPageToken(after!, params.fingerprint),
      };
    }
  }
}

interface Admitted<T> {
  readonly row: T;
  readonly cursor: ListIndexCursor;
}

async function queryOrFail<T, K extends string>(
  params: ListPageParams<T, K>,
  after: ListIndexCursor | undefined,
  limit: number | undefined,
): Promise<ListIndexRow[]> {
  try {
    return await params.store.queryResources(params.declaration, {
      ...params.query,
      ...(after === undefined ? {} : { after }),
      ...(limit === undefined ? {} : { limit }),
    });
  } catch (error) {
    throw internalError(error, params.failure);
  }
}

/** A batch through the lane's filter and the scope, each row keeping its cursor. */
async function admit<T, K extends string>(
  params: ListPageParams<T, K>,
  rows: ReadonlyArray<ListIndexRow>,
): Promise<Array<Admitted<T>>> {
  const decoded: Array<Admitted<T>> = [];
  for (const row of rows) {
    const value = params.decode(row.data);
    if (
      value !== undefined &&
      (params.keep === undefined || params.keep(value))
    ) {
      decoded.push({ row: value, cursor: row.cursor });
    }
  }
  if (decoded.length === 0) {
    return [];
  }
  const allowed = new Set(await params.scope(decoded.map((d) => d.row)));
  return decoded.filter((d) => allowed.has(d.row));
}

// =============================================================================
// The token
// =============================================================================

const TOKEN_VERSION = 1;

/**
 * The position a token carries: the list index's cursor, plus, for a lane
 * whose entries are finer than rows (the approvals of one execution), the
 * entry's position within its row.
 */
export interface ListPageTokenCursor {
  readonly cursor: ListIndexCursor;
  readonly position?: number;
}

function fingerprintHash(fingerprint: string): string {
  return createHash("sha256")
    .update(fingerprint)
    .digest("base64url")
    .slice(0, 16);
}

/** An opaque, versioned token for the position after `cursor`. */
export function encodeListPageToken(
  cursor: ListIndexCursor,
  fingerprint: string,
  position?: number,
): string {
  const body = {
    v: TOKEN_VERSION,
    c: cursor.createdAt,
    i: cursor.id,
    f: fingerprintHash(fingerprint),
    ...(position === undefined ? {} : { p: position }),
  };
  return Buffer.from(JSON.stringify(body)).toString("base64url");
}

/**
 * The position a token carries, refused as `invalid page_token` (the copy
 * every paged lane already answers with) when it is malformed, of a
 * version this server never issued, or issued for another request.
 */
export function decodeListPageToken(
  token: string,
  fingerprint: string,
): ListPageTokenCursor {
  let body: unknown;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.toString("base64url") !== token) {
      throw new Error("not canonical base64url");
    }
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw invalidArgumentError("invalid page_token");
  }
  if (
    typeof body !== "object" ||
    body === null ||
    (body as { v?: unknown }).v !== TOKEN_VERSION ||
    typeof (body as { c?: unknown }).c !== "string" ||
    typeof (body as { i?: unknown }).i !== "string" ||
    typeof (body as { f?: unknown }).f !== "string"
  ) {
    throw invalidArgumentError("invalid page_token");
  }
  const parsed = body as { c: string; i: string; f: string; p?: unknown };
  if (parsed.f !== fingerprintHash(fingerprint)) {
    throw invalidArgumentError("page_token was issued for a different request");
  }
  if (
    parsed.p !== undefined &&
    !(Number.isSafeInteger(parsed.p) && (parsed.p as number) >= 0)
  ) {
    throw invalidArgumentError("invalid page_token");
  }
  return {
    cursor: { createdAt: parsed.c, id: parsed.i },
    ...(parsed.p === undefined ? {} : { position: parsed.p as number }),
  };
}

/** A request's other fields as the text its token is bound to. */
export function listPageFingerprint(
  fields: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify(fields, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}
