// Conformance suite for a license's terms as a licensed server keeps them:
// the organization limit, the operator's creator list, and the lapse
// (Class A; no runner).
// Domain: platform / license.
//
// Each block boots its own licensed sibling (TargetProfile.spawnSibling) on
// the terms it is about, signs its people in through an issuer the block
// starts, and drives the server over the wire:
//   - the limit: a license for two organizations admits an organization and
//     a child of it, because children count as sold, and refuses the third
//     with FAILED_PRECONDITION, reason ORGANIZATION_LIMIT_REACHED, metadata
//     `limit`; deleting the child admits a create again;
//   - the creator list: where the operator lists who may create
//     organizations, an unlisted person is refused with PERMISSION_DENIED,
//     reason ORGANIZATION_CREATOR_NOT_LISTED, metadata `account` naming
//     their own account (anyone signed in creates elsewhere, which every
//     tenancy on the primary already shows);
//   - the lapse, the operator's real path: data is written under a current
//     license, then the server restarts with one that has run out
//     (SiblingServer.restart). getLicenseStatus answers `expired`;
//     organization, team and federation issuer creates, an issuer's update
//     and apply are refused with LICENSE_RENEWAL_REQUIRED; and nobody is
//     locked out: the founder signs in and reads what exists, a colleague
//     redeems an invitation made before the lapse and joins a team, and an
//     issuer is deleted.
// Where `licenseStatus` is not `licensed` (open source, the Cloud), the
// whole file skips: no other target holds a license to keep.
//
// Deliberately out of scope: the order the refusals are asked in (the limit,
// then the creator list, then the lapse) is an implementation order, not a
// promise; a license expiring during a run, which a test can only fake with
// a clock, is the composed suite's (ee/server/src/editions/__tests__/
// enterprise.postgres.test.ts).
import { Code, type ConnectError } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { clone } from "@bufbuild/protobuf";
import { FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { LicenseState } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { startLocalOidcIssuer, type LocalOidcIssuer } from "@stigmer/test-support/local-oidc-issuer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { freshSubject } from "../support/identityaccounts";
import { uniqueName } from "../support/naming";
import { createChildOrganization, createUniqueOrganization } from "../support/organizations";
import { makeTeam, teamMembership } from "../support/teams";
import { createTarget, type SiblingServer, type TargetProfile } from "../targets";

// Collection-time capability read (the billing suites' pattern).
const capabilities = createTarget().capabilities;

let target: TargetProfile;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
});

afterAll(async () => {
  await target?.teardown();
});

// What a lapsed license answers every growth with
// (ee/server/src/license/growth.ts), and the two other refusals' copy
// (backend/services/stigmer-server/src/domain/organization/limit.ts,
// ee/server/src/editions/organization-creators.ts): clients show them as
// they are.
const RENEWAL_MESSAGE =
  "This server's Stigmer Enterprise license has ended; renew it to create organizations, teams or federation issuers. Everything that exists keeps working.";
const limitMessage = (limit: number) => `this server holds ${limit} organizations, its limit`;
const creatorNotListedMessage = (account: string) =>
  `Only the accounts this server's operator lists can create an organization, and yours (${account}) is not one of them. To join an organization, ask one of its admins to invite you; to create one, send the operator your account id.`;

// A license that ran out: a one-day term with no grace, issued two days ago.
const LAPSED_TERMS = JSON.stringify({ days: 1, graceDays: 0, issuedDaysAgo: 2 });
// An account id of the right shape that no one holds.
const NOBODY = "ida_0000000000000000000000000z";

// The person a token names: signed in once, so their account exists.
const PERSON_TTL_SECONDS = 60 * 60;

/** A licensed sibling on the given terms, its issuer, and the founder signed in on it. */
interface Licensed {
  readonly issuer: LocalOidcIssuer;
  readonly sibling: SiblingServer;
  readonly founderToken: string;
  readonly founder: ConformanceClients;
  // The posture the sibling booted in, for a restart to name again.
  readonly oidcEnv: Record<string, string>;
  // A fresh person signed in on the sibling.
  person(): Promise<{ clients: ConformanceClients; accountId: string }>;
  close(): Promise<void>;
}

async function bootLicensed(env: Record<string, string>): Promise<Licensed> {
  if (target.spawnSibling === undefined) {
    throw new Error(`target ${target.name} is licensed but cannot spawn a sibling`);
  }
  const issuer = await startLocalOidcIssuer();
  const mint = () => issuer.mint({ sub: freshSubject(), email: `${uniqueName("person")}@conformance.example.com`, ttlSeconds: PERSON_TTL_SECONDS });
  const founderToken = await mint();
  const oidcEnv = { STIGMER_OIDC_ISSUER: issuer.issuer, STIGMER_OIDC_AUDIENCE: issuer.audience };
  let sibling: SiblingServer;
  try {
    sibling = await target.spawnSibling({ env: { ...oidcEnv, ...env }, readinessBearer: founderToken });
  } catch (error) {
    await issuer.close();
    throw error;
  }
  const founder = sibling.clientsPresenting(founderToken);
  await founder.identityAccountCommand.provisionMyAccount({});
  return {
    issuer,
    sibling,
    founderToken,
    founder,
    oidcEnv,
    async person() {
      const clients = sibling.clientsPresenting(await mint());
      const account = await clients.identityAccountCommand.provisionMyAccount({});
      return { clients, accountId: account.metadata?.id ?? "" };
    },
    async close() {
      await sibling.teardown();
      await issuer.close();
    },
  };
}

function reasonOf(error: ConnectError): { reason: string | undefined; metadata: Record<string, string> } {
  const [info] = error.findDetails(ErrorInfoSchema);
  return { reason: info?.reason, metadata: info?.metadata ?? {} };
}

async function expectRenewalRequired(op: () => Promise<unknown>, context: string): Promise<void> {
  const refused = await expectGrpcCode(op, Code.FailedPrecondition, context);
  expect(refused.rawMessage, context).toBe(RENEWAL_MESSAGE);
  expect(reasonOf(refused).reason, context).toBe("LICENSE_RENEWAL_REQUIRED");
}

// An issuer naming no issuer and no key set, so nothing is dialed.
function makeIssuer(org: string, displayName = "Conformance sign-in") {
  const slug = uniqueName("issuer");
  return {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "FederationIssuer",
    metadata: { name: slug, slug, org },
    spec: { displayName, expectedAudience: `stigmer:${uniqueName("aud")}` },
  };
}

describe.skipIf(capabilities.licenseStatus !== "licensed")("License terms — the organization limit (licensed targets)", () => {
  let licensed: Licensed;

  beforeAll(async () => {
    licensed = await bootLicensed({ STIGMER_TEST_LICENSE_TERMS: JSON.stringify({ maxOrgs: 2 }) });
  });

  afterAll(async () => {
    await licensed?.close();
  });

  it("[rpc:OrganizationCommandController.create] a license for two organizations admits an organization and its child, refuses a third with ORGANIZATION_LIMIT_REACHED, and admits one again once the child is deleted", async () => {
    const { founder } = licensed;
    const parent = await createUniqueOrganization(founder.organizationCommand, "the limit's first organization");
    const child = await createChildOrganization(founder.organizationCommand, parent.id, "the limit's child");

    const refused = await expectGrpcCode(
      () => createUniqueOrganization(founder.organizationCommand, "a third organization"),
      Code.FailedPrecondition,
      "a third organization on a license for two",
    );
    expect(refused.rawMessage).toBe(limitMessage(2));
    expect(reasonOf(refused)).toEqual({ reason: "ORGANIZATION_LIMIT_REACHED", metadata: { limit: "2" } });

    await founder.organizationCommand.delete({ value: child.id });
    const admitted = await createUniqueOrganization(founder.organizationCommand, "the organization the freed seat admits");
    expect(admitted.id).toMatch(/^org_/);
  });
});

describe.skipIf(capabilities.licenseStatus !== "licensed")("License terms — the operator's creator list (licensed targets)", () => {
  let licensed: Licensed;

  beforeAll(async () => {
    licensed = await bootLicensed({ STIGMER_ORGANIZATION_CREATORS: NOBODY });
  });

  afterAll(async () => {
    await licensed?.close();
  });

  it("[rpc:OrganizationCommandController.create] a person the operator's list does not name is refused with ORGANIZATION_CREATOR_NOT_LISTED, naming their own account", async () => {
    const { founder } = licensed;
    const account = (await founder.identityAccountQuery.whoAmI({})).metadata?.id ?? "";
    expect(account, "the founder is a provisioned person").toMatch(/^ida_/);

    const refused = await expectGrpcCode(
      () => createUniqueOrganization(founder.organizationCommand, "an unlisted person's organization"),
      Code.PermissionDenied,
      "an unlisted person's organization",
    );
    expect(refused.rawMessage).toBe(creatorNotListedMessage(account));
    expect(reasonOf(refused)).toEqual({ reason: "ORGANIZATION_CREATOR_NOT_LISTED", metadata: { account } });
  });
});

describe.skipIf(capabilities.licenseStatus !== "licensed")("License terms — a lapsed license freezes growth and locks nobody out (licensed targets)", () => {
  let licensed: Licensed;
  // What the founder made while the license was current.
  let org: string;
  let teamId: string;
  let invitationToken: string;
  let invitationId: string;
  // One issuer the lapsed server is asked to change, one it deletes.
  let kept: { id: string; slug: string };
  let removable: string;

  beforeAll(async () => {
    licensed = await bootLicensed({});
    const { founder } = licensed;
    org = (await createUniqueOrganization(founder.organizationCommand, "the lapse's organization")).id;
    teamId = (await founder.teamCommand.create(makeTeam({ org, name: uniqueName("before-lapse") }))).metadata?.id ?? "";
    const keptIssuer = await founder.federationIssuerCommand.create(makeIssuer(org));
    kept = { id: keptIssuer.metadata?.id ?? "", slug: keptIssuer.metadata?.slug ?? "" };
    removable = (await founder.federationIssuerCommand.create(makeIssuer(org))).metadata?.id ?? "";
    const invitation = await founder.invitationCommand.create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "Invitation",
      metadata: { name: uniqueName("before-lapse"), org },
      spec: { role: IamRole.member, expiresAt: timestampFromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)) },
    });
    invitationToken = invitation.status?.token ?? "";
    invitationId = invitation.metadata?.id ?? "";

    if (licensed.sibling.restart === undefined) {
      throw new Error(`target ${target.name} is licensed but its siblings cannot restart`);
    }
    await licensed.sibling.restart({
      env: { ...licensed.oidcEnv, STIGMER_TEST_LICENSE_TERMS: LAPSED_TERMS },
      readinessBearer: licensed.founderToken,
    });
  });

  afterAll(async () => {
    await licensed?.close();
  });

  it("[rpc:PlatformQueryController.getLicenseStatus] the restarted server reports its license expired, with the ticket's claims", async () => {
    const status = await licensed.founder.platformQuery.getLicenseStatus({});
    expect(status.state).toBe(LicenseState.expired);
    expect(status.claims, "an expired ticket still verified, so its claims are reported").toBeDefined();
  });

  it("[rpc:OrganizationCommandController.create] [rpc:TeamCommandController.create] [rpc:FederationIssuerCommandController.create] [rpc:FederationIssuerCommandController.update] [rpc:FederationIssuerCommandController.apply] creating an organization, a team or a federation issuer, and changing or applying an issuer, are refused with LICENSE_RENEWAL_REQUIRED", async () => {
    const { founder } = licensed;
    await expectRenewalRequired(() => createUniqueOrganization(founder.organizationCommand, "growth after the lapse"), "an organization create");
    await expectRenewalRequired(() => founder.teamCommand.create(makeTeam({ org, name: uniqueName("after-lapse") })), "a team create");
    await expectRenewalRequired(() => founder.federationIssuerCommand.create(makeIssuer(org)), "an issuer create");

    const stored = await founder.federationIssuerQuery.get({ value: kept.id });
    const changed = clone(FederationIssuerSchema, stored);
    if (changed.spec !== undefined) changed.spec.displayName = "Changed after the lapse";
    await expectRenewalRequired(
      () => founder.federationIssuerCommand.update({ resource: changed, updateMask: { paths: ["spec.display_name"] } }),
      "an issuer update",
    );
    await expectRenewalRequired(() => founder.federationIssuerCommand.apply(changed), "an issuer apply");
  });

  it("[rpc:InvitationCommandController.redeem] [rpc:FederationIssuerCommandController.delete] nobody is locked out: the founder reads what exists, a colleague redeems an earlier invitation and joins a team, and an issuer is deleted", async () => {
    const { founder } = licensed;
    expect((await founder.organizationQuery.get({ value: org })).metadata?.id).toBe(org);
    expect((await founder.teamQuery.get({ value: teamId })).metadata?.id).toBe(teamId);
    expect((await founder.federationIssuerQuery.get({ value: kept.id })).metadata?.slug).toBe(kept.slug);
    expect((await founder.invitationQuery.get({ value: invitationId })).status?.token).toBe(invitationToken);

    const colleague = await licensed.person();
    const redeemed = await colleague.clients.invitationCommand.redeem({ token: invitationToken });
    expect(redeemed.status?.redemptionCount).toBe(1);
    const membership = await founder.iamPolicyCommand.create(teamMembership(teamId, colleague.accountId));
    expect(membership.spec?.relation).toBe("member");

    const deleted = await founder.federationIssuerCommand.delete({ resourceId: removable });
    expect(deleted.metadata?.id).toBe(removable);
  });
});
