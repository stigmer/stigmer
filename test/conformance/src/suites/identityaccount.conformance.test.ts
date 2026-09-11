// Conformance suite for the IdentityAccount domain (20260911.11 — the
// identity-account domain served ONCE by @stigmer/server in every edition;
// the cloud composition serves it over its own table through the store
// driver).
// Domain: iam / identityaccount.
//
// Drives IdentityAccountCommandController + IdentityAccountQueryController
// through the raw proto stubs and asserts the cross-edition contract:
//   - create assigns an ida_ id and answers the created account; the
//     backend assigns is_machine_account and provisioning_mode whatever the
//     caller sent; a second create for a held subject is ALREADY_EXISTS;
//   - get / getByEmail / getByIdpId answer the byte-pinned NOT_FOUND copy
//     ("Identity account not found: <handle>", the cloud's Java copy);
//   - update round-trips preferences — the console's one write; an update
//     that changes spec.idp_id is FAILED_PRECONDITION (the subject IS the
//     identity; T01_1_review.md A1). This arm is red against a cloud
//     composition older than the re-point BY DESIGN, the #544 precedent in
//     the apikey suite;
//   - delete answers the account and frees the subject;
//   - getActorInfo names the account as audit stamps do;
//   - the four federation RPCs are UNIMPLEMENTED where no unit composes the
//     capability (the local OSS targets) — pinned through the capability
//     flag, never a target name.
//
// Posture arms, gated on capability flags:
//   - trusted-local (requiresAuthentication false): whoAmI on a fresh
//     server answers the operator's account with no prior call (A2: the
//     boot-time ensure); provisionMyAccount is the idempotent early return;
//     the operator's preferences round-trip.
//   - the OIDC lane (Q-IA-2, Q-IA-10): on a target that can spawn a
//     sibling server (spawnSibling), one server boots in the OIDC posture
//     against the harness's local issuer (harness/local-oidc-issuer.ts):
//     an unprovisioned subject is idp-shaped (whoAmI NOT_FOUND with the
//     cloud's copy), provisionMyAccount creates the account from the
//     issuer's /userinfo, the next request resolves to it, and two
//     concurrent first logins end in one account. The cloud's own lane is
//     the direct-login suite (directLogin), the oracle this move keeps green.
//
// Deliberately OUT of this suite: how the id is derived (server-internal;
// the server's unit suites pin it), the personal organization (a cloud
// composition arm, pinned by the direct-login suite), authorization
// postures on update/delete (edition-specific, DD-012).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import {
  startLocalOidcIssuer,
  type LocalOidcIssuer,
} from "../harness/local-oidc-issuer";
import { uniqueName } from "../support/naming";
import {
  createTarget,
  type SiblingServer,
  type TargetProfile,
} from "../targets";

const API_VERSION = "iam.stigmer.ai/v1";
const KIND = "IdentityAccount";

// The cloud handlers' copy, moved into @stigmer/server as-is.
const ACCOUNT_NOT_FOUND_FOR_CALLER =
  "Identity account not found for the authenticated user";
const accountNotFound = (handle: string) =>
  `Identity account not found: ${handle}`;
const IDP_ID_IMMUTABLE = (subject: string) =>
  `spec.idp_id is immutable (account subject is '${subject}') — create a new account for a different subject`;

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();
const capabilities = createTarget().capabilities;

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

function freshSubject(): string {
  return `auth0|conformance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAccount(
  using: ConformanceClients,
  overrides?: {
    idpId?: string;
    email?: string;
    isMachineAccount?: boolean;
    provisioningMode?: IdentityAccountProvisioningMode;
  },
) {
  const idpId = overrides?.idpId ?? freshSubject();
  const email = overrides?.email ?? `${uniqueName("person")}@example.com`;
  const created = await using.identityAccountCommand.create({
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { name: email },
    spec: {
      idpId,
      email,
      firstName: "Conformance",
      lastName: "Person",
      ...(overrides?.isMachineAccount !== undefined
        ? { isMachineAccount: overrides.isMachineAccount }
        : {}),
      ...(overrides?.provisioningMode !== undefined
        ? { provisioningMode: overrides.provisioningMode }
        : {}),
    },
  });
  fixtures.defer(() =>
    using.identityAccountCommand.delete({ value: created.metadata!.id }),
  );
  return created;
}

describe("IdentityAccount conformance — the shared RPC contract", () => {
  it("create assigns an ida_ id and answers the created account", async () => {
    const subject = freshSubject();
    const created = await createAccount(clients, { idpId: subject });

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(
      /^ida_[0-9a-z]+$/,
    );
    expect(created.spec?.idpId).toBe(subject);
    expect(created.spec?.provisioningMode).toBe(
      IdentityAccountProvisioningMode.direct,
    );
    expect(created.spec?.isMachineAccount).toBe(false);
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("the backend assigns is_machine_account and provisioning_mode, whatever the caller sent", async () => {
    const person = await createAccount(clients, {
      isMachineAccount: true,
      provisioningMode: IdentityAccountProvisioningMode.federated,
    });
    expect(
      person.spec?.isMachineAccount,
      "a person is never a machine by request",
    ).toBe(false);
    expect(person.spec?.provisioningMode, "create makes DIRECT accounts").toBe(
      IdentityAccountProvisioningMode.direct,
    );

    const machine = await createAccount(clients, {
      idpId: `${uniqueName("svc")}@clients`,
      isMachineAccount: false,
    });
    expect(
      machine.spec?.isMachineAccount,
      "the @clients suffix IS the machine flag",
    ).toBe(true);
  });

  it("a second create for a held subject is ALREADY_EXISTS and the first row stands", async () => {
    const subject = freshSubject();
    const first = await createAccount(clients, {
      idpId: subject,
      email: "first@example.com",
    });

    const error = await expectGrpcCode(
      () =>
        clients.identityAccountCommand.create({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "second" },
          spec: { idpId: subject, email: "second@example.com" },
        }),
      Code.AlreadyExists,
      "create for a subject that already has an account",
    );
    expect(error.rawMessage, "the refusal names the subject").toContain(
      subject,
    );

    const fetched = await clients.identityAccountQuery.get({
      value: first.metadata!.id,
    });
    expect(fetched.spec?.email).toBe("first@example.com");
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
      accountNotFound("ida_00000000000000000000000000"),
    );

    const email = `${uniqueName("nobody")}@example.com`;
    const byEmail = await expectGrpcCode(
      () => clients.identityAccountQuery.getByEmail({ value: email }),
      Code.NotFound,
      "getByEmail for an unknown email",
    );
    expect(byEmail.rawMessage).toBe(accountNotFound(email));

    const subject = freshSubject();
    const byIdpId = await expectGrpcCode(
      () => clients.identityAccountQuery.getByIdpId({ value: subject }),
      Code.NotFound,
      "getByIdpId for an unknown subject",
    );
    expect(byIdpId.rawMessage).toBe(accountNotFound(subject));
  });

  it("getByEmail and getByIdpId find what create wrote", async () => {
    const subject = freshSubject();
    const email = `${uniqueName("findable")}@example.com`;
    const created = await createAccount(clients, { idpId: subject, email });

    expect(
      (await clients.identityAccountQuery.getByEmail({ value: email })).metadata
        ?.id,
    ).toBe(created.metadata?.id);
    expect(
      (await clients.identityAccountQuery.getByIdpId({ value: subject }))
        .metadata?.id,
    ).toBe(created.metadata?.id);
  });

  it("update round-trips preferences — the console's one write", async () => {
    const created = await createAccount(clients);
    const updated = await clients.identityAccountCommand.update({
      ...created,
      spec: {
        ...created.spec,
        preferences: {
          defaultHarness: "cursor",
          defaultCursorModel: "gpt-5",
          defaultAutoApprove: true,
        },
      },
    });
    expect(updated.metadata?.id).toBe(created.metadata?.id);

    const fetched = await clients.identityAccountQuery.get({
      value: created.metadata!.id,
    });
    expect(fetched.spec?.preferences).toMatchObject({
      defaultHarness: "cursor",
      defaultCursorModel: "gpt-5",
      defaultAutoApprove: true,
    });
  });

  it("update refuses a changed subject with FAILED_PRECONDITION — the subject IS the identity", async () => {
    const subject = freshSubject();
    const created = await createAccount(clients, { idpId: subject });

    const error = await expectGrpcCode(
      () =>
        clients.identityAccountCommand.update({
          ...created,
          spec: { ...created.spec, idpId: freshSubject() },
        }),
      Code.FailedPrecondition,
      "update that changes spec.idp_id",
    );
    expect(error.rawMessage).toBe(IDP_ID_IMMUTABLE(subject));

    const fetched = await clients.identityAccountQuery.get({
      value: created.metadata!.id,
    });
    expect(fetched.spec?.idpId, "the stored subject is untouched").toBe(
      subject,
    );
  });

  it("delete answers the account and frees the subject", async () => {
    const subject = freshSubject();
    const created = await clients.identityAccountCommand.create({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { name: "deletable" },
      spec: { idpId: subject, email: `${uniqueName("deletable")}@example.com` },
    });

    const deleted = await clients.identityAccountCommand.delete({
      value: created.metadata!.id,
    });
    expect(deleted.metadata?.id).toBe(created.metadata?.id);

    await expectGrpcCode(
      () => clients.identityAccountQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
    const again = await createAccount(clients, { idpId: subject });
    expect(again.spec?.idpId, "the subject can be provisioned again").toBe(
      subject,
    );
  });

  it("getActorInfo names the account as audit stamps do", async () => {
    const email = `${uniqueName("actor")}@example.com`;
    const created = await createAccount(clients, { email });
    const actor = await clients.identityAccountQuery.getActorInfo({
      value: created.metadata!.id,
    });
    expect(actor.id).toBe(created.metadata?.id);
    expect(actor.email).toBe(email);
  });
});

describe.skipIf(capabilities.federatedIdentityAccounts)(
  "IdentityAccount conformance — no federation capability composed",
  () => {
    it.each([
      [
        "createFederatedAccount",
        () => clients.identityAccountCommand.createFederatedAccount({}),
      ],
      [
        "updateFederatedAccount",
        () => clients.identityAccountCommand.updateFederatedAccount({}),
      ],
      [
        "deprovisionFederatedAccount",
        () => clients.identityAccountCommand.deprovisionFederatedAccount({}),
      ],
      [
        "getByExternalSub",
        () => clients.identityAccountQuery.getByExternalSub({}),
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
    it("a fresh server answers whoAmI with the operator's account before any client called anything", async () => {
      const me = await clients.identityAccountQuery.whoAmI({});
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
      const me = await clients.identityAccountQuery.whoAmI({});
      const provisioned =
        await clients.identityAccountCommand.provisionMyAccount({});
      expect(provisioned.metadata?.id).toBe(me.metadata?.id);
    });

    it("the operator's preferences round-trip through update and whoAmI", async () => {
      const me = await clients.identityAccountQuery.whoAmI({});
      await clients.identityAccountCommand.update({
        ...me,
        spec: {
          ...me.spec,
          preferences: {
            defaultHarness: "native",
            defaultNativeModel: "claude",
          },
        },
      });
      const again = await clients.identityAccountQuery.whoAmI({});
      expect(again.spec?.preferences).toMatchObject({
        defaultHarness: "native",
        defaultNativeModel: "claude",
      });
      // Leave the operator as we found it for the arms after us.
      await clients.identityAccountCommand.update({
        ...again,
        spec: { ...again.spec, preferences: me.spec?.preferences },
      });
    });
  },
);

describe("IdentityAccount conformance — the OIDC lane on a sibling server (Q-IA-2, Q-IA-10)", () => {
  let issuer: LocalOidcIssuer | undefined;
  let sibling: SiblingServer | undefined;

  beforeAll(async () => {
    if (target.spawnSibling === undefined) return;
    issuer = await startLocalOidcIssuer();
    sibling = await target.spawnSibling({
      STIGMER_OIDC_ISSUER: issuer.issuer,
      STIGMER_OIDC_AUDIENCE: issuer.audience,
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
      () => asUser.identityAccountQuery.whoAmI({}),
      Code.NotFound,
      "whoAmI for an admitted subject with no account",
    );
    expect(error.rawMessage).toBe(ACCOUNT_NOT_FOUND_FOR_CALLER);
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

    const me = await asUser.identityAccountQuery.whoAmI({});
    expect(me.metadata?.id).toBe(account.metadata?.id);

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

    // And over the key, whoAmI is the owner's account — the key is the user.
    const overKey = sibling.clientsPresenting(key.spec?.keyHash ?? "");
    expect((await overKey.identityAccountQuery.whoAmI({})).metadata?.id).toBe(
      account.metadata?.id,
    );
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
      expect(
        error.rawMessage.startsWith(
          "Failed to fetch user profile from identity provider: ",
        ),
      ).toBe(true);
      await expectGrpcCode(
        () => asUser.identityAccountQuery.whoAmI({}),
        Code.NotFound,
        "whoAmI after a failed provisioning",
      );
    } finally {
      issuer.refuseUserinfoFor(undefined);
    }
  });
});
