/**
 * Pins the purge stages' row reader (../rows.ts) over a real SQLite store
 * opened with the server's list indexes: it answers only the
 * organization's ids, in pages that resume where the last ended, for a
 * kind read through its list index (sessions) and for one with no list
 * index (agents, read in keyset pages, past a full scan page). The
 * indexed read never touches another organization's rows: a store whose
 * keyset read throws still answers. A kind metadata.org does not place,
 * a bad limit and a foreign cursor are refused.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";

import { LIST_INDEXES } from "../../../../boot/list-indexes.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { OrganizationRows } from "../../../../extensions/organization-purge.js";
import { newOrganizationRows } from "../rows.js";

const ORG = "org_purged";
const OTHER = "org_kept";

let fx: TempStore;

beforeEach(() => {
  fx = tempStore();
});

afterEach(async () => {
  await fx.cleanup();
});

async function saveSessions(org: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 0; n < count; n++) {
    const id = `ses_${org}_${String(n).padStart(3, "0")}`;
    await fx.store.saveResource(
      ApiResourceKind.session,
      id,
      SessionSchema,
      create(SessionSchema, { metadata: { id, org } }),
    );
    ids.push(id);
  }
  return ids;
}

async function saveAgents(org: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 0; n < count; n++) {
    const id = `agt_${org}_${String(n).padStart(4, "0")}`;
    await fx.store.saveResource(
      ApiResourceKind.agent,
      id,
      AgentSchema,
      create(AgentSchema, { metadata: { id, org } }),
    );
    ids.push(id);
  }
  return ids;
}

/** Every page, read to the end. */
async function allPages(
  rows: OrganizationRows,
  kind: ApiResourceKind,
  schema: typeof SessionSchema | typeof AgentSchema,
  limit: number,
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let after = "";
  let pages = 0;
  for (;;) {
    const page = await rows.ids(kind, schema, { after, limit });
    pages += 1;
    ids.push(...page.ids);
    if (page.next === undefined) {
      return { ids, pages };
    }
    after = page.next;
  }
}

describe("the purge stages' row reader", () => {
  it("pages an indexed kind's rows of the organization only, without a keyset scan", async () => {
    const mine = await saveSessions(ORG, 7);
    await saveSessions(OTHER, 5);
    const store = Object.create(fx.store) as typeof fx.store;
    store.findResourcesRawOrderedAfter = () =>
      Promise.reject(new Error("the indexed read scanned the kind"));
    const rows = newOrganizationRows(store, LIST_INDEXES, ORG);
    const read = await allPages(rows, ApiResourceKind.session, SessionSchema, 3);
    expect([...read.ids].sort()).toEqual(mine);
    expect(read.pages).toBe(3);
  });

  it("pages a kind with no list index by keyset, past a full scan page", async () => {
    const mine = await saveAgents(ORG, 4);
    await saveAgents(OTHER, 520);
    const rows = newOrganizationRows(fx.store, LIST_INDEXES, ORG);
    const read = await allPages(rows, ApiResourceKind.agent, AgentSchema, 3);
    expect(read.ids).toEqual(mine);
    expect(read.pages).toBe(2);
  });

  it("refuses a kind metadata.org does not place, a limit that is not a positive integer, and a cursor it did not answer", async () => {
    const rows = newOrganizationRows(fx.store, LIST_INDEXES, ORG);
    await expect(
      rows.ids(ApiResourceKind.api_key, ApiKeySchema, { after: "", limit: 5 }),
    ).rejects.toThrow("does not name its organization in metadata.org");
    for (const limit of [0, -1, 1.5]) {
      for (const [kind, schema] of [
        [ApiResourceKind.session, SessionSchema],
        [ApiResourceKind.agent, AgentSchema],
      ] as const) {
        await expect(rows.ids(kind, schema, { after: "", limit })).rejects.toThrow(
          "a page's limit is a positive integer",
        );
      }
    }
    for (const after of ["agt_x", "{}", '{"createdAt":1,"id":"x"}']) {
      await expect(
        rows.ids(ApiResourceKind.session, SessionSchema, { after, limit: 5 }),
      ).rejects.toThrow("is not a page's `next`");
    }
  });

  it("answers an empty last page for an organization with no rows of the kind", async () => {
    await saveSessions(OTHER, 2);
    const rows = newOrganizationRows(fx.store, LIST_INDEXES, ORG);
    expect(
      await rows.ids(ApiResourceKind.session, SessionSchema, { after: "", limit: 10 }),
    ).toEqual({ ids: [], next: undefined });
    expect(
      await rows.ids(ApiResourceKind.agent, AgentSchema, { after: "", limit: 10 }),
    ).toEqual({ ids: [], next: undefined });
  });
});
