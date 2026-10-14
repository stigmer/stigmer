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
 * - `listPageSizeOf` is the only reader of `page_size`: 0 asks for
 *   `LIST_PAGE_DEFAULT_SIZE`, a size above `LIST_PAGE_MAX_SIZE` is read as
 *   that maximum (coerced, never refused: AIP-158), and a negative size is
 *   refused. No request reads every row; a caller that needs the whole list
 *   walks its tokens with `readEveryPage`, which refuses past a cap.
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
 * The loop reads its rows from a source, so it does not depend on where
 * the rows live. `readListPage` is the loop over this server's own store
 * (the list index); `readPage` takes any source that answers the same
 * contract (the rows after a cursor, newest first, at most a limit), so an
 * extension that keeps its own table pages by these same rules instead of
 * writing a second loop, and both are on the package's barrel.
 *
 * Proven by __tests__/list-page.test.ts (the loop, the budget, the cut,
 * the token, a function source) and end-to-end by the paging arms of the
 * conformance suites.
 */
import { createHash } from "node:crypto";

import { toBinary } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { Store } from "../../store/interface.js";
import type {
  ListIndexCursor,
  ListIndexDeclaration,
  ListIndexQuery,
  ListIndexRow,
} from "../../store/list-index.js";
import {
  compareListIndexOrder,
  listIndexInstant,
} from "../../store/list-index.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../errors.js";

/** The most entries one page returns, the contract's word on every paged request. */
export const LIST_PAGE_MAX_SIZE = 100;

/** The entries a page returns when the request names no size (`page_size` 0). */
export const LIST_PAGE_DEFAULT_SIZE = 50;

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

/**
 * The size of the page a request asks for: the default at 0, the maximum
 * above it. The one reader of `page_size`, so no lane grows a default of
 * its own. The edge validator refuses a negative size before a handler
 * runs; this refuses one again for in-process callers that skip it.
 */
export function listPageSizeOf(
  request: Pick<ListPageRequest, "pageSize">,
): number {
  if (request.pageSize < 0) {
    throw invalidArgumentError("page_size must not be negative");
  }
  if (request.pageSize === 0) {
    return LIST_PAGE_DEFAULT_SIZE;
  }
  return Math.min(request.pageSize, LIST_PAGE_MAX_SIZE);
}

/**
 * Where a page's rows come from: the rows after `after` (from the start
 * when undefined) in the list index's order, newest first, ties broken by
 * id in byte order, at most `limit` of them.
 * Each row carries the cursor a later read continues after.
 *
 * `after` comes from the client's page token: opaque, but not signed, so
 * its `createdAt` and `id` are whatever text the client sent. A source over
 * typed columns validates them and refuses a malformed one with
 * `invalidArgumentError("invalid page_token")`, the loop's own answer for
 * a token it cannot read.
 */
export type ListPageSource = (
  after: ListIndexCursor | undefined,
  limit: number,
) => Promise<ReadonlyArray<ListIndexRow>>;

/** What one page needs, whatever its rows' source. */
export interface ReadPageParams<T> {
  readonly source: ListPageSource;
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
  /** The failure copy for a source fault. */
  readonly failure: string;
}

export interface ListPageParams<T, K extends string> extends Omit<
  ReadPageParams<T>,
  "source"
> {
  readonly store: Store;
  readonly declaration: ListIndexDeclaration<K>;
  /** The request's own predicates, pushed into the store's indexed read. */
  readonly query: Omit<ListIndexQuery<K>, "after" | "limit">;
}

export interface ListPage<T> {
  readonly entries: T[];
  /** "" when the list is complete. */
  readonly nextPageToken: string;
}

/** Reads one page through the list index. */
export function readListPage<T, K extends string>(
  params: ListPageParams<T, K>,
): Promise<ListPage<T>> {
  const { store, declaration, query, ...rest } = params;
  return readPage({
    ...rest,
    source: (after, limit) =>
      store.queryResources(declaration, {
        ...query,
        ...(after === undefined ? {} : { after }),
        limit,
      }),
  });
}

/** Reads one page from `source`. */
export async function readPage<T>(
  params: ReadPageParams<T>,
): Promise<ListPage<T>> {
  const { request } = params;
  const size = listPageSizeOf(request);
  let after =
    request.pageToken === ""
      ? undefined
      : decodeListPageToken(request.pageToken, params.fingerprint).cursor;

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

/** What `inHandListPageSource` reads off a resource for its place in the order. */
interface InHandResource {
  readonly metadata?: { readonly id?: string };
  readonly status?: {
    readonly audit?: {
      readonly specAudit?: {
        readonly createdAt?: {
          readonly seconds: bigint;
          readonly nanos: number;
        };
      };
    };
  };
}

/**
 * A source over resources already in hand: those a port answers as a
 * whole set (an edition's own table of an organization's accounts) or an
 * authorization engine names by id. It orders them as the list index
 * does (creation instant, then id, newest first) and hands out the rows
 * after a cursor, so such a lane pages by the one loop and the one token,
 * and a row created between two pages lands before the first rather than
 * shifting an offset.
 */
export function inHandListPageSource<Desc extends DescMessage>(
  schema: Desc,
  resources: ReadonlyArray<MessageShape<Desc>>,
): ListPageSource {
  const rows: ListIndexRow[] = resources
    .map((resource) => {
      const shaped = resource as InHandResource;
      const id = shaped.metadata?.id ?? "";
      return {
        id,
        data: toBinary(schema, resource),
        cursor: {
          createdAt: listIndexInstant(
            shaped.status?.audit?.specAudit?.createdAt,
          ),
          id,
        },
      };
    })
    .sort((a, b) => compareListIndexOrder(a.cursor, b.cursor));
  return (after, limit) =>
    Promise.resolve(
      (after === undefined
        ? rows
        : rows.filter((row) => compareListIndexOrder(row.cursor, after) > 0)
      ).slice(0, limit),
    );
}

/** The most entries `readEveryPage` gathers before it refuses. */
export const READ_EVERY_PAGE_DEFAULT_CAP = 1000;

/**
 * Every entry of a list, read page by page through its tokens: for an
 * in-process reader that needs the whole set (the channels that gate an
 * inbox, a parent's children). `read` returns the page a token names, ""
 * naming the first. Past `cap` entries it refuses rather than return a
 * cut list a caller would mistake for the whole; the default cap is the
 * one the authorization enumeration refuses past.
 */
export async function readEveryPage<T>(
  read: (pageToken: string) => Promise<ListPage<T>>,
  options: { readonly what: string; readonly cap?: number },
): Promise<T[]> {
  const cap = options.cap ?? READ_EVERY_PAGE_DEFAULT_CAP;
  const entries: T[] = [];
  let token = "";
  for (;;) {
    const page = await read(token);
    entries.push(...page.entries);
    if (entries.length > cap) {
      throw failedPreconditionError(
        `${options.what} holds more than ${cap} entries; read it a page at a time`,
      );
    }
    if (page.nextPageToken === "") {
      return entries;
    }
    token = page.nextPageToken;
  }
}

interface Admitted<T> {
  readonly row: T;
  readonly cursor: ListIndexCursor;
}

async function queryOrFail<T>(
  params: ReadPageParams<T>,
  after: ListIndexCursor | undefined,
  limit: number,
): Promise<ReadonlyArray<ListIndexRow>> {
  try {
    return await params.source(after, limit);
  } catch (error) {
    // A source's own refusal (a cursor it cannot read answers
    // `invalid page_token`, as the source contract above asks) is the
    // caller's answer; any other failure is a fault behind the lane.
    if (error instanceof ConnectError) {
      throw error;
    }
    throw internalError(error, params.failure);
  }
}

/** A batch through the lane's filter and the scope, each row keeping its cursor. */
async function admit<T>(
  params: ReadPageParams<T>,
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
