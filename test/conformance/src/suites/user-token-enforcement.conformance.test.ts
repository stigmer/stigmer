// User-token enforcement conformance: the mint and the minter's contract, on
// the target's ENFORCING lane.
//
// A server mints user tokens only when it authenticates its callers, and a
// service account exists only there, so every arm runs where one does: the
// cloud's primary, and on the local targets the open-source sibling booted in
// the OIDC posture (harness/enforcing-lane.ts). The same arms and the same
// byte-pinned copy on both.
//
// Who mints:
//   - only a service account's key: a person's own token is refused, an admin
//     included;
//   - only an admin service account's: a member-role account is refused;
//   - into its own organization and a child of it, never an unrelated one.
//
// The mint's contract:
//   - the minted token IS the person: one account per (organization,
//     user_id), whichever of the organization's service accounts minted it;
//   - so the audit tells the minters apart instead: a resource an app user
//     writes records the minting service account on its created_by actor
//     (minted_by), beside that one account;
//   - a person a first sign-in creates holds exactly the embedding sign-in
//     role and sees that organization alone; a later change of the role does
//     not reach an existing account;
//   - the organization's access list names that person an app user (identity
//     origin `app_user`) and its founder not;
//   - with account creation off, an unknown person is refused with the pinned
//     copy.
//
// The minter's contract on every serving-edge request a user token bears:
//   - deleting the minting service account revokes its tokens on the NEXT
//     request (UNAUTHENTICATED, fail closed); revoking its key does not, and
//     the revoked key mints nothing;
//   - Origin vs the embedding settings' allowed_origins: a browser request
//     from an origin outside the list is refused PERMISSION_DENIED on the
//     next request after the list changes; a request without an Origin header
//     never is.
//
// Who changes the settings: a service account's key is refused, whatever its
// role, and a member is refused.
//
// Out of scope here: the settings' own contract on the primary and the
// server that trusts every request (user-token.conformance.test.ts).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeSession } from "../support/sessions";
import { uniqueName } from "../support/naming";
import {
  createMinter,
  deleteMinter,
  mintUserToken,
  setEmbedding,
  type Minter,
} from "../support/user-tokens";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";

const MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE =
  "mintUserToken is called with a service account's API key: create a " +
  "service account with the admin role, create a key for it, and call " +
  "mintUserToken from your product's backend with that key";

const MINT_DENIED_MESSAGE = "unauthorized to mint user tokens for this organization";

const DELETED_MINTER_MESSAGE =
  "The service account that minted this token has been deleted, so the " +
  "token is no longer accepted. Mint a new user token with an active " +
  "service account's key.";

function originRefusalMessage(origin: string): string {
  return (
    `Request origin '${origin}' is not in the organization's embedding ` +
    "allowed_origins. Add it to allowed_origins in the organization's " +
    "embedding settings to permit browser requests from this origin."
  );
}

function noAccountMessage(userId: string, org: string): string {
  return (
    `User '${userId}' has no Stigmer account in organization '${org}'. ` +
    "Turn on create_accounts_on_sign_in in the organization's embedding " +
    "settings or create the account first."
  );
}

const enforcementServed = createTarget().capabilities.userTokens;

let target: TargetProfile;
let lane: EnforcingLane;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  if (!enforcementServed) return;
  const enforcing = await enforcingLaneOf(target);
  if (enforcing.lane === undefined) {
    throw new Error(
      `target "${target.name}" declares userTokens but offers no enforcing lane: ${enforcing.reason}`,
    );
  }
  lane = enforcing.lane;
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

// An organization the founder owns, with embedding settings that create
// accounts, cleaned up after the arm.
async function tenancy(
  embedding: Parameters<typeof setEmbedding>[2] = {},
): Promise<TenancyContext> {
  const context = await lane.provisionTenancy();
  fixtures.defer(() => lane.cleanupTenancy(context));
  await setEmbedding(lane.clients, context.org, embedding);
  return context;
}

// A service account of the organization and its key, deleted after the arm
// unless the arm deletes it.
async function minter(
  org: string,
  options: { role?: IamRole; keep?: boolean } = {},
): Promise<Minter & { readonly as: ConformanceClients }> {
  const created = await createMinter(lane.clients, {
    org,
    name: uniqueName("minter"),
    ...(options.role !== undefined ? { role: options.role } : {}),
  });
  if (options.keep !== true) {
    fixtures.defer(() => deleteMinter(lane.clients, created.accountId).catch(() => undefined));
  }
  return { ...created, as: lane.clientsPresenting(created.key) };
}

describe.skipIf(!enforcementServed)(
  "user-token enforcement — who mints (userTokens targets)",
  () => {
    it("[rpc:TokenService.mintUserToken] a person's own token is refused, the organization's owner included", async () => {
      const context = await tenancy();
      const refused = await expectGrpcCode(
        () => mintUserToken(lane.clients, context.org, uniqueName("user")),
        Code.PermissionDenied,
        "a mint called with a person's own token",
      );
      expect(refused.rawMessage).toBe(MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE);
    });

    it("[rpc:TokenService.mintUserToken] a member-role service account is refused", async () => {
      const context = await tenancy();
      const member = await minter(context.org, { role: IamRole.member });
      const refused = await expectGrpcCode(
        () => mintUserToken(member.as, context.org, uniqueName("user")),
        Code.PermissionDenied,
        "a mint called with a member-role service account's key",
      );
      expect(refused.rawMessage).toBe(MINT_DENIED_MESSAGE);
    });

    it("[rpc:TokenService.mintUserToken] an admin service account mints into its organization and is refused in an unrelated one", async () => {
      const context = await tenancy({ signInRole: IamRole.member });
      const other = await tenancy();
      const admin = await minter(context.org);
      const token = await mintUserToken(admin.as, context.org, uniqueName("user"));
      const mine = await lane.clientsPresenting(token).organizationQuery.listMine({});
      expect(mine.entries.map((organization) => organization.metadata?.id)).toEqual([context.org]);
      await expectGrpcCode(
        () => mintUserToken(admin.as, other.org, uniqueName("user")),
        Code.PermissionDenied,
        "a mint into an organization the service account does not administer",
      );
    });
  },
);

describe.skipIf(!enforcementServed)(
  "user-token enforcement — the mint's contract (userTokens targets)",
  () => {
    it("[rpc:TokenService.mintUserToken] one user_id is one account across the organization's minters, and a repeat mint reuses it", async () => {
      const context = await tenancy();
      const dashboard = await minter(context.org);
      const mobile = await minter(context.org);
      const userId = uniqueName("user");

      const first = await lane.accountIdOf(
        lane.clientsPresenting(await mintUserToken(dashboard.as, context.org, userId)),
      );
      const again = await lane.accountIdOf(
        lane.clientsPresenting(await mintUserToken(dashboard.as, context.org, userId)),
      );
      const viaMobile = await lane.accountIdOf(
        lane.clientsPresenting(await mintUserToken(mobile.as, context.org, userId)),
      );

      expect(again, "a repeat mint must resolve the same account").toBe(first);
      expect(viaMobile, "another minter of the organization must resolve the same account").toBe(first);
    });

    it("a resource an app user creates records the minting service account beside the one account", async () => {
      const context = await tenancy({ signInRole: IamRole.member });
      const dashboard = await minter(context.org);
      const mobile = await minter(context.org);
      const userId = uniqueName("user");

      const createdThrough = async (via: Minter & { as: ConformanceClients }) => {
        const asUser = lane.clientsPresenting(await mintUserToken(via.as, context.org, userId));
        const created = await asUser.sessionCommand.create(
          makeSession({ org: context.org, name: uniqueName("user-session") }),
        );
        fixtures.defer(() => asUser.sessionCommand.delete({ value: created.metadata!.id }));
        const read = await asUser.sessionQuery.get({ value: created.metadata!.id });
        return read.status?.audit?.specAudit?.createdBy;
      };
      const viaDashboard = await createdThrough(dashboard);
      const viaMobile = await createdThrough(mobile);

      expect(viaDashboard?.id, "both writes are the one account").toBe(viaMobile?.id);
      expect(viaDashboard?.mintedBy).toBe(dashboard.accountId);
      expect(viaMobile?.mintedBy).toBe(mobile.accountId);
    });

    it("[rpc:GrantQueryController.listResourceAccessByPrincipal] a person a first sign-in creates holds the sign-in role once, and the access list names them an app user", async () => {
      const context = await tenancy({ signInRole: IamRole.member });
      const admin = await minter(context.org);
      const userId = uniqueName("user");
      const asUser = lane.clientsPresenting(await mintUserToken(admin.as, context.org, userId));
      const accountId = await lane.accountIdOf(asUser);
      const founderId = await lane.accountIdOf(lane.clients);

      // A later change of the role does not reach an existing account.
      await setEmbedding(lane.clients, context.org, { signInRole: IamRole.viewer });
      await mintUserToken(admin.as, context.org, userId);

      const access = await lane.clients.grantQuery.listResourceAccessByPrincipal({
        resource: { kind: "organization", id: context.org },
      });
      const entryOf = (id: string) => access.entries.find((entry) => entry.principal?.id === id);
      expect(entryOf(accountId)?.principal?.identityOrigin?.provisioningMode).toBe(
        IdentityAccountProvisioningMode.app_user,
      );
      expect(entryOf(accountId)?.roles.map((role) => role.role?.code)).toEqual(["member"]);
      expect(entryOf(founderId), `the founder ${founderId} is on the access list`).toBeDefined();
      expect(entryOf(founderId)?.principal?.identityOrigin?.provisioningMode).not.toBe(
        IdentityAccountProvisioningMode.app_user,
      );
    });

    it("[rpc:TokenService.mintUserToken] with account creation off an unknown person is refused", async () => {
      const context = await tenancy({ createAccountsOnSignIn: false });
      const admin = await minter(context.org);
      const userId = uniqueName("user");
      const refused = await expectGrpcCode(
        () => mintUserToken(admin.as, context.org, userId),
        Code.FailedPrecondition,
        "a mint for an unknown person with account creation off",
      );
      expect(refused.rawMessage).toBe(noAccountMessage(userId, context.org));
    });
  },
);

describe.skipIf(!enforcementServed)(
  "user-token enforcement — the minter's contract (userTokens targets)",
  () => {
    it("[rpc:IdentityAccountCommandController.delete] deleting the minting service account revokes its user tokens on the next request", async () => {
      const context = await tenancy();
      const admin = await minter(context.org, { keep: true });
      const asUser = lane.clientsPresenting(
        await mintUserToken(admin.as, context.org, uniqueName("user")),
      );
      await asUser.organizationQuery.listMine({});

      await deleteMinter(lane.clients, admin.accountId);

      const denied = await expectGrpcCode(
        () => asUser.organizationQuery.listMine({}),
        Code.Unauthenticated,
        "a request with a deleted service account's user token",
      );
      expect(denied.rawMessage).toBe(DELETED_MINTER_MESSAGE);
    });

    it("[rpc:ApiKeyCommandController.delete] revoking the minter's key leaves its tokens working, and the revoked key mints nothing", async () => {
      const context = await tenancy();
      const admin = await minter(context.org);
      const asUser = lane.clientsPresenting(
        await mintUserToken(admin.as, context.org, uniqueName("user")),
      );
      const keys = await lane.clients.apiKeyQuery.listByAccount({ accountId: admin.accountId });
      for (const key of keys.entries) {
        await lane.clients.apiKeyCommand.delete({ value: key.metadata?.id ?? "" });
      }

      await asUser.organizationQuery.listMine({});
      await expectGrpcCode(
        () => mintUserToken(admin.as, context.org, uniqueName("user")),
        Code.Unauthenticated,
        "a mint with a revoked key",
      );
    });

    it("a browser request from an origin outside allowed_origins is refused on the next request after the settings change", async () => {
      const context = await tenancy();
      const admin = await minter(context.org);
      const token = await mintUserToken(admin.as, context.org, uniqueName("user"));
      const foreignBrowser = lane.clientsPresenting(token, { origin: "https://evil.example" });
      await foreignBrowser.organizationQuery.listMine({});

      await setEmbedding(lane.clients, context.org, { allowedOrigins: ["https://allowed.example"] });

      const denied = await expectGrpcCode(
        () => foreignBrowser.organizationQuery.listMine({}),
        Code.PermissionDenied,
        "leaked-token replay from a foreign browser origin",
      );
      expect(denied.rawMessage).toBe(originRefusalMessage("https://evil.example"));
      // The listed origin passes, compared case-insensitively, and a
      // request without an Origin header always does.
      await lane
        .clientsPresenting(token, { origin: "https://ALLOWED.example" })
        .organizationQuery.listMine({});
      await lane.clientsPresenting(token).organizationQuery.listMine({});
    });
  },
);

describe.skipIf(!enforcementServed)(
  "user-token enforcement — who changes the settings (userTokens targets)",
  () => {
    it("[rpc:OrganizationCommandController.updateEmbedding] a service account's key is refused, an admin's included, and so is a member", async () => {
      const context = await tenancy();
      const admin = await minter(context.org);
      const asKey = await expectGrpcCode(
        () => setEmbedding(admin.as, context.org, { signInRole: IamRole.admin }),
        Code.PermissionDenied,
        "a service account's key changing the embedding settings",
      );
      expect(asKey.rawMessage).toContain("change the organization's embedding settings");
      const member = await lane.provisionMember(context);
      await expectGrpcCode(
        () => setEmbedding(member, context.org, { signInRole: IamRole.admin }),
        Code.PermissionDenied,
        "a member changing the embedding settings",
      );
    });
  },
);
