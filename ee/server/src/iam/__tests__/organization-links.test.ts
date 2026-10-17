/**
 * The organization-link reconcile over fakes of the grant mirror, the
 * grant path and the organization lookup. Pins:
 *   - a row missing its link gets exactly `<kind>:<id>#organization@
 *     organization:<org>` through the structural lane, and a row that has
 *     it gets nothing;
 *   - only the exact triple counts as the link: an organization's row on
 *     another relation, or a link to another organization, does not;
 *   - it never resurrects: a row whose organization is gone, whose slug
 *     now belongs to an organization created after the row, or which has
 *     no creation time of its own is reported and not linked; an
 *     organization with no recorded creation time is the original, and
 *     is linked;
 *   - each organization is looked up once, and one row's failure is
 *     reported while the rest converge;
 *   - an invitation, the second kind the boot reconciles, is linked by
 *     the same rule under its own kind name;
 *   - the in-process lookup answers a missing organization as none, and
 *     any other refusal as a fresh error with the same code and copy and
 *     none of the inner response's metadata (the library's
 *     `rethrownStatusError`).
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import type { Grant } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import {
  ApiResourceRefSchema,
  GrantSpecSchema,
  type GrantSpec,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import {
  InvitationSchema,
  InvitationStatusSchema,
} from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";

import { storedIssuer } from "../issuer/__tests__/in-memory-issuer-store.js";
import {
  newInProcessOrganizationLookup,
  reconcileOrganizationLinks,
  type OrganizationFacts,
} from "../organization-links.js";

const ROW_CREATED = new Date("2026-09-22T10:00:00Z");

function grant(principal: { kind: string; id: string }, relation: string, providerId: string): Grant {
  return create(GrantSchema, {
    spec: create(GrantSpecSchema, {
      principal: create(ApiResourceRefSchema, principal),
      relation,
      resource: create(ApiResourceRefSchema, { kind: "federation_issuer", id: providerId }),
    }),
  });
}

function rig(options: {
  grants?: ReadonlyMap<string, ReadonlyArray<Grant>>;
  organizations?: ReadonlyMap<string, OrganizationFacts>;
  failWritesFor?: ReadonlySet<string>;
}) {
  const written: GrantSpec[] = [];
  const lookedUp: string[] = [];
  const deps = {
    grantStore: {
      findByResource: (_kind: string, id: string) => Promise.resolve(options.grants?.get(id) ?? []),
    },
    grants: {
      bootstrapGrant: (spec: GrantSpec) => {
        if (options.failWritesFor?.has(spec.resource?.id ?? "") === true) {
          return Promise.reject(new Error("engine down"));
        }
        written.push(spec);
        return Promise.resolve(create(GrantSchema, { spec }));
      },
    },
    organizations: {
      find: (orgId: string) => {
        lookedUp.push(orgId);
        return Promise.resolve(options.organizations?.get(orgId));
      },
    },
  };
  return { deps, written, lookedUp };
}

const live = (createdAt: Date | undefined): OrganizationFacts => ({
  createdAt,
  name: "",
  slug: "",
  parentOrg: "",
  logoUrl: "",
});

describe("reconcileOrganizationLinks", () => {
  it("writes exactly the organization link for a row missing it, and nothing for a row that has it", async () => {
    const r = rig({
      grants: new Map([
        ["fis_linked", [grant({ kind: "organization", id: "acme" }, "organization", "fis_linked")]],
      ]),
      organizations: new Map([["acme", live(new Date("2026-01-01T00:00:00Z"))]]),
    });

    const report = await reconcileOrganizationLinks(
      ApiResourceKind.federation_issuer,
      [
        storedIssuer({ id: "fis_linked", org: "acme", slug: "linked", createdAt: ROW_CREATED }),
        storedIssuer({ id: "fis_bare", org: "acme", slug: "bare", createdAt: ROW_CREATED }),
      ],
      r.deps,
    );

    expect(report).toEqual({ converged: 1, orphaned: [], failures: [] });
    expect(r.written).toEqual([
      create(GrantSpecSchema, {
        principal: create(ApiResourceRefSchema, { kind: "organization", id: "acme" }),
        relation: "organization",
        resource: create(ApiResourceRefSchema, { kind: "federation_issuer", id: "fis_bare" }),
      }),
    ]);
  });

  it("counts only the exact triple as the link, never an organization's row on another relation or another organization's link", async () => {
    const r = rig({
      grants: new Map([
        [
          "fis_platform",
          [
            grant({ kind: "organization", id: "tenant" }, "viewer", "fis_platform"),
            grant({ kind: "organization", id: "elsewhere" }, "organization", "fis_platform"),
          ],
        ],
      ]),
      organizations: new Map([["acme", live(new Date("2026-01-01T00:00:00Z"))]]),
    });

    const report = await reconcileOrganizationLinks(
      ApiResourceKind.federation_issuer,
      [storedIssuer({ id: "fis_platform", org: "acme", slug: "platform", createdAt: ROW_CREATED })],
      r.deps,
    );

    expect(report.converged).toBe(1);
    expect(r.written[0]?.principal?.id).toBe("acme");
  });

  it("never re-links a row whose organization is gone, was re-created after it, or when the row has no creation time", async () => {
    const r = rig({
      organizations: new Map([
        ["recreated", live(new Date("2026-09-23T00:00:00Z"))],
        ["acme", live(new Date("2026-01-01T00:00:00Z"))],
      ]),
    });
    const undated = storedIssuer({ id: "fis_undated", org: "acme", slug: "undated" });
    undated.status = undefined;

    const report = await reconcileOrganizationLinks(
      ApiResourceKind.federation_issuer,
      [
        storedIssuer({ id: "fis_gone", org: "deleted", slug: "gone", createdAt: ROW_CREATED }),
        storedIssuer({ id: "fis_old", org: "recreated", slug: "old", createdAt: ROW_CREATED }),
        undated,
        storedIssuer({ id: "fis_orgless", org: "", slug: "orgless", createdAt: ROW_CREATED }),
      ],
      r.deps,
    );

    expect(report.converged).toBe(0);
    expect(report.orphaned).toEqual([
      { id: "fis_gone", org: "deleted", reason: "organization-gone" },
      { id: "fis_old", org: "recreated", reason: "organization-recreated" },
      { id: "fis_undated", org: "acme", reason: "row-has-no-creation-time" },
      { id: "fis_orgless", org: "", reason: "row-has-no-organization" },
    ]);
    expect(r.written).toEqual([]);
  });

  it("links a row to an organization with no recorded creation time, and to one created no later than the row", async () => {
    const r = rig({
      organizations: new Map([
        ["legacy", live(undefined)],
        ["sametime", live(ROW_CREATED)],
      ]),
    });

    const report = await reconcileOrganizationLinks(
      ApiResourceKind.federation_issuer,
      [
        storedIssuer({ id: "fis_legacy", org: "legacy", slug: "legacy", createdAt: ROW_CREATED }),
        storedIssuer({ id: "fis_same", org: "sametime", slug: "same", createdAt: ROW_CREATED }),
      ],
      r.deps,
    );

    expect(report).toEqual({ converged: 2, orphaned: [], failures: [] });
  });

  it("looks each organization up once, and reports one row's failure while the rest converge", async () => {
    const r = rig({
      organizations: new Map([["acme", live(new Date("2026-01-01T00:00:00Z"))]]),
      failWritesFor: new Set(["fis_b"]),
    });

    const report = await reconcileOrganizationLinks(
      ApiResourceKind.federation_issuer,
      [
        storedIssuer({ id: "fis_a", org: "acme", slug: "a", createdAt: ROW_CREATED }),
        storedIssuer({ id: "fis_b", org: "acme", slug: "b", createdAt: ROW_CREATED }),
        storedIssuer({ id: "fis_c", org: "acme", slug: "c", createdAt: ROW_CREATED }),
      ],
      r.deps,
    );

    expect(report.converged).toBe(2);
    expect(report.failures).toEqual([{ id: "fis_b", error: "engine down" }]);
    expect(r.lookedUp).toEqual(["acme"]);
  });
  it("links an invitation, the second kind the boot reconciles, by the same rule under its own kind name", async () => {
    const r = rig({
      organizations: new Map([
        ["acme", live(new Date("2026-01-01T00:00:00Z"))],
        ["recreated", live(new Date("2026-09-25T00:00:00Z"))],
      ]),
    });
    const invitation = (id: string, org: string) => {
      const createdAt = timestampFromDate(ROW_CREATED);
      return create(InvitationSchema, {
        metadata: create(ApiResourceMetadataSchema, { id, org }),
        status: create(InvitationStatusSchema, {
          token: `token-${id}`,
          audit: create(ApiResourceAuditSchema, {
            specAudit: create(ApiResourceAuditInfoSchema, { createdAt }),
          }),
        }),
      });
    };

    const report = await reconcileOrganizationLinks(
      ApiResourceKind.invitation,
      [invitation("inv_live", "acme"), invitation("inv_old", "recreated")],
      r.deps,
    );

    expect(report.converged).toBe(1);
    expect(report.orphaned).toEqual([
      { id: "inv_old", org: "recreated", reason: "organization-recreated" },
    ]);
    expect(r.written.map((spec) => spec.resource)).toEqual([
      create(ApiResourceRefSchema, { kind: "invitation", id: "inv_live" }),
    ]);
  });
});

describe("the in-process organization lookup", () => {
  function lookupRefusing(refusal: ConnectError) {
    return newInProcessOrganizationLookup({
      transport: createRouterTransport((router) => {
        router.service(OrganizationQueryController, {
          get: () => {
            throw refusal;
          },
        });
      }),
    });
  }

  it("answers a missing organization as none", async () => {
    const lookup = lookupRefusing(new ConnectError("Organization not found: org_gone", Code.NotFound));
    expect(await lookup.find("org_gone")).toBeUndefined();
  });

  it("rethrows any other refusal as a fresh error with the same code and copy, carrying none of the inner metadata", async () => {
    const refusal = new ConnectError("store unavailable", Code.Internal, new Headers({ "x-inner": "1" }));
    const caught = await lookupRefusing(refusal)
      .find("org_any")
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(caught).toBeInstanceOf(ConnectError);
    expect((caught as ConnectError).code).toBe(Code.Internal);
    expect((caught as ConnectError).rawMessage).toBe("store unavailable");
    expect([...(caught as ConnectError).metadata.keys()], "no inner response metadata rides out").toEqual([]);
  });
});
