/**
 * Pins the page loop every paged list lane shares (../list-page.ts),
 * against a real store opened with the server's list indexes:
 * `page_size` 0 reads the default page of 50 and a token, never the whole
 * list; a positive size walks every row in the store's order with no gap
 * and no duplicate, the last page carrying no token (also when the rows
 * end exactly on a page); a scope that refuses rows still fills pages and
 * the cut resumes after the last row returned; a caller who may see
 * nothing gets short pages bounded by the examine budget, each with a
 * token, until the rows run out; a size above the contract's maximum is
 * capped; and the token's refusals — a negative size, malformed text, a
 * token issued for another request.
 *
 * `readPage` is the same loop over a function source, the way an extension
 * that keeps its own table calls it: it pages a source's rows with no gap
 * and no duplicate, asks the source for the rows after the last one it
 * handed out with one row past the batch, and answers a source fault as
 * INTERNAL with the lane's copy. `readEveryPage` walks a list's tokens to
 * the end for an in-process reader, and refuses past its cap rather than
 * answer a cut list. `decodeOrSkip` is a lane's decoder: a row that does
 * not decode is skipped, and named in a warning when the lane asks.
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { fromBinary, toBinary } from "@bufbuild/protobuf";

import { sessionListIndex } from "../../../domain/session/list-index.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import {
  LIST_PAGE_DEFAULT_SIZE,
  LIST_PAGE_MAX_SIZE,
  decodeOrSkip,
  examineBudgetOf,
  listPageFingerprint,
  readEveryPage,
  readListPage,
  readPage,
} from "../list-page.js";
import type { ListIndexCursor, ListIndexRow } from "../../../store/list-index.js";
import type { ListPageParams, ListPageSource } from "../list-page.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

async function seed(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `ses_${String(i).padStart(4, "0")}`;
    ids.push(id);
    await temp.store.saveResource(
      ApiResourceKind.session,
      id,
      SessionSchema,
      create(SessionSchema, {
        metadata: { id, org: "acme" },
        status: {
          audit: {
            specAudit: { createdAt: { seconds: BigInt(1_000 + i), nanos: 0 } },
          },
        },
      }),
    );
  }
  // Newest first: the highest creation instant first.
  return ids.reverse();
}

function params(
  pageSize: number,
  pageToken: string,
  scope: (rows: Session[]) => Session[] = (rows) => rows,
): ListPageParams<Session, "agent" | "channel"> {
  return {
    store: temp.store,
    declaration: sessionListIndex,
    query: { org: "acme" },
    request: { pageSize, pageToken },
    fingerprint: listPageFingerprint({ lane: "test", org: "acme" }),
    decode: (data) => fromBinary(SessionSchema, data),
    scope: (rows) => Promise.resolve(scope(rows)),
    failure: "failed to list sessions",
  };
}

async function walk(
  pageSize: number,
  scope?: (rows: Session[]) => Session[],
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let token = "";
  let pages = 0;
  do {
    const page = await readListPage(params(pageSize, token, scope));
    ids.push(...page.entries.map((s) => s.metadata!.id));
    token = page.nextPageToken;
    pages += 1;
  } while (token !== "");
  return { ids, pages };
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("readListPage", () => {
  it("reads the default page of 50 and a token at page_size 0, never the whole list", async () => {
    const all = await seed(LIST_PAGE_DEFAULT_SIZE + 1);
    const page = await readListPage(params(0, ""));
    expect(page.entries.map((s) => s.metadata!.id)).toEqual(all.slice(0, LIST_PAGE_DEFAULT_SIZE));
    expect(page.nextPageToken).not.toBe("");
  });

  it("walks every row with no gap and no duplicate, the last page without a token", async () => {
    const all = await seed(7);
    const { ids, pages } = await walk(3);
    expect(ids).toEqual(all);
    expect(pages).toBe(3);
  });

  it("issues no token when the rows end exactly on a page", async () => {
    const all = await seed(6);
    const { ids, pages } = await walk(3);
    expect(ids).toEqual(all);
    expect(pages).toBe(2);
  });

  it("fills pages around rows the scope refuses and resumes after the last row returned", async () => {
    const all = await seed(12);
    const refused = new Set(["ses_0010", "ses_0007", "ses_0006", "ses_0001"]);
    const scope = (rows: Session[]) =>
      rows.filter((s) => !refused.has(s.metadata!.id));
    const first = await readListPage(params(3, "", scope));
    expect(first.entries).toHaveLength(3);
    const { ids } = await walk(3, scope);
    expect(ids).toEqual(all.filter((id) => !refused.has(id)));
  });

  it("bounds what a caller who may see nothing examines, with a token until the rows run out", async () => {
    await seed(250);
    const noneVisible = () => [];
    const first = await readListPage(params(20, "", noneVisible));
    expect(first.entries).toEqual([]);
    expect(first.nextPageToken).not.toBe("");
    expect(examineBudgetOf(20)).toBe(100);
    const { ids, pages } = await walk(20, noneVisible);
    expect(ids).toEqual([]);
    expect(pages).toBe(3);
  });

  it("caps a page at the contract's maximum", async () => {
    await seed(LIST_PAGE_MAX_SIZE + 5);
    const page = await readListPage(params(1_000, ""));
    expect(page.entries).toHaveLength(LIST_PAGE_MAX_SIZE);
    expect(page.nextPageToken).not.toBe("");
  });

  it("refuses a negative size, a malformed token and a token issued for another request", async () => {
    await seed(4);
    expect((await refusal(readListPage(params(-1, "")))).code).toBe(
      Code.InvalidArgument,
    );
    const bad = await refusal(readListPage(params(2, "not a token")));
    expect([bad.code, bad.rawMessage]).toEqual([
      Code.InvalidArgument,
      "invalid page_token",
    ]);

    const token = (await readListPage(params(2, ""))).nextPageToken;
    const other = await refusal(
      readListPage({
        ...params(2, token),
        fingerprint: listPageFingerprint({ lane: "test", org: "other" }),
      }),
    );
    expect([other.code, other.rawMessage]).toEqual([
      Code.InvalidArgument,
      "page_token was issued for a different request",
    ]);
  });
});

describe("readPage", () => {
  /** Rows a host keeps itself, newest first, as a source answers them. */
  function hostRows(count: number): ListIndexRow[] {
    return Array.from({ length: count }, (_, i) => {
      const n = count - 1 - i;
      const id = `row_${String(n).padStart(3, "0")}`;
      return {
        id,
        data: new TextEncoder().encode(id),
        cursor: { createdAt: `2026-10-07T00:00:${String(n).padStart(2, "0")}.000000Z`, id },
      };
    });
  }

  /** A source over `rows`, recording each call's cursor id and limit. */
  function sourceOver(
    rows: ReadonlyArray<ListIndexRow>,
    calls: Array<[string | undefined, number | undefined]>,
  ): ListPageSource {
    return (after: ListIndexCursor | undefined, limit: number | undefined) => {
      calls.push([after?.id, limit]);
      const start = after === undefined ? 0 : rows.findIndex((row) => row.id === after.id) + 1;
      const rest = rows.slice(start);
      return Promise.resolve(limit === undefined ? rest : rest.slice(0, limit));
    };
  }

  function pageOf(source: ListPageSource, pageSize: number, pageToken: string) {
    return readPage({
      source,
      request: { pageSize, pageToken },
      fingerprint: listPageFingerprint({ lane: "host", org: "acme" }),
      decode: (data) => new TextDecoder().decode(data),
      scope: (rows) => Promise.resolve(rows),
      failure: "failed to list host rows",
    });
  }

  it("pages a function source with no gap and no duplicate, asking for the rows after the last one handed out", async () => {
    const rows = hostRows(5);
    const calls: Array<[string | undefined, number | undefined]> = [];
    const source = sourceOver(rows, calls);

    const ids: string[] = [];
    let token = "";
    do {
      const page = await pageOf(source, 2, token);
      ids.push(...page.entries);
      token = page.nextPageToken;
    } while (token !== "");

    expect(ids).toEqual(rows.map((row) => row.id));
    expect(calls).toEqual([
      [undefined, 3],
      ["row_003", 3],
      ["row_001", 3],
    ]);
    expect((await pageOf(source, 0, "")).entries).toEqual(rows.map((row) => row.id));
  });

  it("passes a source's own refusal through unwrapped", async () => {
    const refusing: ListPageSource = () =>
      Promise.reject(
        new ConnectError("invalid page_token", Code.InvalidArgument),
      );
    const answer = await refusal(pageOf(refusing, 2, ""));
    expect([answer.code, answer.rawMessage]).toEqual([
      Code.InvalidArgument,
      "invalid page_token",
    ]);
  });

  it("answers a source fault INTERNAL with the lane's copy", async () => {
    const failing: ListPageSource = () => Promise.reject(new Error("connection refused"));
    const fault = await refusal(pageOf(failing, 2, ""));
    expect([fault.code, fault.rawMessage]).toEqual([
      Code.Internal,
      "failed to list host rows",
    ]);
  });

  it("readEveryPage follows every token to the end, in order", async () => {
    const rows = hostRows(5);
    const source = sourceOver(rows, []);
    const tokens: string[] = [];
    const every = await readEveryPage(
      (pageToken) => {
        tokens.push(pageToken);
        return pageOf(source, 2, pageToken);
      },
      { what: "the host's rows" },
    );
    expect(every).toEqual(rows.map((row) => row.id));
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toBe("");
  });

  it("readEveryPage refuses past its cap rather than answer a cut list", async () => {
    const source = sourceOver(hostRows(5), []);
    const refused = await refusal(
      readEveryPage((pageToken) => pageOf(source, 2, pageToken), {
        what: "the host's rows",
        cap: 3,
      }),
    );
    expect([refused.code, refused.rawMessage]).toEqual([
      Code.FailedPrecondition,
      "the host's rows holds more than 3 entries; read it a page at a time",
    ]);
  });
});

describe("decodeOrSkip", () => {
  const session = create(SessionSchema, { metadata: { id: "ses_1", org: "acme" } });
  const undecodable = new Uint8Array([0xff, 0xff, 0xff]);

  it("decodes a stored row", () => {
    expect(decodeOrSkip(SessionSchema)(toBinary(SessionSchema, session))?.metadata?.id).toBe("ses_1");
  });

  it("skips a row that does not decode, silently when the lane names no log", () => {
    expect(decodeOrSkip(SessionSchema)(undecodable)).toBeUndefined();
  });

  it("skips a row that does not decode and warns with the lane's fields and the reason", () => {
    const warnings: Array<[string, Record<string, unknown> | undefined]> = [];
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (message: string, fields?: Record<string, unknown>) => {
        warnings.push([message, fields]);
      },
      error: () => undefined,
    };
    const decode = decodeOrSkip(SessionSchema, {
      logger,
      message: "skipped a session row that does not decode",
      fields: { org: "acme" },
    });
    expect(decode(undecodable)).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toBe("skipped a session row that does not decode");
    expect(warnings[0]![1]).toMatchObject({ org: "acme", error: expect.any(String) });
  });
});
