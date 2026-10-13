/**
 * Pins the Enterprise identity domain's step on `org-delete:pre-delete`
 * (iam/organization-delete.ts), run over a request context the way the
 * library's organization delete chain hands it over: the loaded
 * organization under EXISTING_RESOURCE_KEY.
 *
 *   - RemoveOrganizationIdentity removes the teams, the providers and the
 *     invitations, in that order; the first removal that throws stops it
 *     with Internal and fixed copy, and nothing after it runs;
 *   - it refuses to guess an organization it was not handed;
 *   - the `identity` purge stage runs the same three removals in the same
 *     order for the organization being purged, acting for the purge,
 *     declares the provider, team and invitation kinds, answers no more
 *     work, and throws the first removal's fault.
 *
 * A parent with children never reaches the slot: the library refuses its
 * delete first, which the composed suite pins.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationIdSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import type { CallerIdentity } from "@stigmer/server";
import { createLogger, EXISTING_RESOURCE_KEY, RequestContext } from "@stigmer/server";

import {
  IDENTITY_PURGE_STAGE,
  newOrganizationIdentityPurgeStage,
  newRemoveOrganizationIdentityStep,
  ORGANIZATION_IDENTITY_REMOVAL_FAILED,
} from "../organization-delete.js";
import { noRows } from "../../__test-utils__/purge-rows.js";

const OWNER: CallerIdentity = {
  identityId: "ida_owner",
  callerClass: "user",
  issuer: "https://issuer.test",
  rawToken: "",
};

/** The organization delete's request context after LoadExistingForDelete; `slug` defaults to the id. */
function deleting(org: string | undefined, slug = org): RequestContext<typeof OrganizationIdSchema> {
  const ctx = new RequestContext(
    OrganizationIdSchema,
    create(OrganizationIdSchema, { value: org ?? "" }),
    OWNER,
    ApiResourceKind.organization,
  );
  if (org !== undefined) {
    ctx.set(EXISTING_RESOURCE_KEY, create(OrganizationSchema, { metadata: { id: org, slug } }));
  }
  return ctx;
}

async function refusalOf(run: Promise<void> | void): Promise<ConnectError> {
  try {
    await run;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the step to refuse");
}

describe("RemoveOrganizationIdentity", () => {
  function removal(failAt?: string) {
    const order: string[] = [];
    const arm = (name: string) => ({
      removeByOrgId: (org: string): Promise<void> => {
        order.push(`${name}:${org}`);
        return name === failAt ? Promise.reject(new Error(`${name} store down`)) : Promise.resolve();
      },
    });
    const step = newRemoveOrganizationIdentityStep({
      teams: arm("teams"),
      providers: arm("providers"),
      invitations: arm("invitations"),
    });
    return { order, step };
  }

  it("removes the teams, then the providers and the invitations", async () => {
    const r = removal();
    await r.step.execute(deleting("acme"));
    expect(r.order).toEqual([
      "teams:acme",
      "providers:acme",
      "invitations:acme",
    ]);
  });

  it("stops at the first removal that fails, with Internal and fixed copy, and runs nothing after it", async () => {
    const r = removal("providers");
    const refused = await refusalOf(r.step.execute(deleting("acme")));
    expect(refused.code).toBe(Code.Internal);
    expect(refused.rawMessage).toBe(ORGANIZATION_IDENTITY_REMOVAL_FAILED);
    expect(r.order).toEqual(["teams:acme", "providers:acme"]);
  });

  it("refuses to run without the loaded organization", async () => {
    const r = removal();
    const refused = await refusalOf(r.step.execute(deleting(undefined)));
    expect(refused.code).toBe(Code.Internal);
    expect(r.order).toEqual([]);
  });
});

describe("the identity purge stage", () => {
  const PURGE: CallerIdentity = {
    identityId: "organization-purge",
    callerClass: "internal",
    issuer: "",
    rawToken: "",
  };
  const silent = createLogger({ level: "error", pretty: false, write: () => {} });

  function removals(calls: string[], failing?: string) {
    const removal = (name: string) => ({
      removeByOrgId: (org: string, actingFor: string) => {
        calls.push(`${name}:${org}:${actingFor}`);
        return name === failing ? Promise.reject(new Error(`${name} store down`)) : Promise.resolve();
      },
    });
    return {
      teams: removal("teams"),
      providers: removal("providers"),
      invitations: removal("invitations"),
      signInGrants: {
        removeByOrgId: (org: string) => {
          calls.push(`sign-in grants:${org}`);
          return failing === "sign-in grants" ? Promise.reject(new Error("ledger down")) : Promise.resolve(2);
        },
      },
      accessMoves: {
        removeByOrgId: (org: string) => {
          calls.push(`access moves:${org}`);
          return Promise.resolve(0);
        },
      },
      logger: silent,
    };
  }

  it("removes the teams, providers, the sign-in grant ledger's rows, invitations and access move tickets of the organization being purged, as the purge", async () => {
    const calls: string[] = [];
    const stage = newOrganizationIdentityPurgeStage(removals(calls));
    expect(stage.name).toBe(IDENTITY_PURGE_STAGE);
    expect(stage.kinds).toEqual([
      ApiResourceKind.identity_provider,
      ApiResourceKind.team,
      ApiResourceKind.invitation,
    ]);
    const progress = await stage.run({
      org: { id: "org_acme", parentOrg: "" },
      logger: silent,
      caller: PURGE,
      rows: noRows(),
    });
    expect(progress).toEqual({ more: false });
    expect(calls).toEqual([
      "teams:org_acme:organization-purge",
      "providers:org_acme:organization-purge",
      "sign-in grants:org_acme",
      "invitations:org_acme:organization-purge",
      "access moves:org_acme",
    ]);
  });

  it("throws a ledger fault, with the invitations not yet removed", async () => {
    const calls: string[] = [];
    const stage = newOrganizationIdentityPurgeStage(removals(calls, "sign-in grants"));
    await expect(
      stage.run({ org: { id: "org_acme", parentOrg: "" }, logger: silent, caller: PURGE, rows: noRows() }),
    ).rejects.toThrow("ledger down");
    expect(calls.at(-1)).toBe("sign-in grants:org_acme");
  });

  it("throws the first removal's fault, and nothing after it runs", async () => {
    const calls: string[] = [];
    const stage = newOrganizationIdentityPurgeStage(removals(calls, "providers"));
    await expect(
      stage.run({ org: { id: "org_acme", parentOrg: "" }, logger: silent, caller: PURGE, rows: noRows() }),
    ).rejects.toThrow("providers store down");
    expect(calls).toEqual(["teams:org_acme:organization-purge", "providers:org_acme:organization-purge"]);
  });
});
