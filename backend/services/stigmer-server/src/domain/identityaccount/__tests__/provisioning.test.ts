/**
 * Pins direct-account self-provisioning (provisioning.ts), the cloud's
 * `provisionDirectAccount` flow (its iam/account/provisioning.ts header,
 * steps 1 to 3) as OSS core, over a fake IdentityAccountStore and an
 * injected UserInfoClient — no network, no store driver:
 *
 *   1. idempotent early return when the subject already has an account
 *      (no create, no userinfo call);
 *   2. the profile comes from the issuer's userinfo endpoint with the
 *      caller's own access token, for every token-bearing caller — the
 *      cloud's posture, one path, given_name/family_name as the IdP states
 *      them (a claims shortcut that split `name` into two would be
 *      guesswork; recorded in T01_3_execution.md). A caller with no issuer
 *      never dials out: its profile is what the CallerIdentity carries;
 *   3. create through the ONE create path the domain owns (the same path
 *      the create RPC's chain runs, so the tuple lifecycle and the
 *      provisioning slot fire for both); a first-login race resolves the
 *      winner by subject whatever the failure's shape.
 *
 * Step 4 of the cloud's flow (the personal organization) is not core: it
 * fires on `identity-account-provision:post-persist` in the composition.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { accountIdFor } from "../constants.js";
import {
  UserInfoFetchError,
  newDirectAccountProvisioner,
} from "../provisioning.js";
import type {
  CreateAccountInput,
  UserInfoClient,
  UserProfile,
} from "../provisioning.js";
import type { IdentityAccountStore } from "../store.js";
import { fakeIdentityAccountStore as fakeAccounts } from "./support.js";

/** The one create path, as the test sees it: derive, save, return. */
function fakeCreatePath(accounts: IdentityAccountStore) {
  const calls: CreateAccountInput[] = [];
  return {
    calls,
    async createAccount(
      input: CreateAccountInput,
      _caller: CallerIdentity,
    ): Promise<IdentityAccount> {
      calls.push(input);
      const account = create(IdentityAccountSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "IdentityAccount",
        metadata: { id: accountIdFor(input.spec.idpId), name: input.name },
        spec: input.spec,
      });
      await accounts.save(account);
      return account;
    },
  };
}

function fakeUserInfo(
  profile: UserProfile | Error,
): UserInfoClient & { tokens: string[] } {
  const tokens: string[] = [];
  return {
    tokens,
    async fetchUserProfile(accessToken) {
      tokens.push(accessToken);
      if (profile instanceof Error) throw profile;
      return profile;
    },
  };
}

const PROFILE: UserProfile = {
  email: "alice@example.com",
  firstName: "Alice",
  lastName: "Liddell",
  pictureUrl: "https://img.example/alice.png",
};

function oidcCaller(sub: string): CallerIdentity {
  return {
    identityId: sub,
    callerClass: "user",
    issuer: "https://issuer.test",
    rawToken: `token-for-${sub}`,
  };
}

const operatorCaller: CallerIdentity = {
  identityId: "operator@example.com",
  callerClass: "user",
  issuer: "",
  rawToken: "",
  email: "operator@example.com",
  displayName: "The Operator",
};

describe("provisionDirectAccount", () => {
  it("returns the existing account for a held subject without creating or dialling out", async () => {
    const accounts = fakeAccounts();
    const path = fakeCreatePath(accounts);
    const userInfo = fakeUserInfo(PROFILE);
    const provisioner = newDirectAccountProvisioner({
      accounts,
      createAccount: path.createAccount,
      userInfo,
    });
    const first = await provisioner.provisionDirectAccount(
      "auth0|alice",
      oidcCaller("auth0|alice"),
    );
    const second = await provisioner.provisionDirectAccount(
      "auth0|alice",
      oidcCaller("auth0|alice"),
    );

    expect(second).toEqual(first);
    expect(path.calls).toHaveLength(1);
    expect(userInfo.tokens).toEqual(["token-for-auth0|alice"]);
  });

  it("a token-bearing caller's profile comes from userinfo with the caller's own token", async () => {
    const accounts = fakeAccounts();
    const path = fakeCreatePath(accounts);
    const userInfo = fakeUserInfo(PROFILE);
    const provisioner = newDirectAccountProvisioner({
      accounts,
      createAccount: path.createAccount,
      userInfo,
    });
    const account = await provisioner.provisionDirectAccount(
      "auth0|alice",
      oidcCaller("auth0|alice"),
    );

    expect(userInfo.tokens).toEqual(["token-for-auth0|alice"]);
    expect(account.metadata?.id).toBe(accountIdFor("auth0|alice"));
    expect(account.metadata?.name).toBe("alice@example.com");
    expect(account.spec).toMatchObject({
      idpId: "auth0|alice",
      email: "alice@example.com",
      firstName: "Alice",
      lastName: "Liddell",
      pictureUrl: "https://img.example/alice.png",
      provisioningMode: IdentityAccountProvisioningMode.direct,
      isMachineAccount: false,
    });
  });

  it("a userinfo failure is UserInfoFetchError (the handler's UNAVAILABLE arm) and nothing is created", async () => {
    const accounts = fakeAccounts();
    const path = fakeCreatePath(accounts);
    const provisioner = newDirectAccountProvisioner({
      accounts,
      createAccount: path.createAccount,
      userInfo: fakeUserInfo(new Error("userinfo answered 503")),
    });

    await expect(
      provisioner.provisionDirectAccount("auth0|bob", oidcCaller("auth0|bob")),
    ).rejects.toBeInstanceOf(UserInfoFetchError);
    expect(path.calls).toHaveLength(0);
    expect(accounts.rows.size).toBe(0);
  });

  it("a caller with no issuer never dials out — its profile is what the identity carries", async () => {
    const accounts = fakeAccounts();
    const path = fakeCreatePath(accounts);
    const userInfo = fakeUserInfo(new Error("must not be called"));
    const provisioner = newDirectAccountProvisioner({
      accounts,
      createAccount: path.createAccount,
      userInfo,
    });
    const account = await provisioner.provisionDirectAccount(
      "local|operator@example.com",
      operatorCaller,
    );

    expect(userInfo.tokens).toEqual([]);
    expect(account.metadata?.name).toBe("The Operator");
    expect(account.spec?.email).toBe("operator@example.com");
    expect(account.spec?.idpId).toBe("local|operator@example.com");
  });

  it("a machine subject (…@clients) is flagged is_machine_account by the backend", async () => {
    const accounts = fakeAccounts();
    const path = fakeCreatePath(accounts);
    const provisioner = newDirectAccountProvisioner({
      accounts,
      createAccount: path.createAccount,
      userInfo: fakeUserInfo({ ...PROFILE, email: "" }),
    });
    const account = await provisioner.provisionDirectAccount(
      "abc123@clients",
      oidcCaller("abc123@clients"),
    );
    expect(account.spec?.isMachineAccount).toBe(true);
  });

  it("the first-login race resolves to the winner by subject whatever the failure's shape", async () => {
    const accounts = fakeAccounts();
    const path = fakeCreatePath(accounts);
    // The create path loses the race to a row that appears underneath it.
    const winner = create(IdentityAccountSchema, {
      metadata: { id: accountIdFor("auth0|carol"), name: "carol@example.com" },
      spec: { idpId: "auth0|carol", email: "carol@example.com" },
    });
    const provisioner = newDirectAccountProvisioner({
      accounts,
      async createAccount(input, caller) {
        await accounts.save(winner);
        return path.createAccount(input, caller);
      },
      userInfo: fakeUserInfo(PROFILE),
    });

    const resolved = await provisioner.provisionDirectAccount(
      "auth0|carol",
      oidcCaller("auth0|carol"),
    );
    expect(resolved).toEqual(winner);
    expect(accounts.rows.size).toBe(1);
  });

  it("a create failure with no winner behind it propagates as the infrastructure fault it is", async () => {
    const accounts = fakeAccounts();
    const provisioner = newDirectAccountProvisioner({
      accounts,
      async createAccount() {
        throw new Error("store is on fire");
      },
      userInfo: fakeUserInfo(PROFILE),
    });
    await expect(
      provisioner.provisionDirectAccount(
        "auth0|dave",
        oidcCaller("auth0|dave"),
      ),
    ).rejects.toThrow("store is on fire");
  });

  it("two concurrent first logins for one subject end in one row and one answer", async () => {
    const accounts = fakeAccounts();
    const path = fakeCreatePath(accounts);
    const provisioner = newDirectAccountProvisioner({
      accounts,
      createAccount: path.createAccount,
      userInfo: fakeUserInfo(PROFILE),
    });

    const [a, b] = await Promise.all([
      provisioner.provisionDirectAccount(
        "auth0|erin",
        oidcCaller("auth0|erin"),
      ),
      provisioner.provisionDirectAccount(
        "auth0|erin",
        oidcCaller("auth0|erin"),
      ),
    ]);

    expect(a.metadata?.id).toBe(accountIdFor("auth0|erin"));
    expect(b.metadata?.id).toBe(a.metadata?.id);
    expect(accounts.rows.size).toBe(1);
  });
});
