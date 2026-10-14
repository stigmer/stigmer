/**
 * The operator's list of who may create an organization
 * (editions/organization-creators.ts), run over a request context the way
 * the library's organization create chain hands one to
 * `org-create:pre-side-effect-gate`:
 *
 *   - a listed account creates; an unlisted one is refused with
 *     PERMISSION_DENIED, `ORGANIZATION_CREATOR_NOT_LISTED`, its own account
 *     id as metadata and in the copy;
 *   - a caller of the operator's lane with no account yet carries its
 *     subject, and is judged by the id derived from it, admitted or
 *     refused naming that id;
 *   - the server acting as itself creates;
 *   - a child organization is not judged, read from the built state: a
 *     request naming a parent the state does not carry is judged as
 *     top-level;
 *   - the account-id shape the reader and the step share.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { CallerIdentity } from "@stigmer/server";
import { accountIdFor, RequestContext } from "@stigmer/server";

import {
  creatorNotListedMessage,
  isAccountId,
  newOrganizationCreatorsStep,
  ORGANIZATION_CREATOR_NOT_LISTED,
  ORGANIZATION_CREATORS_STEP,
} from "../organization-creators.js";

const LISTED = accountIdFor("auth0|listed");
const UNLISTED = accountIdFor("auth0|unlisted");
const step = newOrganizationCreatorsStep(new Set([LISTED]));

function person(identityId: string): CallerIdentity {
  return { identityId, callerClass: "user", issuer: "https://sso.acme.example", rawToken: "t" };
}

/** A create's context; `parentOrg` sets the request, `builtParent` the state the chain built from it. */
function creating(
  caller: CallerIdentity,
  parentOrg = "",
  builtParent = parentOrg,
): RequestContext<typeof OrganizationSchema> {
  const ctx = new RequestContext(
    OrganizationSchema,
    create(OrganizationSchema, { metadata: { slug: "acme" }, spec: { parentOrg } }),
    caller,
    ApiResourceKind.organization,
  );
  const built = create(OrganizationSchema, { metadata: { slug: "acme" }, spec: { parentOrg: builtParent } });
  ctx.setNewState(built);
  return ctx;
}

async function refusalOf(run: Promise<void>): Promise<ConnectError> {
  try {
    await run;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the step to refuse");
}

describe("OrganizationCreators", () => {
  it("is named for the slot's registration", () => {
    expect(step.name).toBe(ORGANIZATION_CREATORS_STEP);
  });

  it("admits a listed account", async () => {
    await expect(step.execute(creating(person(LISTED)))).resolves.toBeUndefined();
  });

  it("refuses an unlisted account with the reason and its own account id", async () => {
    const error = await refusalOf(step.execute(creating(person(UNLISTED))));
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(creatorNotListedMessage(UNLISTED));
    expect(error.rawMessage).toContain(`yours (${UNLISTED})`);
    expect(error.rawMessage).toContain("ask one of its admins to invite you");
    const [info] = error.findDetails(ErrorInfoSchema);
    expect(info?.reason).toBe(ORGANIZATION_CREATOR_NOT_LISTED);
    expect(info?.domain).toBe("stigmer.ai");
    expect(info?.metadata).toEqual({ account: UNLISTED });
  });

  it("judges a caller with no account yet by the id its subject derives", async () => {
    await expect(step.execute(creating(person("auth0|listed")))).resolves.toBeUndefined();
    const error = await refusalOf(step.execute(creating(person("auth0|unlisted"))));
    expect(error.findDetails(ErrorInfoSchema)[0]?.metadata).toEqual({ account: UNLISTED });
  });

  it("admits the server acting as itself", async () => {
    const internal: CallerIdentity = { identityId: "system", callerClass: "internal", issuer: "", rawToken: "" };
    await expect(step.execute(creating(internal))).resolves.toBeUndefined();
  });

  it("admits a child organization, whose parent's admins already decided", async () => {
    await expect(step.execute(creating(person(UNLISTED), "org_parent"))).resolves.toBeUndefined();
  });

  it("judges by the built state: a parent only the request names is a top-level create", async () => {
    const error = await refusalOf(step.execute(creating(person(UNLISTED), "org_parent", "")));
    expect(error.findDetails(ErrorInfoSchema)[0]?.reason).toBe(ORGANIZATION_CREATOR_NOT_LISTED);
  });
});

describe("isAccountId", () => {
  it("accepts the shape accountIdFor produces", () => {
    expect(isAccountId(LISTED)).toBe(true);
  });

  it.each(["ida_", `${LISTED}x`, LISTED.toUpperCase(), "auth0|listed", `org_${LISTED.slice(4)}`])(
    "refuses %j",
    (value) => {
      expect(isAccountId(value)).toBe(false);
    },
  );
});
