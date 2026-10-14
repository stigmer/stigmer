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
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import type { Grant } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import {
  ApiResourceRefSchema,
  GrantSpecSchema,
  type GrantSpec,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import { createLogger } from "@stigmer/server";

import { reconcileOwnerRows, revokeOwnerRows } from "../owner-rows.js";
import type { OwnerRowKind } from "../owner-rows.js";

function grant(
  principal: { kind: string; id: string },
  relation: string,
  resource: { kind: string; id: string },
): Grant {
  return create(GrantSchema, {
    spec: create(GrantSpecSchema, {
      principal: create(ApiResourceRefSchema, principal),
      relation,
      resource: create(ApiResourceRefSchema, resource),
    }),
  });
}

/** A policy table, read by kind and relation, and a grant path whose `delete` removes from it. */
function rig(
  table: Grant[],
  options: {
    readonly failDeletesFor?: ReadonlySet<string>;
    readonly failReadsFor?: ReadonlySet<string>;
  } = {},
) {
  const deleted: GrantSpec[] = [];
  const read: Array<{ kind: string; relation: string }> = [];
  const logged: Array<Record<string, unknown>> = [];
  const deps = {
    grantStore: {
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
    grants: {
      delete: (spec: GrantSpec) => {
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
        return Promise.resolve(create(GrantSchema, { spec }));
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

const PROVIDER = { kind: "federation_issuer", id: "fis_a" };
const CHANNEL_APP = { kind: "channel_app", id: "cha_a" };

const ALL_NO_OWNER_KINDS: ReadonlyArray<OwnerRowKind> = [
  { kind: ApiResourceKind.federation_issuer, key: "federation-issuer", idField: "provider" },
  { kind: ApiResourceKind.invitation, key: "invitation", idField: "invitation" },
  { kind: ApiResourceKind.channel_app, key: "channel-app", idField: "app" },
  { kind: ApiResourceKind.oauth_app, key: "oauth-app", idField: "app" },
];

describe("revokeOwnerRows", () => {
  it("reads the kind's owner rows once and revokes each through the grant path, moving nothing else", async () => {
    const table = [
      grant({ kind: "organization", id: "acme" }, "organization", PROVIDER),
      grant({ kind: "identity_account", id: "ida_carol" }, "owner", PROVIDER),
      grant({ kind: "identity_account", id: "ida_granted" }, "owner", PROVIDER),
      grant({ kind: "identity_account", id: "ida_vince" }, "viewer", PROVIDER),
      grant({ kind: "identity_account", id: "ida_carol" }, "creator", PROVIDER),
      grant({ kind: "identity_account", id: "ida_carol" }, "owner", CHANNEL_APP),
    ];
    const r = rig(table);

    const report = await revokeOwnerRows(ApiResourceKind.federation_issuer, r.deps);

    expect(r.read).toEqual([{ kind: "federation_issuer", relation: "owner" }]);
    expect(r.deleted.map((spec) => spec.principal?.id)).toEqual(["ida_carol", "ida_granted"]);
    expect(report).toEqual({
      revoked: [
        { id: "fis_a", accountId: "ida_carol" },
        { id: "fis_a", accountId: "ida_granted" },
      ],
      failures: [],
    });
    expect(table.map((row) => `${row.spec?.resource?.kind}#${row.spec?.relation}`)).toEqual([
      "federation_issuer#organization",
      "federation_issuer#viewer",
      "federation_issuer#creator",
      "channel_app#owner",
    ]);
  });

  it("revokes nothing on a second run", async () => {
    const r = rig([grant({ kind: "identity_account", id: "ida_carol" }, "owner", CHANNEL_APP)]);

    const first = await revokeOwnerRows(ApiResourceKind.channel_app, r.deps);
    const second = await revokeOwnerRows(ApiResourceKind.channel_app, r.deps);

    expect(first.revoked).toEqual([{ id: "cha_a", accountId: "ida_carol" }]);
    expect(second).toEqual({ revoked: [], failures: [] });
  });

  it("reports one row's failure and revokes the rest", async () => {
    const r = rig(
      [
        grant({ kind: "identity_account", id: "ida_carol" }, "owner", CHANNEL_APP),
        grant({ kind: "identity_account", id: "ida_dan" }, "owner", { kind: "channel_app", id: "cha_b" }),
      ],
      { failDeletesFor: new Set(["cha_a"]) },
    );

    const report = await revokeOwnerRows(ApiResourceKind.channel_app, r.deps);

    expect(report.failures).toEqual([{ id: "cha_a", error: "engine down" }]);
    expect(report.revoked).toEqual([{ id: "cha_b", accountId: "ida_dan" }]);
  });
});

describe("reconcileOwnerRows", () => {
  it("revokes every no-owner kind's owner rows in order and logs each under the kind's own words", async () => {
    const r = rig([
      grant({ kind: "identity_account", id: "ida_carol" }, "owner", PROVIDER),
      grant({ kind: "identity_account", id: "ida_carl" }, "owner", { kind: "invitation", id: "inv_1" }),
      grant({ kind: "identity_account", id: "ida_dan" }, "owner", CHANNEL_APP),
      grant({ kind: "identity_account", id: "ida_erin" }, "owner", { kind: "oauth_app", id: "oapp_a" }),
      grant({ kind: "identity_account", id: "ida_vince" }, "viewer", CHANNEL_APP),
    ]);

    await reconcileOwnerRows(ALL_NO_OWNER_KINDS, r.deps);

    expect(r.read.map((entry) => entry.kind)).toEqual([
      "federation_issuer",
      "invitation",
      "channel_app",
      "oauth_app",
    ]);
    expect(r.deleted.map((spec) => `${spec.resource?.kind}:${spec.resource?.id}@${spec.principal?.id}`)).toEqual([
      "federation_issuer:fis_a@ida_carol",
      "invitation:inv_1@ida_carl",
      "channel_app:cha_a@ida_dan",
      "oauth_app:oapp_a@ida_erin",
    ]);
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        message: "channel-app owner row revoked; its organization's admins manage it",
        app: "cha_a",
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
        grant({ kind: "identity_account", id: "ida_dan" }, "owner", CHANNEL_APP),
        grant({ kind: "identity_account", id: "ida_erin" }, "owner", { kind: "oauth_app", id: "oapp_a" }),
      ],
      { failReadsFor: new Set(["channel_app"]) },
    );

    await reconcileOwnerRows(ALL_NO_OWNER_KINDS, r.deps);

    expect(r.deleted.map((spec) => spec.resource?.id)).toEqual(["oapp_a"]);
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "channel-app owner-row reconcile failed",
        error: "store down",
      }),
    );
  });
});
