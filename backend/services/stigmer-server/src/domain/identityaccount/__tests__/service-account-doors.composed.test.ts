/**
 * The doors beyond API keys, accounts and the organization's roles through
 * which a credential could decide who belongs to an organization or what
 * credentials exist, held shut to an organization's admin service account,
 * over the composed sign-in server:
 *
 *   - a platform client's create, update and secret rotation (its sign-in
 *     role makes members, its secret mints users);
 *   - the federated account RPCs (they make and remove members), refused
 *     before the edition's federation is even consulted;
 *   - an organization's delete, a child of its own organization included;
 *   - a credential limited to one organization reaching another
 *     organization's service account: it may not mint its keys, list them,
 *     rename it or delete it, though the person behind it administers both.
 *
 * Each refusal is the service account's own copy, so an unrelated
 * PERMISSION_DENIED cannot stand in for it. A person admin passes the same
 * doors, so the refusal is the class's and not the door's.
 */
import { createClient } from "@connectrpc/connect";
import { Code } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { PlatformClientCommandController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/command_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { serviceAccountRefusedMessage } from "../../../pipeline/steps/refuse-service-account.js";
import {
  bootSignInServer,
  createServiceAccount,
  foundOrganization,
  mintServiceAccountKey,
  provision,
  refusal,
} from "./service-account-support.js";
import type { SignInServer } from "./service-account-support.js";

const FOUNDER = "fake|doors-founder";

let at: SignInServer;
let acme = "";
let globex = "";
let ciId = "";
let ciKey = "";

function platformClientInput(org: string, name: string) {
  return {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "PlatformClient",
    metadata: { name, org },
    spec: { createAccountsOnSignIn: true, signInRole: IamRole.admin },
  };
}

beforeAll(async () => {
  at = await bootSignInServer("service-account-doors");
  await provision(at, FOUNDER);
  acme = await foundOrganization(at.as(FOUNDER), "doors-acme");
  globex = await foundOrganization(at.as(FOUNDER), "doors-globex");
  const ci = await createServiceAccount(at.as(FOUNDER), acme, "ci-admin", IamRole.admin);
  ciId = ci.metadata?.id ?? "";
  ciKey = await mintServiceAccountKey(at.as(FOUNDER), ciId, "ci-admin-key");
});

afterAll(async () => {
  await at?.shutdown();
});

describe("an admin service account's key, at the doors that decide membership or credentials", () => {
  it("is refused a platform client's create, update and secret rotation; a person admin is not", async () => {
    const asPerson = createClient(PlatformClientCommandController, at.as(FOUNDER));
    const made = await asPerson.create(platformClientInput(acme, "doors-portal"));
    const client = made.platformClient;
    const asKey = createClient(PlatformClientCommandController, at.presenting(ciKey));
    const attempts: ReadonlyArray<Promise<unknown>> = [
      asKey.create(platformClientInput(acme, "doors-rogue")),
      asKey.update(client ?? {}),
      asKey.rotateSecret({ value: client?.metadata?.id ?? "" }),
    ];
    for (const attempt of attempts) {
      const error = await refusal(attempt);
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(serviceAccountRefusedMessage("create or change platform clients"));
    }
  });

  it("is refused the federated account RPCs before the edition's federation is consulted", async () => {
    const asKey = createClient(IdentityAccountCommandController, at.presenting(ciKey));
    const ref = { org: acme, slug: "doors-okta" };
    const attempts: ReadonlyArray<Promise<unknown>> = [
      asKey.createFederatedAccount({ org: acme, identityProviderRef: ref, externalSub: "okta|x", email: "x@acme.test" }),
      asKey.updateFederatedAccount({ org: acme, identityProviderRef: ref, externalSub: "okta|x", email: "x@acme.test" }),
      asKey.deprovisionFederatedAccount({ org: acme, identityProviderRef: ref, externalSub: "okta|x" }),
    ];
    for (const attempt of attempts) {
      const error = await refusal(attempt);
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(serviceAccountRefusedMessage("create, change or remove federated accounts"));
    }
  });

  it("is refused deleting a child of its own organization", async () => {
    const child = await createClient(OrganizationCommandController, at.as(FOUNDER)).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "doors-acme-child", slug: "doors-acme-child" },
      spec: { parentOrg: acme },
    });
    const error = await refusal(
      createClient(OrganizationCommandController, at.presenting(ciKey)).delete({ value: child.metadata?.id ?? "" }),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(serviceAccountRefusedMessage("delete organizations"));
  });
});

describe("a credential limited to one organization, at another organization's service account", () => {
  it("may not mint its keys, list them, rename it or delete it", async () => {
    const limited = await createClient(ApiKeyCommandController, at.as(FOUNDER)).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: "doors-globex-only", org: globex },
      spec: { boundOrg: globex, neverExpires: true },
    });
    const asLimited = at.presenting(limited.spec?.keyHash ?? "");
    const attempts: ReadonlyArray<Promise<unknown>> = [
      createClient(ApiKeyCommandController, asLimited).createForServiceAccount({
        serviceAccountId: ciId,
        name: "from-globex",
        neverExpires: true,
      }),
      createClient(ApiKeyQueryController, asLimited).findByAccount({ value: ciId }),
      createClient(IdentityAccountCommandController, asLimited).delete({ value: ciId }),
    ];
    for (const attempt of attempts) {
      expect((await refusal(attempt)).code).toBe(Code.PermissionDenied);
    }
  });
});
