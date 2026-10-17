/**
 * Pins the identity-account create path's app-user arm over the OSS
 * adapter on sqlite:
 *   - `app_user` provisioning writes the mode, the owning
 *     organization and the derived id, with the actor the caller named;
 *   - the `stgm_pc|` subject namespace is reserved in both directions: a
 *     direct account refuses it INVALID_ARGUMENT before anything is written,
 *     and an app-user account without it is the caller's bug;
 *   - the direct lookups never answer the app-user account, while the
 *     any-mode lookup (the mint's) does.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountSpecSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/spec_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { serverActingFor } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { validator } from "../../../pipeline/steps/validation.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { accountIdFor, reservedSubjectMessage } from "../constants.js";
import { newCreateAccountPath } from "../controller.js";
import type { CreateAccount } from "../provisioning.js";
import { newDirectAccountProvisioner } from "../provisioning.js";
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
      store: temp.store,
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
const MINTER = serverActingFor("ida_dashboard_minter");

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a ConnectError refusal");
}

describe("the create path's account slug, from a name the server chose", () => {
  it("provisions a direct account whose email starts with a digit", async () => {
    const account = await createAccount(
      {
        name: "2024intern@acme.com",
        spec: create(IdentityAccountSpecSchema, {
          idpId: "auth0|2024intern",
          email: "2024intern@acme.com",
        }),
        provisioning: { mode: "direct" },
      },
      MINTER,
    );
    expect(account.metadata?.slug).toBe("a-2024internacme-com");
  });

  it("provisions an account with no name whose email is past the name's bound, its name cut to 200 characters", async () => {
    const email = `${"m".repeat(195)}@acme.example`;
    const account = await createAccount(
      {
        name: "",
        spec: create(IdentityAccountSpecSchema, { idpId: "auth0|long-email", email }),
        provisioning: { mode: "direct" },
      },
      MINTER,
    );
    expect(account.metadata?.name).toBe(email.slice(0, 200));
    expect(account.spec?.email).toBe(email);
  });

  it("signs in a person whose email is past the name's bound: the account is named by the email cut to 200, and validates as an update sends it back", async () => {
    const email = `${"m".repeat(240)}@acme.example`;
    const provisioner = newDirectAccountProvisioner({
      accounts,
      createAccount,
      userInfo: {
        fetchUserProfile: async () => ({ email, firstName: "", lastName: "", pictureUrl: "" }),
      },
    });
    const { account, created } = await provisioner.provisionDirectAccount("auth0|long-email-person", {
      identityId: "auth0|long-email-person",
      callerClass: "user",
      issuer: "https://issuer.test",
      rawToken: "token",
    });
    expect(created).toBe(true);
    expect(account.metadata?.name).toBe(email.slice(0, 200));
    expect(account.spec?.email).toBe(email);
    expect(validator().validate(IdentityAccountSchema, account).kind).toBe("valid");
  });

  it("provisions an app user whose external id is numeric, and one named by a UUID", async () => {
    for (const [external, slug] of [
      ["12345", "a-12345"],
      ["550e8400-e29b-41d4-a716-446655440000", "a-550e8400-e29b-41d4-a716-446655440000"],
    ] as const) {
      const account = await createAccount(
        {
          name: external,
          spec: create(IdentityAccountSpecSchema, { idpId: `stgm_pc|acme|${external}` }),
          provisioning: { mode: "app_user", org: "acme" },
        },
        MINTER,
      );
      expect(account.metadata?.slug).toBe(slug);
    }
  });
});

describe("the create path's app-user arm", () => {
  it("writes the mode, the owning organization and the derived id, stamped as the minting service account", async () => {
    const account = await createAccount(
      {
        name: "pat@example.com",
        spec: create(IdentityAccountSpecSchema, {
          idpId: SUBJECT,
          email: "pat@example.com",
        }),
        provisioning: { mode: "app_user", org: "acme" },
      },
      MINTER,
    );
    expect(account.metadata?.id).toBe(accountIdFor(SUBJECT));
    expect(account.metadata?.org).toBe("acme");
    expect(account.spec?.provisioningMode).toBe(
      IdentityAccountProvisioningMode.app_user,
    );
    expect(account.status?.audit?.specAudit?.createdBy?.id).toBe(
      "ida_dashboard_minter",
    );

    expect(await accounts.findDirectByIdpId(SUBJECT)).toBeUndefined();
    expect(await accounts.findDirectByEmail("pat@example.com")).toBeUndefined();
    expect((await accounts.findByIdpId(SUBJECT))?.metadata?.id).toBe(
      accountIdFor(SUBJECT),
    );
  });

  it("refuses a direct account under the reserved subject prefix, writing nothing", async () => {
    const denied = await refusal(
      createAccount(
        {
          name: "impostor",
          spec: create(IdentityAccountSpecSchema, { idpId: SUBJECT }),
          provisioning: { mode: "direct" },
        },
        MINTER,
      ),
    );
    expect(denied.code).toBe(Code.InvalidArgument);
    expect(denied.rawMessage).toBe(reservedSubjectMessage(SUBJECT));
    expect(await accounts.findByIdpId(SUBJECT)).toBeUndefined();
  });

  it("refuses an app-user account without the reserved prefix as a server fault", async () => {
    const denied = await refusal(
      createAccount(
        {
          name: "stray",
          spec: create(IdentityAccountSpecSchema, { idpId: "auth0|stray" }),
          provisioning: { mode: "app_user", org: "acme" },
        },
        MINTER,
      ),
    );
    expect(denied.code).toBe(Code.Internal);
  });
});
