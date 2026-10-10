/**
 * Pins the identity-account create path's federated arm over the OSS
 * adapter on sqlite:
 *   - `federated` provisioning writes the mode, the provider's reference as
 *     the path was given it (a spec naming another provider cannot win),
 *     the provider's organization and the address of the provider and
 *     subject, stamped as the caller;
 *   - the account is reached by the federated read and by no subject
 *     lookup, and a direct account under the same subject is another
 *     person with its own address;
 *   - the subject is the provider's to choose: a federated subject that a
 *     direct account could not take is accepted;
 *   - a second create of one provider and subject is ALREADY_EXISTS;
 *   - a direct account refuses the `stgm_fed|` text INVALID_ARGUMENT,
 *     writing nothing, as it refuses `stgm_pc|`;
 *   - a provider reference the path cannot address is a server fault.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { serverActingFor } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import {
  accountIdFor,
  federatedAccountIdFor,
  reservedSubjectMessage,
} from "../constants.js";
import { newCreateAccountPath } from "../controller.js";
import type { CreateAccount, FederatedProvider } from "../provisioning.js";
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

const ACME_ORG = "org_01hzacme000000000000000000";
const OKTA: FederatedProvider = { org: ACME_ORG, slug: "acme-okta" };
const SIGN_IN = serverActingFor("idp_01hzacmeokta0000000000000");

function federated(
  idpId: string,
  provider: FederatedProvider = OKTA,
  email = "",
) {
  return {
    name: email !== "" ? email : idpId,
    spec: create(IdentityAccountSpecSchema, { idpId, email }),
    provisioning: { mode: "federated" as const, provider },
  };
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a ConnectError refusal");
}

describe("the create path's federated arm", () => {
  it("writes the mode, the provider's reference and organization, and the provider-and-subject address, stamped as the caller", async () => {
    const account = await createAccount(
      federated("okta|dana", OKTA, "dana@acme.example"),
      SIGN_IN,
    );
    expect(account.metadata?.id).toBe(
      federatedAccountIdFor(ACME_ORG, "acme-okta", "okta|dana"),
    );
    expect(account.metadata?.org).toBe(ACME_ORG);
    expect(account.spec?.idpId).toBe("okta|dana");
    expect(account.spec?.provisioningMode).toBe(
      IdentityAccountProvisioningMode.federated,
    );
    expect(account.spec?.identityProviderRef).toMatchObject({
      org: ACME_ORG,
      kind: ApiResourceKind.identity_provider,
      slug: "acme-okta",
    });
    expect(account.status?.audit?.specAudit?.createdBy?.id).toBe(
      "idp_01hzacmeokta0000000000000",
    );
  });

  it("takes the provider from the path, never from the spec it was handed", async () => {
    const input = federated("okta|erin");
    input.spec.identityProviderRef = create(ApiResourceReferenceSchema, {
      org: "org_01hzother00000000000000000",
      kind: ApiResourceKind.identity_provider,
      slug: "other-okta",
    });
    const account = await createAccount(input, SIGN_IN);
    expect(account.spec?.identityProviderRef?.slug).toBe("acme-okta");
    expect(account.metadata?.id).toBe(
      federatedAccountIdFor(ACME_ORG, "acme-okta", "okta|erin"),
    );
  });

  it("is reached by the federated read and by no subject lookup; a direct account under the subject is another person", async () => {
    await createAccount(federated("shared|sam"), SIGN_IN);
    expect(
      (
        await accounts.findByProviderAndIdpId(
          ACME_ORG,
          "acme-okta",
          "shared|sam",
        )
      )?.metadata?.id,
    ).toBe(federatedAccountIdFor(ACME_ORG, "acme-okta", "shared|sam"));
    expect(await accounts.findDirectByIdpId("shared|sam")).toBeUndefined();
    expect(await accounts.findByIdpId("shared|sam")).toBeUndefined();

    const direct = await createAccount(
      {
        name: "sam",
        spec: create(IdentityAccountSpecSchema, { idpId: "shared|sam" }),
        provisioning: { mode: "direct" },
      },
      SIGN_IN,
    );
    expect(direct.metadata?.id).toBe(accountIdFor("shared|sam"));
    expect((await accounts.findDirectByIdpId("shared|sam"))?.metadata?.id).toBe(
      accountIdFor("shared|sam"),
    );
  });

  it("accepts any subject its provider asserts, a reserved-looking one included", async () => {
    const account = await createAccount(
      federated("stgm_pc|acme|user-7"),
      SIGN_IN,
    );
    expect(account.spec?.idpId).toBe("stgm_pc|acme|user-7");
    expect(await accounts.findByIdpId("stgm_pc|acme|user-7")).toBeUndefined();
  });

  it("answers ALREADY_EXISTS for a second create of one provider and subject", async () => {
    await createAccount(federated("okta|frank"), SIGN_IN);
    const denied = await refusal(
      createAccount(federated("okta|frank"), SIGN_IN),
    );
    expect(denied.code).toBe(Code.AlreadyExists);
  });

  it("refuses a direct account under the federated address text, writing nothing", async () => {
    const subject = `stgm_fed|${ACME_ORG}|acme-okta|okta|dana`;
    const denied = await refusal(
      createAccount(
        {
          name: "impostor",
          spec: create(IdentityAccountSpecSchema, { idpId: subject }),
          provisioning: { mode: "direct" },
        },
        SIGN_IN,
      ),
    );
    expect(denied.code).toBe(Code.InvalidArgument);
    expect(denied.rawMessage).toBe(reservedSubjectMessage(subject));
    expect(await accounts.findById(accountIdFor(subject))).toBeUndefined();
  });

  it("answers a provider reference the path cannot address as a server fault", async () => {
    const denied = await refusal(
      createAccount(
        federated("okta|gil", { org: "", slug: "acme-okta" }),
        SIGN_IN,
      ),
    );
    expect(denied.code).toBe(Code.Internal);
  });
});
