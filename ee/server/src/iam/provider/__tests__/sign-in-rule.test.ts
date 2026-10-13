/**
 * Pins Enterprise's organization sign-in rule (../sign-in-rule.ts):
 *
 *   - the requiring organizations are the live SSO providers' that set
 *     `sso_required`, and nothing else (a provider that is not the SSO
 *     provider, or does not require it, adds none);
 *   - the set is read once and served from memory until a provider write
 *     invalidates it or the TTL passes; a read begun before an
 *     invalidation is not remembered;
 *   - the account the organization's provider made counts, and so does a
 *     key it made (a key acts as its account); one of the organization's
 *     own people whose account another sign-in or another provider made is
 *     refused with SSO_REQUIRED, the organization and the provider's slug;
 *   - its own people are those holding a role in it, directly or through a
 *     team, and any credential bound to it; anyone else (a child
 *     organization's member reading what it shares down) is not held;
 *   - the organization's owners are exempt, read from the same policy pair;
 *   - a user token the organization's own platform client minted is
 *     exempt, and one another organization's client minted is not;
 *   - the caller's account, and where it stands in an organization, are
 *     read once per caller object; a failed read is not remembered.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import type { CallerIdentity } from "@stigmer/server";
import { PLATFORM_TOKEN_ISSUER } from "@stigmer/server";

import { ISSUER_CACHE_TTL_MS } from "../../federation/verifier.js";
import { newSsoSignInRule, ssoRequiredMessage, SSO_REQUIRED } from "../sign-in-rule.js";
import { storedProvider } from "./in-memory-provider-store.js";

const ACME = "org_acme";
const GLOBEX = "org_globex";

function requiringProvider(id: string, org: string, slug: string, required = true): IdentityProvider {
  const provider = storedProvider({ id, org, slug, isSso: true });
  if (provider.spec !== undefined) {
    provider.spec.ssoRequired = required;
    provider.spec.displayName = "Acme Okta";
  }
  return provider;
}

function account(id: string, providerId = ""): IdentityAccount {
  return create(IdentityAccountSchema, {
    metadata: { id },
    spec: {
      idpId: providerId === "" ? `auth0|${id}` : `stgm_fed|${providerId}|${id}`,
      provisioningMode:
        providerId === "" ? IdentityAccountProvisioningMode.direct : IdentityAccountProvisioningMode.federated,
      ...(providerId === "" ? {} : { identityProviderRef: { id: providerId, org: ACME } }),
    },
  });
}

function role(accountId: string, relation: string, org: string): IamPolicy {
  return create(IamPolicySchema, {
    spec: {
      principal: { kind: "identity_account", id: accountId },
      relation,
      resource: { kind: "organization", id: org },
    },
  });
}

function owner(accountId: string, org: string): IamPolicy {
  return role(accountId, "owner", org);
}

function teamMember(accountId: string, team: string): IamPolicy {
  return create(IamPolicySchema, {
    spec: {
      principal: { kind: "identity_account", id: accountId },
      relation: "member",
      resource: { kind: "team", id: team },
    },
  });
}

function teamRole(team: string, relation: string, org: string): IamPolicy {
  return create(IamPolicySchema, {
    spec: {
      principal: { kind: "team", id: team, relation: "member" },
      relation,
      resource: { kind: "organization", id: org },
    },
  });
}

function person(identityId: string, extra: Partial<CallerIdentity> = {}): CallerIdentity {
  return { identityId, callerClass: "user", issuer: "", rawToken: "", ...extra };
}

/** A platform token naming a PlatformClient: the claim the library reads, unsigned (the read decodes, the verifier verified). */
function platformClientToken(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: PLATFORM_TOKEN_ISSUER,
    sub: "ida_app_user",
    platform_client_id: "pc_acme_app",
  })}.c2ln`;
}

function rule(options: {
  providers: () => ReadonlyArray<IdentityProvider>;
  accounts?: ReadonlyArray<IdentityAccount>;
  policies?: ReadonlyArray<IamPolicy>;
  nowMs?: () => number;
}) {
  const reads = { providers: 0, accounts: 0, pairs: 0, principals: 0 };
  const signInRule = newSsoSignInRule({
    providers: {
      findLive: () => {
        reads.providers += 1;
        return Promise.resolve(options.providers());
      },
    },
    accounts: {
      findById: (id) => {
        reads.accounts += 1;
        return Promise.resolve(options.accounts?.find((held) => held.metadata?.id === id));
      },
    },
    policies: {
      findByPrincipalAndResource: (principalKind, principalId, resourceKind, resourceId) => {
        reads.pairs += 1;
        return Promise.resolve(
          (options.policies ?? []).filter(
            (row) =>
              row.spec?.principal?.kind === principalKind &&
              row.spec.principal.id === principalId &&
              row.spec.resource?.kind === resourceKind &&
              row.spec.resource.id === resourceId,
          ),
        );
      },
      findByPrincipal: (principalKind, principalId) => {
        reads.principals += 1;
        return Promise.resolve(
          (options.policies ?? []).filter(
            (row) => row.spec?.principal?.kind === principalKind && row.spec.principal.id === principalId,
          ),
        );
      },
    },
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
  });
  return { signInRule, reads };
}

const ACME_OKTA = requiringProvider("idp_acme", ACME, "acme-okta");

describe("the organizations that require sign-in", () => {
  it("are the live SSO providers' that set sso_required, and none else", async () => {
    const { signInRule } = rule({
      providers: () => [
        ACME_OKTA,
        requiringProvider("idp_globex", GLOBEX, "globex-sso", false),
        storedProvider({ id: "idp_plain", org: "org_plain", slug: "plain" }),
      ],
    });
    expect(await signInRule.requiringOrgs()).toEqual(new Set([ACME]));
  });

  it("are read once and served from memory until a write invalidates them or the TTL passes", async () => {
    let now = 1_000;
    let providers: ReadonlyArray<IdentityProvider> = [ACME_OKTA];
    const { signInRule, reads } = rule({ providers: () => providers, nowMs: () => now });
    await signInRule.requiringOrgs();
    await signInRule.requiringOrgs();
    expect(reads.providers).toBe(1);

    providers = [];
    signInRule.invalidate();
    expect(await signInRule.requiringOrgs()).toEqual(new Set());
    expect(reads.providers).toBe(2);

    providers = [ACME_OKTA];
    now += ISSUER_CACHE_TTL_MS;
    expect(await signInRule.requiringOrgs()).toEqual(new Set([ACME]));
    expect(reads.providers).toBe(3);
  });

  it("does not remember a read that began before an invalidation", async () => {
    let release: () => void = () => {};
    let providers: ReadonlyArray<IdentityProvider> = [ACME_OKTA];
    let first = true;
    const slow = newSsoSignInRule({
      providers: {
        findLive: () =>
          first
            ? ((first = false),
              new Promise<ReadonlyArray<IdentityProvider>>((resolve) => {
                release = () => resolve([ACME_OKTA]);
              }))
            : Promise.resolve(providers),
      },
      accounts: { findById: () => Promise.resolve(undefined) },
      policies: { findByPrincipalAndResource: () => Promise.resolve([]), findByPrincipal: () => Promise.resolve([]) },
    });
    const stale = slow.requiringOrgs();
    providers = [];
    slow.invalidate();
    expect(await slow.requiringOrgs()).toEqual(new Set());
    release();
    expect(await stale).toEqual(new Set([ACME]));
    expect(await slow.requiringOrgs()).toEqual(new Set());
  });
});

describe("the refusal", () => {
  const accounts = [
    account("ida_raj_email"),
    account("ida_raj_sso", "idp_acme"),
    account("ida_other_sso", "idp_elsewhere"),
    account("ida_ana_email"),
  ];
  /** Acme's own people, each by a role: the refused cases need one to be held at all. */
  const members = [
    role("ida_raj_email", "admin", ACME),
    role("ida_other_sso", "member", ACME),
    role("ida_unknown", "viewer", ACME),
    role("ida_app_user", "member", ACME),
  ];

  it("admits the account the organization's provider made, and a key it made", async () => {
    const { signInRule } = rule({ providers: () => [ACME_OKTA], accounts });
    expect(await signInRule.refusal(person("ida_raj_sso"), ACME)).toBeUndefined();
    expect(
      await signInRule.refusal(person("ida_raj_sso", { rawToken: "stk_key", boundOrg: ACME }), ACME),
    ).toBeUndefined();
  });

  it("refuses one of its people whose account another sign-in or another provider made, naming the organization and the provider", async () => {
    const { signInRule } = rule({ providers: () => [ACME_OKTA], accounts, policies: members });
    const expected = {
      reason: SSO_REQUIRED,
      message: ssoRequiredMessage("Acme Okta"),
      metadata: { org: ACME, provider: "acme-okta" },
    };
    expect(await signInRule.refusal(person("ida_raj_email"), ACME)).toEqual(expected);
    expect(await signInRule.refusal(person("ida_raj_email", { boundOrg: ACME }), ACME)).toEqual(expected);
    expect(await signInRule.refusal(person("ida_other_sso"), ACME)).toEqual(expected);
    expect(await signInRule.refusal(person("ida_unknown"), ACME)).toEqual(expected);
    expect(ssoRequiredMessage("Acme Okta")).toBe("This organization requires you to sign in through Acme Okta.");
  });

  it("exempts the organization's owners, read as one policy pair", async () => {
    const { signInRule, reads } = rule({
      providers: () => [ACME_OKTA],
      accounts,
      policies: [owner("ida_ana_email", ACME), owner("ida_raj_email", GLOBEX), ...members],
    });
    expect(await signInRule.refusal(person("ida_ana_email"), ACME)).toBeUndefined();
    expect(reads.pairs).toBe(1);
    expect(reads.principals).toBe(0);
    expect(await signInRule.refusal(person("ida_raj_email"), ACME)).toMatchObject({ reason: SSO_REQUIRED });
  });

  it("exempts a user token the organization's own platform client minted, and no other", async () => {
    const { signInRule } = rule({ providers: () => [ACME_OKTA], accounts, policies: members });
    const token = platformClientToken();
    expect(
      await signInRule.refusal(person("ida_app_user", { rawToken: token, boundOrg: ACME }), ACME),
    ).toBeUndefined();
    expect(
      await signInRule.refusal(person("ida_app_user", { rawToken: token, boundOrg: GLOBEX }), ACME),
    ).toMatchObject({ reason: SSO_REQUIRED });
  });

  it("answers nothing in an organization that requires nothing", async () => {
    const { signInRule, reads } = rule({ providers: () => [ACME_OKTA], accounts });
    expect(await signInRule.refusal(person("ida_raj_email"), GLOBEX)).toBeUndefined();
    expect(reads.accounts).toBe(0);
  });

  it("does not remember a failed account read: the next check reads again", async () => {
    let failures = 1;
    const signInRule = newSsoSignInRule({
      providers: { findLive: () => Promise.resolve([ACME_OKTA]) },
      accounts: {
        findById: (id) =>
          failures-- > 0
            ? Promise.reject(new Error("account store unavailable"))
            : Promise.resolve(accounts.find((held) => held.metadata?.id === id)),
      },
      policies: { findByPrincipalAndResource: () => Promise.resolve([]), findByPrincipal: () => Promise.resolve([]) },
    });
    const caller = person("ida_raj_sso");
    await expect(signInRule.refusal(caller, ACME)).rejects.toThrow("account store unavailable");
    expect(await signInRule.refusal(caller, ACME)).toBeUndefined();
  });

  it("reads the caller's account, and where it stands in the organization, once per caller object", async () => {
    const { signInRule, reads } = rule({ providers: () => [ACME_OKTA], accounts, policies: members });
    const caller = person("ida_raj_email");
    await signInRule.refusal(caller, ACME);
    await signInRule.refusal(caller, ACME);
    expect(reads.accounts).toBe(1);
    expect(reads.pairs).toBe(1);
  });

  it("holds a person who belongs through a team, and a credential bound to the organization", async () => {
    const { signInRule } = rule({
      providers: () => [ACME_OKTA],
      accounts: [account("ida_tess_email"), account("ida_bo_email")],
      policies: [teamMember("ida_tess_email", "tm_sre"), teamRole("tm_sre", "member", ACME)],
    });
    expect(await signInRule.refusal(person("ida_tess_email"), ACME)).toMatchObject({ reason: SSO_REQUIRED });
    expect(await signInRule.refusal(person("ida_bo_email", { boundOrg: ACME }), ACME)).toMatchObject({
      reason: SSO_REQUIRED,
    });
  });

  it("does not hold someone who is not one of its people: no role, no team holding one, no credential bound there", async () => {
    const { signInRule, reads } = rule({
      providers: () => [ACME_OKTA],
      accounts: [account("ida_kim_child")],
      policies: [
        role("ida_kim_child", "member", "org_acme_eu"),
        teamMember("ida_kim_child", "tm_elsewhere"),
        teamRole("tm_elsewhere", "member", GLOBEX),
        // A team row that is not a membership, and a team role on Acme that
        // names the team itself rather than its members.
        create(IamPolicySchema, {
          spec: {
            principal: { kind: "identity_account", id: "ida_kim_child" },
            relation: "viewer",
            resource: { kind: "team", id: "tm_acme_ops" },
          },
        }),
        create(IamPolicySchema, {
          spec: {
            principal: { kind: "team", id: "tm_elsewhere" },
            relation: "viewer",
            resource: { kind: "organization", id: ACME },
          },
        }),
      ],
    });
    expect(await signInRule.refusal(person("ida_kim_child"), ACME)).toBeUndefined();
    expect(await signInRule.refusal(person("ida_kim_child", { boundOrg: "org_acme_eu" }), ACME)).toBeUndefined();
    expect(reads.principals).toBe(2);
  });

  it("does not remember a failed read of where a person stands: the next check reads again", async () => {
    let failures = 1;
    const signInRule = newSsoSignInRule({
      providers: { findLive: () => Promise.resolve([ACME_OKTA]) },
      accounts: { findById: () => Promise.resolve(undefined) },
      policies: {
        findByPrincipalAndResource: () =>
          failures-- > 0 ? Promise.reject(new Error("policy store unavailable")) : Promise.resolve(members),
        findByPrincipal: () => Promise.resolve([]),
      },
    });
    const caller = person("ida_raj_email");
    await expect(signInRule.refusal(caller, ACME)).rejects.toThrow("policy store unavailable");
    expect(await signInRule.refusal(caller, ACME)).toMatchObject({ reason: SSO_REQUIRED });
  });
});
