/**
 * Pins the identity-account create path's platform-client arm over the OSS
 * adapter on sqlite:
 *   - `platform_client` provisioning writes the mode, the owning
 *     organization and the derived id, with the actor the caller named;
 *   - the `stgm_pc|` subject namespace is reserved in both directions: a
 *     direct account refuses it INVALID_ARGUMENT before anything is written,
 *     and a platform-client account without it is the caller's bug;
 *   - the direct lookups never answer the platform-client account, while the
 *     any-mode lookup (the mint's) does.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { serverActingFor } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { accountIdFor, reservedSubjectMessage } from "../constants.js";
import { newCreateAccountPath } from "../controller.js";
import type { CreateAccount } from "../provisioning.js";
import { newResourceIdentityAccountStore } from "../resource-store.js";
import type { IdentityAccountStore } from "../store.js";

let temp: TempStore;
let accounts: IdentityAccountStore;
let createAccount: CreateAccount;

beforeEach(() => {
  temp = tempStore();
  accounts = newResourceIdentityAccountStore(temp.store);
  createAccount = newCreateAccountPath(
    {
      accounts,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      authorizationLifecycle: undefined,
    },
    ApiResourceKind.identity_account,
  );
});

afterEach(() => {
  temp.cleanup();
});

const SUBJECT = "stgm_pc|acme|user-7";
const CLIENT = serverActingFor("pcl_dashboard");

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a ConnectError refusal");
}

describe("the create path's platform-client arm", () => {
  it("writes the mode, the owning organization and the derived id, stamped as the client", async () => {
    const account = await createAccount(
      {
        name: "pat@example.com",
        spec: create(IdentityAccountSpecSchema, { idpId: SUBJECT, email: "pat@example.com" }),
        provisioning: { mode: "platform_client", org: "acme" },
      },
      CLIENT,
    );
    expect(account.metadata?.id).toBe(accountIdFor(SUBJECT));
    expect(account.metadata?.org).toBe("acme");
    expect(account.spec?.provisioningMode).toBe(IdentityAccountProvisioningMode.platform_client);
    expect(account.status?.audit?.specAudit?.createdBy?.id).toBe("pcl_dashboard");

    expect(await accounts.findDirectByIdpId(SUBJECT)).toBeUndefined();
    expect(await accounts.findDirectByEmail("pat@example.com")).toBeUndefined();
    expect((await accounts.findByIdpId(SUBJECT))?.metadata?.id).toBe(accountIdFor(SUBJECT));
  });

  it("refuses a direct account under the reserved subject prefix, writing nothing", async () => {
    const denied = await refusal(
      createAccount(
        {
          name: "impostor",
          spec: create(IdentityAccountSpecSchema, { idpId: SUBJECT }),
          provisioning: { mode: "direct" },
        },
        CLIENT,
      ),
    );
    expect(denied.code).toBe(Code.InvalidArgument);
    expect(denied.rawMessage).toBe(reservedSubjectMessage(SUBJECT));
    expect(await accounts.findByIdpId(SUBJECT)).toBeUndefined();
  });

  it("refuses a platform-client account without the reserved prefix as a server fault", async () => {
    const denied = await refusal(
      createAccount(
        {
          name: "stray",
          spec: create(IdentityAccountSpecSchema, { idpId: "auth0|stray" }),
          provisioning: { mode: "platform_client", org: "acme" },
        },
        CLIENT,
      ),
    );
    expect(denied.code).toBe(Code.Internal);
  });
});
