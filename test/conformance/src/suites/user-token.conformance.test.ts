// User-token conformance on the target's primary: the organization's
// embedding settings, which every edition serves, and the mint on a server
// that trusts every request.
//
// Pins:
//   - updateEmbedding replaces the whole message and the organization reads
//     it back; update keeps it whatever it carries;
//   - the sign-in role rules are refused on the contract (owner, a role
//     without account creation) and by the door (a role no organization
//     grants);
//   - `vaults` is held to the reference rule every spec reference is: a
//     missing vault of the organization is refused FAILED_PRECONDITION with
//     the rule's copy, the slug named, and a person's own My vault is refused
//     (an organization's app users are not its person);
//   - on a server that trusts every request, mintUserToken is refused
//     FAILED_PRECONDITION: nothing there would verify the token.
//
// Out of scope: who mints, the mint's identity and organization contract,
// and the minter's enforcement, the enforcing lane's
// (user-token-enforcement.conformance.test.ts).
import { clone } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { organizationSlug } from "../support/organizations";
import { myVaultTarget, setSecretsInput } from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

const trustsEveryRequest = !createTarget().capabilities.requiresAuthentication;

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

async function organization(): Promise<string> {
  const context = await target.provisionTenancy();
  fixtures.defer(() => target.cleanupTenancy(context));
  return context.org;
}

describe("user tokens — the organization's embedding settings on the primary", () => {
  it("[rpc:OrganizationCommandController.updateEmbedding] replaces the whole message, and update keeps it", async () => {
    const org = await organization();
    const saved = await clients.organizationCommand.updateEmbedding({
      orgId: org,
      embedding: {
        allowedOrigins: ["https://app.example"],
        createAccountsOnSignIn: true,
        signInRole: IamRole.member,
      },
    });
    expect(saved.spec?.embedding?.allowedOrigins).toEqual(["https://app.example"]);
    expect(saved.spec?.embedding?.signInRole).toBe(IamRole.member);

    const replaced = await clients.organizationCommand.updateEmbedding({
      orgId: org,
      embedding: { createAccountsOnSignIn: true },
    });
    expect(replaced.spec?.embedding?.allowedOrigins).toEqual([]);
    expect(replaced.spec?.embedding?.signInRole).toBe(IamRole.iam_role_unspecified);

    const current = await clients.organizationQuery.get({ value: org });
    const resource = clone(OrganizationSchema, current);
    if (resource.spec !== undefined) {
      resource.spec.description = uniqueName("described");
      resource.spec.embedding = undefined;
    }
    const updated = await clients.organizationCommand.update({
      resource,
      updateMask: { paths: ["spec"] },
    });
    expect(updated.spec?.embedding?.createAccountsOnSignIn, "update keeps the settings").toBe(true);
  });

  it("[rpc:OrganizationCommandController.updateEmbedding] refuses owner, a role without account creation, and a role no organization grants", async () => {
    const org = await organization();
    for (const embedding of [
      { createAccountsOnSignIn: true, signInRole: IamRole.owner },
      { createAccountsOnSignIn: false, signInRole: IamRole.viewer },
      { createAccountsOnSignIn: true, signInRole: IamRole.participant },
    ]) {
      await expectGrpcCode(
        () => clients.organizationCommand.updateEmbedding({ orgId: org, embedding }),
        Code.InvalidArgument,
        `embedding settings ${JSON.stringify(embedding)}`,
      );
    }
  });

  it("[rpc:OrganizationCommandController.updateEmbedding] a vault reference must name an existing vault of the organization", async () => {
    const org = await organization();
    const err = await expectGrpcCode(
      () =>
        clients.organizationCommand.updateEmbedding({
          orgId: org,
          embedding: {
            createAccountsOnSignIn: true,
            vaults: [{ kind: ApiResourceKind.vault, slug: "ghost-vault" }],
          },
        }),
      Code.FailedPrecondition,
      "embedding settings naming a missing vault",
    );
    expect(err.rawMessage).toBe(
      `referenced vault(s) not found: 'ghost-vault' (org: ${await organizationSlug(clients.organizationQuery, org)}).` +
        " Verify the slug and org are correct." +
        " Use 'stigmer list vaults' to list available vaults.",
    );
  });

  it("[rpc:OrganizationCommandController.updateEmbedding] the settings cannot carry anyone's own My vault", async () => {
    const org = await organization();
    const mine = await clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { EMBED_KEY: "mine" }));
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));
    const err = await expectGrpcCode(
      () =>
        clients.organizationCommand.updateEmbedding({
          orgId: org,
          embedding: {
            createAccountsOnSignIn: true,
            vaults: [{ kind: ApiResourceKind.vault, slug: mine.metadata!.slug }],
          },
        }),
      Code.FailedPrecondition,
      "embedding settings naming the caller's My vault",
    );
    expect(err.rawMessage).toContain(
      "a My vault cannot be attached to an organization's embedding settings",
    );
  });
});

describe.skipIf(!trustsEveryRequest)(
  "user tokens — a server that trusts every request (targets without authentication)",
  () => {
    it("[rpc:TokenService.mintUserToken] mintUserToken is refused FAILED_PRECONDITION: nothing would verify the token", async () => {
      const org = await organization();
      await expectGrpcCode(
        () => clients.token.mintUserToken({ org, userId: uniqueName("trusted-local-user") }),
        Code.FailedPrecondition,
        "a mint on a server with no authentication posture",
      );
    });
  },
);
