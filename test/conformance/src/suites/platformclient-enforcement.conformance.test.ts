// Platform-client enforcement conformance: the mint and the minting
// client's contract, on the target's ENFORCING lane.
//
// A server mints PlatformClient user tokens only when it authenticates its
// callers, so every arm runs where one does: the cloud's primary, and on the
// local targets the open-source sibling booted in the OIDC posture
// (harness/enforcing-lane.ts). The same arms, the same byte-pinned copy, on
// both — which is what lets the cloud move onto open source's PlatformClient
// without an integrator seeing a changed refusal.
//
// The minting client's contract, on every serving-edge request a user token
// bears:
//   - deletion-revocation (stigmer-cloud#342): deleting the platform client
//     revokes its outstanding user tokens on the NEXT request — refused
//     UNAUTHENTICATED, fail closed;
//   - Origin vs allowed_origins (stigmer/stigmer#375): a browser request
//     from an origin outside the client's allowlist is refused
//     PERMISSION_DENIED; a request without an Origin header never is.
//
// The mint's contract:
//   - the minted token IS the end user: one account per (organization,
//     user_id), whichever of the organization's clients minted it;
//   - an auto-provisioned user holds exactly the auto-grant role on the
//     owning organization and sees that organization alone;
//   - a wrong secret, an org_id that is not the owning organization, and a
//     client that does not provision users are refused with the pinned copy;
//   - rotating the secret stops the old one minting and leaves minted tokens
//     valid until they expire.
//
// Reads of the client itself: an outsider can neither read a client by
// reference nor list the organization's clients, and a member — who may
// view the organization — lists none (the model gives members no access to
// a credential).
//
// Out of scope here: the CRUD contract on the primary
// (platformclient.conformance.test.ts) and the server that trusts every
// request, which refuses the mint (same file).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { expectGrpcCode } from "../contract/errors";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import {
  createPlatformClient,
  deletePlatformClient,
  mintUserToken,
  type ProvisionedPlatformClient,
} from "../support/platformclients";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";

// The Java interceptor's UNAUTHENTICATED copy, byte-pinned on every edition.
const DELETED_CLIENT_MESSAGE =
  "The platform client that minted this token has been deleted, " +
  "so the token is no longer accepted. Mint a new user token " +
  "from an active platform client.";

// The Java interceptor's PERMISSION_DENIED copy; the refused origin is
// interpolated raw (origins are public identifiers).
function originRefusalMessage(origin: string): string {
  return (
    `Request origin '${origin}' is not in this platform client's ` +
    "allowed_origins. Add it to the PlatformClient's allowed_origins to " +
    "permit browser requests from this origin."
  );
}

const INVALID_CREDENTIALS_MESSAGE = "Invalid client_id or client_secret";

function organizationMismatchMessage(owningOrg: string): string {
  return (
    "org_id must be empty or the PlatformClient's owning organization " +
    `('${owningOrg}'); cross-organization minting is not supported`
  );
}

function noAccountMessage(userId: string, org: string): string {
  return (
    `User '${userId}' has no Stigmer account in organization '${org}'. ` +
    "Enable auto_provision_accounts on the PlatformClient or create the account first."
  );
}

const enforcementServed = createTarget().capabilities.platformClientTokens;

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
      `target "${target.name}" declares platformClientTokens but offers no enforcing lane: ${enforcing.reason}`,
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

// An organization the founder owns, cleaned up after the arm.
async function tenancy(): Promise<TenancyContext> {
  const context = await lane.provisionTenancy();
  fixtures.defer(() => lane.cleanupTenancy(context));
  return context;
}

// A client in the organization, deleted after the arm unless the arm deletes it.
async function platformClient(
  org: string,
  options: {
    allowedOrigins?: readonly string[];
    autoProvisionAccounts?: boolean;
    autoGrantRole?: IamRole;
    keep?: boolean;
  } = {},
): Promise<ProvisionedPlatformClient> {
  const client = await createPlatformClient(lane.clients, {
    org,
    name: uniqueName("enforcement-pc"),
    ...options,
  });
  if (options.keep !== true) {
    fixtures.defer(() => deletePlatformClient(lane.clients, client.id));
  }
  return client;
}

describe.skipIf(!enforcementServed)(
  "platform-client enforcement — the minting client's contract (platformClientTokens targets)",
  () => {
    it("deleting the platform client revokes its outstanding user tokens on the next request", async () => {
      const context = await tenancy();
      const client = await platformClient(context.org, { keep: true });
      const token = await mintUserToken(
        lane.clients,
        client.credentials,
        uniqueName("enforcement-user"),
      );
      const minted = lane.clientsPresenting(token);

      // findMyOrganizations answers any authenticated caller, so the flip
      // below isolates the enforcement, not a grant.
      await minted.organizationQuery.findMyOrganizations({});

      await deletePlatformClient(lane.clients, client.id);

      const denied = await expectGrpcCode(
        () => minted.organizationQuery.findMyOrganizations({}),
        Code.Unauthenticated,
        "request with a deleted platform client's user token",
      );
      expect(denied.rawMessage).toBe(DELETED_CLIENT_MESSAGE);
    });

    it("a browser request from an origin outside allowed_origins is refused", async () => {
      const context = await tenancy();
      const client = await platformClient(context.org, {
        allowedOrigins: ["https://allowed.example"],
      });
      const token = await mintUserToken(
        lane.clients,
        client.credentials,
        uniqueName("enforcement-user"),
      );
      const foreignBrowser = lane.clientsPresenting(token, {
        origin: "https://evil.example",
      });

      const denied = await expectGrpcCode(
        () => foreignBrowser.organizationQuery.findMyOrganizations({}),
        Code.PermissionDenied,
        "leaked-token replay from a foreign browser origin",
      );
      expect(denied.rawMessage).toBe(
        originRefusalMessage("https://evil.example"),
      );

      // The listed origin passes, compared case-insensitively.
      await lane
        .clientsPresenting(token, { origin: "https://ALLOWED.example" })
        .organizationQuery.findMyOrganizations({});
    });

    it("a request without an Origin header passes an allowlisted client (absence never refuses)", async () => {
      const context = await tenancy();
      const client = await platformClient(context.org, {
        allowedOrigins: ["https://allowed.example"],
      });
      const token = await mintUserToken(
        lane.clients,
        client.credentials,
        uniqueName("enforcement-user"),
      );

      await lane
        .clientsPresenting(token)
        .organizationQuery.findMyOrganizations({});
    });
  },
);

describe.skipIf(!enforcementServed)(
  "platform-client enforcement — the mint's contract (platformClientTokens targets)",
  () => {
    it("one user_id is one account across the organization's clients, and a repeat mint reuses it", async () => {
      const context = await tenancy();
      const dashboard = await platformClient(context.org);
      const mobile = await platformClient(context.org);
      const userId = uniqueName("enforcement-user");

      const first = await lane.accountIdOf(
        lane.clientsPresenting(
          await mintUserToken(lane.clients, dashboard.credentials, userId),
        ),
      );
      const again = await lane.accountIdOf(
        lane.clientsPresenting(
          await mintUserToken(lane.clients, dashboard.credentials, userId),
        ),
      );
      const viaMobile = await lane.accountIdOf(
        lane.clientsPresenting(
          await mintUserToken(lane.clients, mobile.credentials, userId),
        ),
      );

      expect(again, "a repeat mint must resolve the same account").toBe(first);
      expect(
        viaMobile,
        "another client of the organization must resolve the same account",
      ).toBe(first);
    });

    it("an auto-provisioned user holds the auto-grant role on the owning organization and sees it alone", async () => {
      const context = await tenancy();
      const client = await platformClient(context.org, {
        autoGrantRole: IamRole.member,
      });
      const token = await mintUserToken(
        lane.clients,
        client.credentials,
        uniqueName("enforcement-user"),
      );

      const mine = await lane
        .clientsPresenting(token)
        .organizationQuery.findMyOrganizations({});
      expect(
        mine.entries.map((organization) => organization.metadata?.slug),
      ).toEqual([context.org]);
    });

    it("a wrong secret and an org_id other than the owning organization are refused with the pinned copy", async () => {
      const context = await tenancy();
      const client = await platformClient(context.org);

      const wrongSecret = await expectGrpcCode(
        () =>
          mintUserToken(
            lane.clients,
            {
              clientId: client.credentials.clientId,
              clientSecret: "stgm_cs_not-the-secret",
            },
            uniqueName("enforcement-user"),
          ),
        Code.Unauthenticated,
        "mint with a wrong client secret",
      );
      expect(wrongSecret.rawMessage).toBe(INVALID_CREDENTIALS_MESSAGE);

      const unknownClient = await expectGrpcCode(
        () =>
          mintUserToken(
            lane.clients,
            {
              clientId: "stgm_cid_unknown",
              clientSecret: client.credentials.clientSecret,
            },
            uniqueName("enforcement-user"),
          ),
        Code.Unauthenticated,
        "mint with an unknown client_id",
      );
      expect(unknownClient.rawMessage).toBe(INVALID_CREDENTIALS_MESSAGE);

      const otherOrg = await expectGrpcCode(
        () =>
          mintUserToken(
            lane.clients,
            client.credentials,
            uniqueName("enforcement-user"),
            {
              orgId: `${context.org}-elsewhere`,
            },
          ),
        Code.InvalidArgument,
        "mint confirming an organization the client does not belong to",
      );
      expect(otherOrg.rawMessage).toBe(
        organizationMismatchMessage(context.org),
      );
    });

    it("a client that does not provision users refuses an unknown user", async () => {
      const context = await tenancy();
      const client = await platformClient(context.org, {
        autoProvisionAccounts: false,
      });
      const userId = uniqueName("enforcement-user");

      const refused = await expectGrpcCode(
        () => mintUserToken(lane.clients, client.credentials, userId),
        Code.FailedPrecondition,
        "mint for an unknown user through a client that does not provision",
      );
      expect(refused.rawMessage).toBe(noAccountMessage(userId, context.org));
    });

    it("rotating the secret stops the old one minting; tokens already minted stay valid", async () => {
      const context = await tenancy();
      const client = await platformClient(context.org);
      const token = await mintUserToken(
        lane.clients,
        client.credentials,
        uniqueName("enforcement-user"),
      );

      const rotated = await lane.clients.platformClientCommand.rotateSecret({
        value: client.id,
      });
      expect(rotated.platformClient?.spec?.clientId).toBe(
        client.credentials.clientId,
      );
      expect(rotated.clientSecret).not.toBe(client.credentials.clientSecret);

      const stale = await expectGrpcCode(
        () =>
          mintUserToken(
            lane.clients,
            client.credentials,
            uniqueName("enforcement-user"),
          ),
        Code.Unauthenticated,
        "mint with the secret the rotation replaced",
      );
      expect(stale.rawMessage).toBe(INVALID_CREDENTIALS_MESSAGE);

      await mintUserToken(
        lane.clients,
        {
          clientId: client.credentials.clientId,
          clientSecret: rotated.clientSecret,
        },
        uniqueName("enforcement-user"),
      );
      await lane
        .clientsPresenting(token)
        .organizationQuery.findMyOrganizations({});
    });
  },
);

describe.skipIf(!enforcementServed)(
  "platform-client enforcement — who reads a client (platformClientTokens targets)",
  () => {
    it("an outsider can neither read a client by reference nor list the organization's clients", async () => {
      const context = await tenancy();
      const client = await platformClient(context.org);
      const outsider = await lane.provisionIdentity();

      const byReference = await expectGrpcCode(
        () =>
          outsider.platformClientQuery.getByReference({
            org: context.org,
            slug: client.slug,
          }),
        Code.PermissionDenied,
        "an outsider reading a platform client by reference",
      );
      expect(byReference.rawMessage).toBe(
        "unauthorized to view platform client",
      );

      const listed = await expectGrpcCode(
        () => outsider.platformClientQuery.listByOrg({ org: context.org }),
        Code.PermissionDenied,
        "an outsider listing the organization's platform clients",
      );
      expect(listed.rawMessage).toBe(
        "unauthorized to list platform clients in this organization",
      );
    });

    it("a member lists none of the organization's clients; the owner lists them without the secret hash", async () => {
      const context = await tenancy();
      const client = await platformClient(context.org);
      const member = await lane.provisionMember(context);

      const asMember = await member.platformClientQuery.listByOrg({
        org: context.org,
      });
      expect(
        asMember.entries,
        "a member has no access to a credential",
      ).toEqual([]);

      const asOwner = await lane.clients.platformClientQuery.listByOrg({
        org: context.org,
      });
      const listed = asOwner.entries.find(
        (entry) => entry.metadata?.id === client.id,
      );
      expect(listed, "the owner lists the client it created").toBeDefined();
      expect(listed?.spec?.clientSecretHash).toBe("");
    });
  },
);
