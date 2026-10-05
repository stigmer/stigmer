/**
 * Pins RefuseBoundCredential (steps.ts), organization create's refusal of a
 * credential bound to one organization: such a credential works in its
 * organization only and never founds another, while a person speaking for
 * themselves (no binding, or a blank one) passes untouched. End to end, the
 * credential-binding conformance suite drives the same refusal with a
 * limited API key.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  BOUND_CREDENTIAL_CREATES_NO_ORGANIZATION_MESSAGE,
  newRefuseBoundCredentialStep,
} from "../steps.js";

const person: CallerIdentity = {
  identityId: "ida_alice",
  callerClass: "user",
  issuer: "",
  rawToken: "token",
};

function contextFor(
  caller: CallerIdentity,
): RequestContext<typeof OrganizationSchema> {
  return new RequestContext(
    OrganizationSchema,
    create(OrganizationSchema, {
      metadata: { name: "Globex", slug: "globex" },
    }),
    caller,
    ApiResourceKind.organization,
  );
}

describe("RefuseBoundCredential", () => {
  it("passes a caller that speaks for the person everywhere", async () => {
    await newRefuseBoundCredentialStep<typeof OrganizationSchema>().execute(
      contextFor(person),
    );
    await newRefuseBoundCredentialStep<typeof OrganizationSchema>().execute(
      contextFor({ ...person, boundOrg: "" }),
    );
  });

  it("refuses a credential bound to one organization", async () => {
    let refused: unknown;
    try {
      await newRefuseBoundCredentialStep<typeof OrganizationSchema>().execute(
        contextFor({ ...person, boundOrg: "org_acme" }),
      );
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(ConnectError);
    expect((refused as ConnectError).code).toBe(Code.PermissionDenied);
    expect((refused as ConnectError).rawMessage).toBe(
      BOUND_CREDENTIAL_CREATES_NO_ORGANIZATION_MESSAGE,
    );
  });
});
