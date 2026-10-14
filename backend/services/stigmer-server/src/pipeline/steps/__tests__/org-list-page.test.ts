/**
 * Pins readOrgListPage (../org-list-page.ts), the body of a kind's plain
 * organization `list`, over a real sqlite store opened with the server's
 * list indexes: it pages one organization's rows newest first by token,
 * answers none of another organization's, reads the default page when the
 * request names no size, lets a composed read scope narrow each page last,
 * and skips a row that does not decode.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { agentListIndex } from "../../../domain/agent/list-index.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { ListReadScope } from "../../../extensions/list-read-scope.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { LIST_PAGE_DEFAULT_SIZE } from "../list-page.js";
import { readOrgListPage } from "../org-list-page.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

async function seedAgent(id: string, org: string, minute: number): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    create(AgentSchema, {
      metadata: { id, name: id, slug: id, org },
      status: {
        audit: {
          specAudit: {
            createdAt: timestampFromDate(
              new Date(Date.UTC(2026, 9, 14, 0, minute)),
            ),
          },
        },
      },
    }),
  );
}

function page(
  request: { org: string; pageSize?: number; pageToken?: string },
  listReadScope: ListReadScope | undefined = undefined,
) {
  return readOrgListPage<Agent>({
    store: temp.store,
    logger: silentLogger,
    listReadScope,
    caller: testCallerIdentity(),
    kind: ApiResourceKind.agent,
    schema: AgentSchema,
    declaration: agentListIndex,
    request: {
      org: request.org,
      pageSize: request.pageSize ?? 0,
      pageToken: request.pageToken ?? "",
    },
  });
}

async function walk(
  org: string,
  pageSize: number,
  scope?: ListReadScope,
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let pageToken = "";
  let pages = 0;
  do {
    const got = await page({ org, pageSize, pageToken }, scope);
    ids.push(...got.entries.map((agent) => agent.metadata!.id));
    pageToken = got.nextPageToken;
    pages += 1;
  } while (pageToken !== "");
  return { ids, pages };
}

describe("readOrgListPage", () => {
  it("pages one organization's rows newest first and none of another's", async () => {
    for (const minute of [1, 2, 3]) {
      await seedAgent(`agt_a${minute}`, "org_a", minute);
    }
    await seedAgent("agt_b1", "org_b", 9);

    const walked = await walk("org_a", 1);
    expect(walked.ids).toEqual(["agt_a3", "agt_a2", "agt_a1"]);
    expect(walked.pages).toBe(3);
  });

  it("reads the default page when the request names no size", async () => {
    for (let minute = 0; minute < LIST_PAGE_DEFAULT_SIZE + 2; minute += 1) {
      await seedAgent(`agt_${String(minute).padStart(3, "0")}`, "org_a", minute);
    }
    const first = await page({ org: "org_a" });
    expect(first.entries).toHaveLength(LIST_PAGE_DEFAULT_SIZE);
    expect(first.nextPageToken).not.toBe("");
    const rest = await page({ org: "org_a", pageToken: first.nextPageToken });
    expect(rest.entries).toHaveLength(2);
    expect(rest.nextPageToken).toBe("");
  });

  it("narrows each page last through a composed read scope", async () => {
    for (const minute of [1, 2, 3, 4]) {
      await seedAgent(`agt_${minute}`, "org_a", minute);
    }
    const scope: ListReadScope = {
      authorizedResourceIds: () => Promise.resolve(new Set()),
      restrictListEntries: (_caller, _kind, entries) =>
        Promise.resolve(
          new Set(
            entries
              .map((entry) => entry.id)
              .filter((id) => id === "agt_1" || id === "agt_3"),
          ),
        ),
    };
    expect((await walk("org_a", 1, scope)).ids).toEqual(["agt_3", "agt_1"]);
  });

  it("skips a row that does not decode", async () => {
    await seedAgent("agt_good", "org_a", 1);
    const store = temp.store;
    const read = store.queryResources.bind(store);
    store.queryResources = async (declaration, query) => {
      const rows = await read(declaration, query);
      return rows.map((row) =>
        row.id === "agt_good"
          ? row
          : { ...row, data: new Uint8Array([0xff, 0xff]) },
      );
    };
    await seedAgent("agt_bad", "org_a", 2);
    const got = await page({ org: "org_a" });
    expect(got.entries.map((agent) => agent.metadata!.id)).toEqual([
      "agt_good",
    ]);
  });
});
