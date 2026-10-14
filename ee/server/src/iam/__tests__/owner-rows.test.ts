/**
 * The owner-row reconcile over fakes of the policy table and the grant
 * path. Pins:
 *   - one read per kind, by kind and relation (`owner`), and every row it
 *     answers goes through the grant path's `delete` with the row's own
 *     spec, each reported with the resource and the account it named;
 *   - nothing else moves: an organization link, a `viewer` grant and a
 *     `creator` row stay, and another kind's owner row is not this
 *     kind's to revoke;
 *   - a second run revokes nothing;
 *   - one row's failure is reported while the rest are revoked;
 *   - the boot run covers every kind it is handed, the four no-owner kinds
 *     included, logs each revoked row under the kind's own words, and a
 *     kind whose read fails is logged while the next kind still runs.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import {
  ApiResourceRefSchema,
  IamPolicySpecSchema,
  type IamPolicySpec,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { createLogger } from "@stigmer/server";

import { reconcileOwnerRows, revokeOwnerRows } from "../owner-rows.js";
import type { OwnerRowKind } from "../owner-rows.js";

function policy(
  principal: { kind: string; id: string },
  relation: string,
  resource: { kind: string; id: string },
): IamPolicy {
  return create(IamPolicySchema, {
    spec: create(IamPolicySpecSchema, {
      principal: create(ApiResourceRefSchema, principal),
      relation,
      resource: create(ApiResourceRefSchema, resource),
    }),
  });
}

/** A policy table, read by kind and relation, and a grant path whose `delete` removes from it. */
function rig(
  table: IamPolicy[],
  options: {
    readonly failDeletesFor?: ReadonlySet<string>;
    readonly failReadsFor?: ReadonlySet<string>;
  } = {},
) {
  const deleted: IamPolicySpec[] = [];
  const read: Array<{ kind: string; relation: string }> = [];
  const logged: Array<Record<string, unknown>> = [];
  const deps = {
    policyStore: {
      findByResourceKindAndRelation: (kind: string, relation: string) => {
        read.push({ kind, relation });
        if (options.failReadsFor?.has(kind) === true) {
          return Promise.reject(new Error("store down"));
        }
        return Promise.resolve(
          table.filter((row) => row.spec?.resource?.kind === kind && row.spec?.relation === relation),
        );
      },
    },
    policies: {
      delete: (spec: IamPolicySpec) => {
        if (options.failDeletesFor?.has(spec.resource?.id ?? "") === true) {
          return Promise.reject(new Error("engine down"));
        }
        deleted.push(spec);
        const at = table.findIndex(
          (row) =>
            row.spec?.resource?.kind === spec.resource?.kind &&
            row.spec?.resource?.id === spec.resource?.id &&
            row.spec?.relation === spec.relation &&
            row.spec?.principal?.id === spec.principal?.id,
        );
        if (at >= 0) {
          table.splice(at, 1);
        }
        return Promise.resolve(create(IamPolicySchema, { spec }));
      },
    },
    logger: createLogger({
      level: "info",
      pretty: false,
      write: (line: string) => {
        logged.push(JSON.parse(line) as Record<string, unknown>);
      },
    }),
  };
  return { deps, deleted, read, logged };
}

const PROVIDER = { kind: "identity_provider", id: "idp_a" };
const CLIENT = { kind: "platform_client", id: "pcl_a" };

const ALL_NO_OWNER_KINDS: ReadonlyArray<OwnerRowKind> = [
  { kind: ApiResourceKind.federation_issuer, key: "identity-provider", idField: "provider" },
  { kind: ApiResourceKind.invitation, key: "invitation", idField: "invitation" },
  { kind: ApiResourceKind.platform_client, key: "platform-client", idField: "client" },
  { kind: ApiResourceKind.oauth_app, key: "oauth-app", idField: "app" },
];

describe("revokeOwnerRows", () => {
  it("reads the kind's owner rows once and revokes each through the grant path, moving nothing else", async () => {
    const table = [
      policy({ kind: "organization", id: "acme" }, "organization", PROVIDER),
      policy({ kind: "identity_account", id: "ida_carol" }, "owner", PROVIDER),
      policy({ kind: "identity_account", id: "ida_granted" }, "owner", PROVIDER),
      policy({ kind: "identity_account", id: "ida_vince" }, "viewer", PROVIDER),
      policy({ kind: "identity_account", id: "ida_carol" }, "creator", PROVIDER),
      policy({ kind: "identity_account", id: "ida_carol" }, "owner", CLIENT),
    ];
    const r = rig(table);

    const report = await revokeOwnerRows(ApiResourceKind.federation_issuer, r.deps);

    expect(r.read).toEqual([{ kind: "identity_provider", relation: "owner" }]);
    expect(r.deleted.map((spec) => spec.principal?.id)).toEqual(["ida_carol", "ida_granted"]);
    expect(report).toEqual({
      revoked: [
        { id: "idp_a", accountId: "ida_carol" },
        { id: "idp_a", accountId: "ida_granted" },
      ],
      failures: [],
    });
    expect(table.map((row) => `${row.spec?.resource?.kind}#${row.spec?.relation}`)).toEqual([
      "identity_provider#organization",
      "identity_provider#viewer",
      "identity_provider#creator",
      "platform_client#owner",
    ]);
  });

  it("revokes nothing on a second run", async () => {
    const r = rig([policy({ kind: "identity_account", id: "ida_carol" }, "owner", CLIENT)]);

    const first = await revokeOwnerRows(ApiResourceKind.platform_client, r.deps);
    const second = await revokeOwnerRows(ApiResourceKind.platform_client, r.deps);

    expect(first.revoked).toEqual([{ id: "pcl_a", accountId: "ida_carol" }]);
    expect(second).toEqual({ revoked: [], failures: [] });
  });

  it("reports one row's failure and revokes the rest", async () => {
    const r = rig(
      [
        policy({ kind: "identity_account", id: "ida_carol" }, "owner", CLIENT),
        policy({ kind: "identity_account", id: "ida_dan" }, "owner", { kind: "platform_client", id: "pcl_b" }),
      ],
      { failDeletesFor: new Set(["pcl_a"]) },
    );

    const report = await revokeOwnerRows(ApiResourceKind.platform_client, r.deps);

    expect(report.failures).toEqual([{ id: "pcl_a", error: "engine down" }]);
    expect(report.revoked).toEqual([{ id: "pcl_b", accountId: "ida_dan" }]);
  });
});

describe("reconcileOwnerRows", () => {
  it("revokes every no-owner kind's owner rows in order and logs each under the kind's own words", async () => {
    const r = rig([
      policy({ kind: "identity_account", id: "ida_carol" }, "owner", PROVIDER),
      policy({ kind: "identity_account", id: "ida_carl" }, "owner", { kind: "invitation", id: "inv_1" }),
      policy({ kind: "identity_account", id: "ida_dan" }, "owner", CLIENT),
      policy({ kind: "identity_account", id: "ida_erin" }, "owner", { kind: "oauth_app", id: "oapp_a" }),
      policy({ kind: "identity_account", id: "ida_vince" }, "viewer", CLIENT),
    ]);

    await reconcileOwnerRows(ALL_NO_OWNER_KINDS, r.deps);

    expect(r.read.map((entry) => entry.kind)).toEqual([
      "identity_provider",
      "invitation",
      "platform_client",
      "oauth_app",
    ]);
    expect(r.deleted.map((spec) => `${spec.resource?.kind}:${spec.resource?.id}@${spec.principal?.id}`)).toEqual([
      "identity_provider:idp_a@ida_carol",
      "invitation:inv_1@ida_carl",
      "platform_client:pcl_a@ida_dan",
      "oauth_app:oapp_a@ida_erin",
    ]);
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        message: "platform-client owner row revoked; its organization's admins manage it",
        client: "pcl_a",
        account: "ida_dan",
      }),
    );
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        message: "oauth-app owner row revoked; its organization's admins manage it",
        app: "oapp_a",
        account: "ida_erin",
      }),
    );
  });

  it("logs a kind whose read fails and still runs the next kind", async () => {
    const r = rig(
      [
        policy({ kind: "identity_account", id: "ida_dan" }, "owner", CLIENT),
        policy({ kind: "identity_account", id: "ida_erin" }, "owner", { kind: "oauth_app", id: "oapp_a" }),
      ],
      { failReadsFor: new Set(["platform_client"]) },
    );

    await reconcileOwnerRows(ALL_NO_OWNER_KINDS, r.deps);

    expect(r.deleted.map((spec) => spec.resource?.id)).toEqual(["oapp_a"]);
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "platform-client owner-row reconcile failed",
        error: "store down",
      }),
    );
  });
});
