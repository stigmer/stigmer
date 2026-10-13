/**
 * Pins the organization census (organization-census.ts) on SQLite, whose
 * catalogue it reads:
 *   - every table a fresh store creates is classified;
 *   - a table a later migration adds fails the census until it is;
 *   - an id is found in a plain column, in a value column, and anywhere
 *     inside a stored resource (a reference deep in its spec), and not
 *     found once the row is gone;
 *   - a table kept on purpose (the permission history) is not read, so its
 *     entries outlive the rows they record.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { SqliteStore } from "../sqlite/store.js";
import {
  organizationCensus,
  sqliteCensusReader,
  unclassifiedTables,
} from "./organization-census.js";

let dir: string;
let store: SqliteStore;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "census-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  db = new DatabaseSync(path.join(dir, "stigmer.db"));
});

afterEach(async () => {
  db.close();
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the organization census", () => {
  it("classifies every table a fresh store creates, and refuses one it does not know", async () => {
    const reader = sqliteCensusReader(db);
    expect(await unclassifiedTables(reader)).toEqual([]);
    db.exec(`CREATE TABLE later_feature (org TEXT)`);
    expect(await unclassifiedTables(reader)).toEqual(["later_feature"]);
    await expect(organizationCensus(reader, new Set(["org_a"]))).rejects.toThrow(
      "later_feature",
    );
  });

  it("finds an id in a column and deep inside a stored resource, and nothing once the rows are gone", async () => {
    await store.pendingOAuthStates.save({
      state: "state-1",
      codeVerifier: "enc:v1:sealed",
      clientId: "client-1",
      clientSecret: "",
      tokenEndpoint: "https://example.test/token",
      identityAccountId: "ida_1",
      authMethod: "mcp_oauth",
      tokenAuthMethod: "",
      redirectUri: "http://127.0.0.1/cb",
      org: "org_a",
      vaultId: "",
      address: "",
      loginApp: "",
      resource: "",
      clientRegistration: "",
      connectLink: "",
      providerName: "",
      userinfoUrl: "",
      createdAt: 0,
    });
    await store.saveResource(
      ApiResourceKind.agent_share,
      "shr_1",
      AgentShareSchema,
      create(AgentShareSchema, {
        metadata: { id: "shr_1", org: "org_b" },
        spec: { agentRef: { kind: ApiResourceKind.agent, slug: "agt_deep" } },
      }),
    );
    const reader = sqliteCensusReader(db);
    const found = await organizationCensus(reader, new Set(["org_a", "agt_deep"]));
    expect(found.map((finding) => [finding.table, finding.id]).sort()).toEqual([
      ["pending_oauth_state", "org_a"],
      ["resources", "agt_deep"],
    ]);
    await store.pendingOAuthStates.deleteByOrg("org_a");
    await store.deleteResource(ApiResourceKind.agent_share, "shr_1");
    expect(await organizationCensus(reader, new Set(["org_a", "agt_deep"]))).toEqual([]);
  });

  it("does not read a table kept on purpose: the permission history outlives the rows it records", async () => {
    const change = { cause: "grant", actorId: "ida_1", actorClass: "user", org: "org_a" };
    await store.insertResource(
      ApiResourceKind.iam_policy,
      "iamp_1",
      IamPolicySchema,
      create(IamPolicySchema, {
        metadata: { id: "iamp_1" },
        spec: {
          principal: { kind: "identity_account", id: "ida_2" },
          relation: "member",
          resource: { kind: "organization", id: "org_a" },
        },
      }),
      change,
    );
    const reader = sqliteCensusReader(db);
    expect(
      (await organizationCensus(reader, new Set(["org_a"]))).map((finding) => finding.table),
    ).toEqual(["resources"]);
    await store.deleteResource(ApiResourceKind.iam_policy, "iamp_1", { ...change, cause: "resource_deleted" });
    expect(await organizationCensus(reader, new Set(["org_a"]))).toEqual([]);
    expect(
      (db.prepare(`SELECT COUNT(*) AS count FROM iam_policy_history WHERE org = 'org_a'`).get() as {
        count: number;
      }).count,
    ).toBe(2);
  });
});
