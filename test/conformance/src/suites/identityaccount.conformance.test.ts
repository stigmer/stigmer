// Conformance suite for the IdentityAccount domain (20260911.11 — the
// identity-account domain served ONCE by @stigmer/server in every edition;
// the cloud composition serves it over its own table through the store
// driver).
// Domain: iam / identityaccount.
//
// Drives IdentityAccountCommandController + IdentityAccountQueryController
// through the raw proto stubs and asserts the cross-edition contract. The
// shared arms run on the CALLER'S OWN account, reached through whoAmI —
// the console's real flow — because `create` is a system RPC: the cloud#393
// gate is core since T01_1_review.md A7, so over the wire a user is
// PERMISSION_DENIED on every edition and no arm may create a fixture
// account. What runs on every target:
//   - create over the wire is PERMISSION_DENIED with the byte-pinned copy
//     and writes nothing;
//   - get / getByEmail / getByIdpId answer the byte-pinned NOT_FOUND copy
//     ("Identity account not found: <handle>", the cloud's Java copy);
//   - getByIdpId (and getByEmail, where the caller has an email) find the
//     caller's own account;
//   - update round-trips preferences — the console's one write; an update
//     that changes spec.idp_id is FAILED_PRECONDITION (the subject IS the
//     identity; A1). That arm is red against a cloud composition older
//     than the re-point BY DESIGN, the #544 precedent in the apikey suite;
//   - getActorInfo names the account as audit stamps do;
//   - the four federation RPCs are UNIMPLEMENTED where no unit composes the
//     capability (the local OSS targets) — pinned through the capability
//     flag, never a target name. Their inputs pass the boundary validator
//     (position 3, before any handler) so the refusal under test is the
//     handler's.
//
// Posture arms, gated on capability flags:
//   - trusted-local (requiresAuthentication false): whoAmI answers the
//     operator's account (A2: ensured at boot, create-if-absent);
//     provisionMyAccount is the idempotent early return.
//   - the OIDC lane (Q-IA-2, Q-IA-10): on a target that can spawn a
//     sibling server (spawnSibling), one server boots in the OIDC posture
//     against the harness's local issuer (harness/local-oidc-issuer.ts):
//     an unprovisioned subject is idp-shaped (whoAmI NOT_FOUND with the
//     cloud's copy), provisionMyAccount creates the account from the
//     issuer's /userinfo, the next request resolves to it, an API key
//     minted over that session answers as the owner (A6), two concurrent
//     first logins end in one account, delete frees the subject, and a
//     userinfo outage is UNAVAILABLE and creates nothing. The cloud's own
//     lane is the direct-login suite (directLogin), the oracle this move
//     keeps green; where no sibling can be spawned the arms skip VISIBLY
//     with the target's reason.
//
// Deliberately OUT of this suite: how the id is derived (server-internal;
// the server's unit suites pin it), the personal organization (a cloud
// composition arm, pinned by the direct-login suite), authorization
// postures on update/delete (edition-specific, DD-012), and the cloud's
// POSITIVE federation behavior (needs an IdentityProvider fixture no
// hermetic target provisions; the composition's own tests carry it).
import { Code } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import {
  startLocalOidcIssuer,
  type LocalOidcIssuer,
} from "../harness/local-oidc-issuer";
import {
  ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE,
  CREATE_IS_INTERNAL_MESSAGE,
  IDENTITY_ACCOUNT_API_VERSION,
  IDENTITY_ACCOUNT_KIND,
  USERINFO_UNAVAILABLE_PREFIX,
  accountNotFoundMessage,
  freshSubject,
  idpIdImmutableMessage,
  withIdpId,
  withPreferences,
} from "../support/identityaccounts";
import { uniqueName } from "../support/naming";
import {
  createTarget,
  type SiblingServer,
  type TargetProfile,
} from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const capabilities = createTarget().capabilities;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterAll(async () => {
  await target?.teardown();
});

// The caller's own account — every mutable arm's subject.
function whoAmI(using: ConformanceClients = clients) {
  return using.identityAccountQuery.whoAmI({});
}

describe("IdentityAccount conformance — the shared RPC contract", () => {
  it("create over the wire as a user is PERMISSION_DENIED with the byte-pinned copy, and nothing is written", async () => {
    const subject = freshSubject();
    const error = await expectGrpcCode(
      () =>
        clients.identityAccountCommand.create({
          apiVersion: IDENTITY_ACCOUNT_API_VERSION,
          kind: IDENTITY_ACCOUNT_KIND,
          metadata: { name: uniqueName("person") },
          spec: {
            idpId: subject,
            email: `${uniqueName("person")}@example.com`,
          },
        }),
      Code.PermissionDenied,
      "create from a wire user (the cloud#393 gate, core since A7)",
    );
    expect(error.rawMessage).toBe(CREATE_IS_INTERNAL_MESSAGE);

    await expectGrpcCode(
      () => clients.identityAccountQuery.getByIdpId({ value: subject }),
      Code.NotFound,
      "getByIdpId for the subject the refused create named",
    );
  });

  it("get / getByEmail / getByIdpId answer the byte-pinned NOT_FOUND copy", async () => {
    const byId = await expectGrpcCode(
      () =>
        clients.identityAccountQuery.get({
          value: "ida_00000000000000000000000000",
        }),
      Code.NotFound,
      "get for an unknown id",
    );
    expect(byId.rawMessage).toBe(
      accountNotFoundMessage("ida_00000000000000000000000000"),
    );

    const email = `${uniqueName("nobody")}@example.com`;
    const byEmail = await expectGrpcCode(
      () => clients.identityAccountQuery.getByEmail({ value: email }),
      Code.NotFound,
      "getByEmail for an unknown email",
    );
    expect(byEmail.rawMessage).toBe(accountNotFoundMessage(email));

    const subject = freshSubject();
    const byIdpId = await expectGrpcCode(
      () => clients.identityAccountQuery.getByIdpId({ value: subject }),
      Code.NotFound,
      "getByIdpId for an unknown subject",
    );
    expect(byIdpId.rawMessage).toBe(accountNotFoundMessage(subject));
  });

  it("getByIdpId finds the caller's own account", async () => {
    const me = await whoAmI();
    const found = await clients.identityAccountQuery.getByIdpId({
      value: me.spec?.idpId ?? "",
    });
    expect(found.metadata?.id).toBe(me.metadata?.id);
  });

  it("getByEmail finds the caller's own account", async (ctx) => {
    const me = await whoAmI();
    const email = me.spec?.email ?? "";
    if (email === "") {
      // The trusted-local operator has an email only when the server was
      // booted with STIGMER_OPERATOR_EMAIL; the harness leaves it unset (the
      // unconfigured-laptop posture A2 was ruled for). The OSS lane's cover
      // for this lookup is the sibling block below, whose provisioned user
      // has the email /userinfo asserted.
      ctx.skip(
        "the caller's account has no email (an operator booted without STIGMER_OPERATOR_EMAIL)",
      );
    }
    const found = await clients.identityAccountQuery.getByEmail({
      value: email,
    });
    expect(found.metadata?.id).toBe(me.metadata?.id);
  });

  it("update round-trips preferences on the caller's own account — the console's one write", async () => {
    const me = await whoAmI();
    try {
      const updated = await clients.identityAccountCommand.update(
        withPreferences(me, {
          defaultHarness: "cursor",
          defaultCursorModel: "gpt-5",
          defaultAutoApprove: true,
        }),
      );
      expect(updated.metadata?.id).toBe(me.metadata?.id);

      const fetched = await clients.identityAccountQuery.get({
        value: me.metadata?.id ?? "",
      });
      expect(fetched.spec?.preferences).toMatchObject({
        defaultHarness: "cursor",
        defaultCursorModel: "gpt-5",
        defaultAutoApprove: true,
      });
    } finally {
      // Leave the account as we found it for the arms after us.
      await clients.identityAccountCommand.update(
        withPreferences(await whoAmI(), me.spec?.preferences),
      );
    }
  });

  it("update refuses a changed subject with FAILED_PRECONDITION — the subject IS the identity", async () => {
    const me = await whoAmI();
    const subject = me.spec?.idpId ?? "";

    const error = await expectGrpcCode(
      () =>
        clients.identityAccountCommand.update(withIdpId(me, freshSubject())),
      Code.FailedPrecondition,
      "update that changes spec.idp_id",
    );
    expect(error.rawMessage).toBe(idpIdImmutableMessage(subject));

    const fetched = await clients.identityAccountQuery.get({
      value: me.metadata?.id ?? "",
    });
    expect(fetched.spec?.idpId, "the stored subject is untouched").toBe(
      subject,
    );
  });

  it("getActorInfo names the caller's account as audit stamps do", async () => {
    const me = await whoAmI();
    const actor = await clients.identityAccountQuery.getActorInfo({
      value: me.metadata?.id ?? "",
    });
    expect(actor.id).toBe(me.metadata?.id);
    expect(actor.email).toBe(me.spec?.email ?? "");
  });
});

describe.skipIf(capabilities.federatedIdentityAccounts)(
  "IdentityAccount conformance — no federation capability composed",
  () => {
    // Inputs that pass the boundary validator (chain position 3, before
    // any handler) so the refusal under test is the HANDLER's: the
    // capability is consulted before any lookup or authorization.
    const ref = { org: "acme", slug: "okta" };
    it.each([
      [
        "createFederatedAccount",
        () =>
          clients.identityAccountCommand.createFederatedAccount({
            org: "acme",
            identityProviderRef: ref,
            externalSub: "okta|1",
            email: "person@example.com",
          }),
      ],
      [
        "updateFederatedAccount",
        () =>
          clients.identityAccountCommand.updateFederatedAccount({
            org: "acme",
            identityProviderRef: ref,
            externalSub: "okta|1",
            email: "person@example.com",
          }),
      ],
      [
        "deprovisionFederatedAccount",
        () =>
          clients.identityAccountCommand.deprovisionFederatedAccount({
            org: "acme",
            identityProviderRef: ref,
            externalSub: "okta|1",
          }),
      ],
      [
        "getByExternalSub",
        () =>
          clients.identityAccountQuery.getByExternalSub({
            org: "acme",
            identityProviderRef: ref,
            externalSub: "okta|1",
          }),
      ],
    ] as const)(
      "%s is UNIMPLEMENTED with the edition reason, never INTERNAL",
      async (name, call) => {
        const error = await expectGrpcCode(
          call,
          Code.Unimplemented,
          `${name} with no federation unit`,
        );
        expect(error.rawMessage).toContain(`.${name} is not implemented: `);
        expect(error.rawMessage).toContain(
          "served by the Enterprise and Cloud editions",
        );
      },
    );
  },
);

describe.skipIf(capabilities.requiresAuthentication)(
  "IdentityAccount conformance — the trusted-local posture (A2)",
  () => {
    it("whoAmI answers the operator's account: a direct person under the local| subject namespace", async () => {
      const me = await whoAmI();
      expect(me.metadata?.id).toMatch(/^ida_[0-9a-z]+$/);
      expect(
        me.spec?.idpId,
        "the operator's subject is namespaced local|",
      ).toMatch(/^local\|/);
      expect(me.spec?.provisioningMode).toBe(
        IdentityAccountProvisioningMode.direct,
      );
      expect(me.spec?.isMachineAccount).toBe(false);
    });

    it("provisionMyAccount is the idempotent early return for the operator", async () => {
      const me = await whoAmI();
      const provisioned =
        await clients.identityAccountCommand.provisionMyAccount({});
      expect(provisioned.metadata?.id).toBe(me.metadata?.id);
    });
  },
);

describe("IdentityAccount conformance — the OIDC lane on a sibling server (Q-IA-2, Q-IA-10)", () => {
  let issuer: LocalOidcIssuer | undefined;
  let sibling: SiblingServer | undefined;

  beforeAll(async () => {
    if (target.spawnSibling === undefined) return;
    issuer = await startLocalOidcIssuer();
    // The readiness probe is the harness's one store probe presented with a
    // real token: an idp-shaped fresh subject, which also forces discovery
    // and the JWKS fetch, so a lane that cannot reach the issuer fails at
    // boot with the server's log tail instead of inside the first arm.
    sibling = await target.spawnSibling({
      env: {
        STIGMER_OIDC_ISSUER: issuer.issuer,
        STIGMER_OIDC_AUDIENCE: issuer.audience,
      },
      readinessBearer: await issuer.mint({
        sub: freshSubject(),
        email: "readiness@example.com",
      }),
    });
  });

  afterAll(async () => {
    await sibling?.teardown();
    await issuer?.close();
  });

  function siblingOrSkip(ctx: { skip: (note?: string) => never }): {
    issuer: LocalOidcIssuer;
    sibling: SiblingServer;
  } {
    if (issuer === undefined || sibling === undefined) {
      ctx.skip(
        target.spawnSiblingUnavailable?.() ??
          "the target cannot spawn a sibling server",
      );
    }
    return { issuer, sibling };
  }

  it("no operator account exists under the OIDC posture — a fresh subject is idp-shaped: whoAmI is NOT_FOUND with the cloud's copy", async (ctx) => {
    const { issuer, sibling } = siblingOrSkip(ctx);
    const asUser = sibling.clientsPresenting(
      await issuer.mint({ sub: freshSubject(), email: "fresh@example.com" }),
    );
    const error = await expectGrpcCode(
      () => whoAmI(asUser),
      Code.NotFound,
      "whoAmI for an admitted subject with no account",
    );
    expect(error.rawMessage).toBe(ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE);
  });

  it("provisionMyAccount creates the account from the issuer's /userinfo, and the next request resolves to it", async (ctx) => {
    const { issuer, sibling } = siblingOrSkip(ctx);
    const subject = freshSubject();
    const token = await issuer.mint({
      sub: subject,
      email: "first-login@example.com",
    });
    const asUser = sibling.clientsPresenting(token);

    const account = await asUser.identityAccountCommand.provisionMyAccount({});
    expect(account.metadata?.id).toMatch(/^ida_[0-9a-z]+$/);
    expect(account.spec).toMatchObject({
      idpId: subject,
      email: "first-login@example.com",
      firstName: issuer.profile.givenName,
      lastName: issuer.profile.familyName,
      provisioningMode: IdentityAccountProvisioningMode.direct,
    });
    // Created BY the subject it is for — the stamp is the sub the verifier
    // admitted idp-shaped, because no row existed when the verifier ran.
    expect(account.status?.audit?.specAudit?.createdBy?.id).toBe(subject);

    const me = await whoAmI(asUser);
    expect(me.metadata?.id).toBe(account.metadata?.id);

    // The administrative lookups find it — the OSS-lane cover for the
    // getByEmail arm the shared block skips on an email-less operator.
    expect(
      (
        await asUser.identityAccountQuery.getByEmail({
          value: "first-login@example.com",
        })
      ).metadata?.id,
    ).toBe(account.metadata?.id);

    // From now on the caller IS the account: a write is stamped with it.
    const key = await asUser.apiKeyCommand.create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: uniqueName("key"), org: "local" },
      spec: {},
    });
    expect(key.status?.audit?.specAudit?.createdBy?.id).toBe(
      account.metadata?.id,
    );

    // And over the key, whoAmI is the owner's account — the key is the user
    // (A6: every verifier resolves to the account when one exists).
    const overKey = sibling.clientsPresenting(key.spec?.keyHash ?? "");
    expect((await whoAmI(overKey)).metadata?.id).toBe(account.metadata?.id);
  });

  it("provisionMyAccount is idempotent for a provisioned subject", async (ctx) => {
    const { issuer, sibling } = siblingOrSkip(ctx);
    const token = await issuer.mint({
      sub: freshSubject(),
      email: "twice@example.com",
    });
    const asUser = sibling.clientsPresenting(token);
    const first = await asUser.identityAccountCommand.provisionMyAccount({});
    const second = await asUser.identityAccountCommand.provisionMyAccount({});
    expect(second.metadata?.id).toBe(first.metadata?.id);
  });

  it("two concurrent first logins for one subject end in exactly one account", async (ctx) => {
    const { issuer, sibling } = siblingOrSkip(ctx);
    const subject = freshSubject();
    const asUser = sibling.clientsPresenting(
      await issuer.mint({ sub: subject, email: "racer@example.com" }),
    );

    const [a, b] = await Promise.all([
      asUser.identityAccountCommand.provisionMyAccount({}),
      asUser.identityAccountCommand.provisionMyAccount({}),
    ]);
    expect(a.metadata?.id).toBe(b.metadata?.id);
    const bySubject = await asUser.identityAccountQuery.getByIdpId({
      value: subject,
    });
    expect(bySubject.metadata?.id).toBe(a.metadata?.id);
  });

  it("delete answers the account and frees the subject — the same login provisions the same account again", async (ctx) => {
    const { issuer, sibling } = siblingOrSkip(ctx);
    const subject = freshSubject();
    const asUser = sibling.clientsPresenting(
      await issuer.mint({ sub: subject, email: "deletable@example.com" }),
    );
    const created = await asUser.identityAccountCommand.provisionMyAccount({});

    const deleted = await asUser.identityAccountCommand.delete({
      value: created.metadata?.id ?? "",
    });
    expect(deleted.metadata?.id).toBe(created.metadata?.id);

    // The verifier misses on the next request, so the caller is idp-shaped
    // again — exactly the state a never-provisioned subject is in.
    const error = await expectGrpcCode(
      () => whoAmI(asUser),
      Code.NotFound,
      "whoAmI after deleting one's own account",
    );
    expect(error.rawMessage).toBe(ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE);

    const again = await asUser.identityAccountCommand.provisionMyAccount({});
    expect(again.spec?.idpId, "the subject can be provisioned again").toBe(
      subject,
    );
    expect(
      again.metadata?.id,
      "one subject, one account id — before and after the delete",
    ).toBe(created.metadata?.id);
  });

  it("a userinfo failure is UNAVAILABLE with the cloud's copy and creates nothing", async (ctx) => {
    const { issuer, sibling } = siblingOrSkip(ctx);
    const subject = freshSubject();
    const token = await issuer.mint({
      sub: subject,
      email: "down@example.com",
    });
    issuer.refuseUserinfoFor(subject);
    try {
      const asUser = sibling.clientsPresenting(token);
      const error = await expectGrpcCode(
        () => asUser.identityAccountCommand.provisionMyAccount({}),
        Code.Unavailable,
        "provisionMyAccount while the issuer's userinfo is down",
      );
      expect(error.rawMessage.startsWith(USERINFO_UNAVAILABLE_PREFIX)).toBe(
        true,
      );
      await expectGrpcCode(
        () => whoAmI(asUser),
        Code.NotFound,
        "whoAmI after a failed provisioning",
      );
    } finally {
      issuer.refuseUserinfoFor(undefined);
    }
  });
});
