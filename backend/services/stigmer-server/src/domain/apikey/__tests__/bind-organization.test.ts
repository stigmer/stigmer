/**
 * Pins BindApiKeyOrganization and the key's organization on update, the
 * two halves of an API key's limit to one organization (steps.ts):
 *   - an unbound caller's key with no organization asks nothing;
 *   - a limited key asks the owner's can_view on its organization, and a
 *     denial or a missing organization answers the same PERMISSION_DENIED,
 *     so a create never tells which organization ids exist;
 *   - a caller bound to one organization fills an empty organization with
 *     its own and is refused any other, before the Authorizer is asked;
 *   - an update keeps the stored organization, so a limited key cannot
 *     free itself.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import {
  API_KEY_BOUND_ELSEWHERE_MESSAGE,
  API_KEY_ORGANIZATION_NOT_VISIBLE_MESSAGE,
  newBindApiKeyOrganizationStep,
  newPreserveKeyMaterialStep,
} from "../steps.js";

const person: CallerIdentity = {
  identityId: "ida_alice",
  callerClass: "user",
  issuer: "",
  rawToken: "token",
};

function answering(
  decision: AuthzDecision,
): Authorizer & { checks: AuthzCheck[] } {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorize(_caller, check) {
      checks.push(check);
      return Promise.resolve(decision);
    },
  };
}

function contextFor(
  caller: CallerIdentity,
  org: string,
): RequestContext<typeof ApiKeySchema> {
  return new RequestContext(
    ApiKeySchema,
    create(ApiKeySchema, { metadata: { name: "ci" }, spec: { boundOrg: org } }),
    caller,
    ApiResourceKind.api_key,
  );
}

async function refusal(run: void | Promise<unknown>): Promise<ConnectError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("BindApiKeyOrganization", () => {
  it("asks nothing for an unbound caller's key that names no organization", async () => {
    const authorizer = answering({ kind: "allow" });
    const ctx = contextFor(person, "");
    await newBindApiKeyOrganizationStep(authorizer).execute(ctx);
    expect(ctx.newState.spec?.boundOrg).toBe("");
    expect(authorizer.checks).toEqual([]);
  });

  it("asks the owner's can_view on the organization a key is limited to", async () => {
    const authorizer = answering({ kind: "allow" });
    const ctx = contextFor(person, "org_acme");
    await newBindApiKeyOrganizationStep(authorizer).execute(ctx);
    expect(authorizer.checks).toEqual([
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.organization,
        resourceId: "org_acme",
      },
    ]);
  });

  it("refuses an organization the owner may not view, and a missing one, with the same copy", async () => {
    for (const decision of [
      { kind: "deny", reason: "" },
      { kind: "not-found" },
    ] as const) {
      const refused = await refusal(
        newBindApiKeyOrganizationStep(answering(decision)).execute(
          contextFor(person, "org_globex"),
        ),
      );
      expect(refused.code).toBe(Code.PermissionDenied);
      expect(refused.rawMessage).toBe(API_KEY_ORGANIZATION_NOT_VISIBLE_MESSAGE);
    }
  });

  it("limits a bound caller's key to its own organization, and refuses any other before asking", async () => {
    const bound: CallerIdentity = { ...person, boundOrg: "org_acme" };
    const authorizer = answering({ kind: "allow" });
    const filled = contextFor(bound, "");
    await newBindApiKeyOrganizationStep(authorizer).execute(filled);
    expect(filled.newState.spec?.boundOrg).toBe("org_acme");

    const before = authorizer.checks.length;
    const refused = await refusal(
      newBindApiKeyOrganizationStep(authorizer).execute(
        contextFor(bound, "org_globex"),
      ),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(API_KEY_BOUND_ELSEWHERE_MESSAGE);
    expect(authorizer.checks).toHaveLength(before);
  });
});

describe("PreserveKeyMaterial", () => {
  it("keeps the stored organization over the one an update sends", () => {
    const stored: ApiKey = create(ApiKeySchema, {
      metadata: { id: "key_1", name: "ci" },
      spec: { keyHash: "h", fingerprint: "f", boundOrg: "org_acme" },
    });
    const ctx = new RequestContext(
      ApiKeySchema,
      create(ApiKeySchema, {
        metadata: { id: "key_1", name: "ci" },
        spec: { boundOrg: "" },
      }),
      person,
      ApiResourceKind.api_key,
    );
    ctx.set(EXISTING_RESOURCE_KEY, stored);
    newPreserveKeyMaterialStep().execute(ctx);
    expect(ctx.newState.spec?.boundOrg).toBe("org_acme");
    expect(ctx.newState.spec?.keyHash).toBe("h");
  });
});
