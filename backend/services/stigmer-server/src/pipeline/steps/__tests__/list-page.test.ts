/**
 * Pins the page loop every paged list lane shares (../list-page.ts),
 * against a real store opened with the server's list indexes:
 * `page_size` 0 reads the whole list with no token; a positive size walks
 * every row in the store's order with no gap and no duplicate, the last
 * page carrying no token (also when the rows end exactly on a page); a
 * scope that refuses rows still fills pages and the cut resumes after the
 * last row returned; a caller who may see nothing gets short pages bounded
 * by the examine budget, each with a token, until the rows run out; a size
 * above the contract's maximum is capped; and the token's refusals — a
 * negative size, malformed text, a token issued for another request.
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { fromBinary } from "@bufbuild/protobuf";

import { sessionListIndex } from "../../../domain/session/list-index.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import {
  LIST_PAGE_MAX_SIZE,
  examineBudgetOf,
  listPageFingerprint,
  readListPage,
} from "../list-page.js";
import type { ListPageParams } from "../list-page.js";

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
): ListPageParams<Session, "agent_instance" | "channel"> {
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
  it("reads the whole list with no token at page_size 0", async () => {
    const all = await seed(7);
    const page = await readListPage(params(0, ""));
    expect(page.entries.map((s) => s.metadata!.id)).toEqual(all);
    expect(page.nextPageToken).toBe("");
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
