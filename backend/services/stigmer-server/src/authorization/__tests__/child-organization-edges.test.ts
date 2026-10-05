/**
 * Pins the parent and child organization edges the built-in evaluator
 * derives (model/child-organizations.ts) and the loader read behind the
 * reverse edge (derived-tuples.ts, `RowLoader.childOrganizations`),
 * against an in-memory store that counts its reads. The real-engine
 * derivation is pinned in derived-tuples.postgres.test.ts.
 *
 * What it pins:
 *   - `parent_org` derives nothing for a row that is not an organization,
 *     or for an organization with no parent;
 *   - `child_org` names every child the loader answers;
 *   - the loader reads one parent's children once per source, whatever the
 *     number of checks that ask, keeps only the rows that still name the
 *     parent, and reads nothing for an empty id.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { IamPolicyStore } from "../../domain/iampolicy/store.js";
import type { Store } from "../../store/interface.js";
import { newDerivedTupleSource } from "../derived-tuples.js";
import { childOrg, parentOrg } from "../model/child-organizations.js";
import type { RowLoader } from "../tuples.js";

const PARENT = { type: "organization", id: "org_p" };

function childRow(id: string, parentId: string) {
  return {
    id,
    data: toBinary(
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { id }, spec: { parentOrg: parentId } }),
    ),
  };
}

describe("the derived organization edges", () => {
  const loader: RowLoader = {
    load: () => Promise.resolve(undefined),
    childOrganizations: () => Promise.resolve(["org_c1", "org_c2"]),
  };

  it("derives no parent_org for a row that is not an organization, or for an organization with no parent", async () => {
    expect(await parentOrg(PARENT, create(AgentSchema), loader)).toEqual([]);
    expect(await parentOrg(PARENT, create(OrganizationSchema), loader)).toEqual([]);
    const child = create(OrganizationSchema, { spec: { parentOrg: "org_p" } });
    expect(await parentOrg({ type: "organization", id: "org_c1" }, child, loader)).toEqual([
      {
        object: { type: "organization", id: "org_c1" },
        relation: "parent_org",
        subject: { form: "object", object: PARENT },
      },
    ]);
  });

  it("derives child_org for every child the loader answers", async () => {
    const edges = await childOrg(PARENT, create(OrganizationSchema), loader);
    expect(edges.map((edge) => edge.subject)).toEqual([
      { form: "object", object: { type: "organization", id: "org_c1" } },
      { form: "object", object: { type: "organization", id: "org_c2" } },
    ]);
  });
});

describe("the loader's read of an organization's children", () => {
  it("reads one parent's children once per source, keeps only rows that still name it, and reads nothing for an empty id", async () => {
    let queries = 0;
    const store = {
      async queryResources() {
        queries += 1;
        return [childRow("org_c1", "org_p"), childRow("org_moved", "org_q")];
      },
    } as unknown as Store;
    const source = newDerivedTupleSource(
      {
        store,
        policies: {} as unknown as IamPolicyStore,
        accounts: { findById: () => Promise.resolve(undefined) },
      },
      { accountId: "acc_1", aliases: new Set(["acc_1"]) },
    );
    expect(await source.loader.childOrganizations("org_p")).toEqual(["org_c1"]);
    expect(await source.loader.childOrganizations("org_p")).toEqual(["org_c1"]);
    expect(queries).toBe(1);
    expect(await source.loader.childOrganizations("")).toEqual([]);
    expect(queries).toBe(1);
  });
});
