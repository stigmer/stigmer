/**
 * Pins `ensureMyIdentityAccount` (`ensure-identity-account.ts`; 20260911.11
 * A3): the ONE first-sign-in flow every surface runs — the console's
 * `useIdentityAccountGate` delegates to it, the CLI's `auth whoami` and
 * `auth login` call it — so a platform builder embedding Stigmer gets the
 * same flow as a first-class import.
 *
 *   1. whoAmI answers → the account, `created: false`; nothing else is
 *      called;
 *   2. whoAmI is NOT_FOUND → `onProvisioning` fires once (the hook's
 *      "provisioning" state), provisionMyAccount runs, the created account
 *      comes back with `created: true`;
 *   3. any other whoAmI error propagates untouched (UNAUTHENTICATED,
 *      UNAVAILABLE, a network fault) — the caller's error UX owns it;
 *   4. a provisionMyAccount failure propagates untouched (UNAVAILABLE when
 *      the issuer's userinfo is down is the documented arm).
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ensureMyIdentityAccount } from "../ensure-identity-account";
import type { Stigmer } from "../stigmer";

interface Calls {
  whoAmI: number;
  provisionMyAccount: number;
}

function clientWith(behaviour: {
  whoAmI: () => Promise<unknown>;
  provisionMyAccount?: () => Promise<unknown>;
}): { client: Stigmer; calls: Calls } {
  const calls: Calls = { whoAmI: 0, provisionMyAccount: 0 };
  const client = {
    identityAccount: {
      whoAmI: () => {
        calls.whoAmI += 1;
        return behaviour.whoAmI();
      },
      provisionMyAccount: () => {
        calls.provisionMyAccount += 1;
        return (
          behaviour.provisionMyAccount ??
          (() => Promise.reject(new Error("must not be called")))
        )();
      },
    },
  } as unknown as Stigmer;
  return { client, calls };
}

const EXISTING = {
  metadata: { id: "ida_existing" },
  spec: { idpId: "auth0|existing" },
};
const CREATED = {
  metadata: { id: "ida_created" },
  spec: { idpId: "auth0|created" },
};

describe("ensureMyIdentityAccount", () => {
  it("answers the existing account without provisioning", async () => {
    const { client, calls } = clientWith({
      whoAmI: () => Promise.resolve(EXISTING),
    });
    const result = await ensureMyIdentityAccount(client);
    expect(result).toEqual({ account: EXISTING, created: false });
    expect(calls).toEqual({ whoAmI: 1, provisionMyAccount: 0 });
  });

  it("provisions on NOT_FOUND, telling the caller once that it is provisioning", async () => {
    const { client, calls } = clientWith({
      whoAmI: () =>
        Promise.reject(
          new ConnectError(
            "Identity account not found for the authenticated user",
            Code.NotFound,
          ),
        ),
      provisionMyAccount: () => Promise.resolve(CREATED),
    });
    let provisioning = 0;
    const result = await ensureMyIdentityAccount(client, {
      onProvisioning: () => (provisioning += 1),
    });
    expect(result).toEqual({ account: CREATED, created: true });
    expect(provisioning).toBe(1);
    expect(calls).toEqual({ whoAmI: 1, provisionMyAccount: 1 });
  });

  it("does not fire onProvisioning when the account already exists", async () => {
    const { client } = clientWith({ whoAmI: () => Promise.resolve(EXISTING) });
    let provisioning = 0;
    await ensureMyIdentityAccount(client, {
      onProvisioning: () => (provisioning += 1),
    });
    expect(provisioning).toBe(0);
  });

  it("propagates any other whoAmI error untouched — only NOT_FOUND means 'provision me'", async () => {
    const unauthenticated = new ConnectError(
      "authentication token missing",
      Code.Unauthenticated,
    );
    const { client, calls } = clientWith({
      whoAmI: () => Promise.reject(unauthenticated),
    });
    await expect(ensureMyIdentityAccount(client)).rejects.toBe(unauthenticated);
    expect(calls.provisionMyAccount).toBe(0);

    const network = new TypeError("Load failed");
    const offline = clientWith({ whoAmI: () => Promise.reject(network) });
    await expect(ensureMyIdentityAccount(offline.client)).rejects.toBe(network);
  });

  it("propagates a provisioning failure untouched (the issuer's userinfo down is UNAVAILABLE)", async () => {
    const unavailable = new ConnectError(
      "Failed to fetch user profile from identity provider: userinfo answered 503",
      Code.Unavailable,
    );
    const { client } = clientWith({
      whoAmI: () =>
        Promise.reject(new ConnectError("not found", Code.NotFound)),
      provisionMyAccount: () => Promise.reject(unavailable),
    });
    await expect(ensureMyIdentityAccount(client)).rejects.toBe(unavailable);
  });
});
