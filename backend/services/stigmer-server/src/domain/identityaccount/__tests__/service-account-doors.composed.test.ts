/**
 * The doors beyond API keys, accounts and the organization's roles through
 * which a credential could decide who belongs to an organization or what
 * credentials exist, held shut to an organization's admin service account,
 * over the composed sign-in server:
 *
 *   - the organization's embedding settings (their sign-in role decides
 *     which role the key's own mint grants);
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

import { ApiKeyCommandController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/query_pb";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";

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
  it("is refused changing the organization's embedding settings; a person admin is not", async () => {
    const embedding = { createAccountsOnSignIn: true, signInRole: IamRole.admin };
    const saved = await createClient(OrganizationCommandController, at.as(FOUNDER)).updateEmbedding({
      orgId: acme,
      embedding,
    });
    expect(saved.spec?.embedding?.signInRole).toBe(IamRole.admin);
    const error = await refusal(
      createClient(OrganizationCommandController, at.presenting(ciKey)).updateEmbedding({
        orgId: acme,
        embedding: { createAccountsOnSignIn: true, signInRole: IamRole.member },
      }),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(serviceAccountRefusedMessage("change the organization's embedding settings"));
  });

  it("is refused the federated account RPCs before the edition's federation is consulted", async () => {
    const asKey = createClient(IdentityAccountCommandController, at.presenting(ciKey));
    const ref = { org: acme, slug: "doors-okta" };
    const attempts: ReadonlyArray<() => Promise<unknown>> = [
      () => asKey.createFederatedAccount({ org: acme, federationIssuerRef: ref, externalSub: "okta|x", email: "x@acme.test" }),
      () => asKey.updateFederatedAccount({ org: acme, federationIssuerRef: ref, externalSub: "okta|x", email: "x@acme.test" }),
      () => asKey.deprovisionFederatedAccount({ org: acme, federationIssuerRef: ref, externalSub: "okta|x" }),
    ];
    for (const attempt of attempts) {
      const error = await refusal(attempt());
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

describe("an admin service account's key, at the runner credential exchange", () => {
  it("is refused minting a run credential, which would outlive the key's revocation, before any run is read", async () => {
    const error = await refusal(
      createClient(PlatformQueryController, at.presenting(ciKey)).getRunnerScopedToken({
        scope: { case: "runId", value: "run_00000000000000000000000000" },
      }),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(serviceAccountRefusedMessage("mint run credentials"));
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
    const attempts: ReadonlyArray<() => Promise<unknown>> = [
      () => createClient(ApiKeyCommandController, asLimited).createForServiceAccount({
        serviceAccountId: ciId,
        name: "from-globex",
        neverExpires: true,
      }),
      () => createClient(ApiKeyQueryController, asLimited).listByAccount({ accountId: ciId }),
      () => createClient(IdentityAccountCommandController, asLimited).delete({ value: ciId }),
    ];
    for (const attempt of attempts) {
      expect((await refusal(attempt())).code).toBe(Code.PermissionDenied);
    }
  });
});
