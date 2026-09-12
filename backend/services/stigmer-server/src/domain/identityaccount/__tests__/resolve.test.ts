/**
 * Pins the one statement of "what identityId does this subject get
 * stamped with" (resolve.ts; 20260911.11 Q-IA-2, A1, A6), the rule both
 * verifiers call after their credential checks pass:
 *
 *   - a subject with a DIRECT account resolves to that account's id (the
 *     cloud's direct-login posture, iam/direct/verifier.ts);
 *   - a subject without one is returned unchanged, so the caller is
 *     admitted idp-shaped and whoAmI / provisionMyAccount can run;
 *   - one `findDirectByIdpId` read per call, no cache — a row that
 *     appears between two calls is seen by the second (the liveness
 *     posture the API-key lane already has);
 *   - a store fault propagates as the SAME error object, never a
 *     credential rejection (the chassis maps a non-ConnectError to
 *     INTERNAL);
 *   - a hit whose row carries no id is an infrastructure fault naming the
 *     subject, never a `""` principal — the one deliberate divergence
 *     from the cloud's inline `?? ""`.
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { accountIdFor } from "../constants.js";
import { identityIdForSubject } from "../resolve.js";
import type { AccountsBySubject } from "../resolve.js";
import { fakeIdentityAccountStore } from "./support.js";

function seeded(sub: string, id: string = accountIdFor(sub)) {
  const accounts = fakeIdentityAccountStore();
  accounts.rows.set(
    id,
    create(IdentityAccountSchema, {
      metadata: { id, name: sub },
      spec: {
        idpId: sub,
        provisioningMode: IdentityAccountProvisioningMode.direct,
      },
    }),
  );
  return accounts;
}

describe("identityIdForSubject", () => {
  it("a subject with an account resolves to the account's id", async () => {
    const accounts = seeded("auth0|known");
    expect(await identityIdForSubject(accounts, "auth0|known")).toBe(
      accountIdFor("auth0|known"),
    );
  });

  it("a subject without an account is returned unchanged — the caller stays idp-shaped", async () => {
    const accounts = seeded("auth0|someone-else");
    expect(await identityIdForSubject(accounts, "auth0|unknown")).toBe(
      "auth0|unknown",
    );
  });

  it("is one read per call with no cache — a row that appears between two calls is seen by the second", async () => {
    const accounts = fakeIdentityAccountStore();
    const lookup = vi.spyOn(accounts, "findDirectByIdpId");

    expect(await identityIdForSubject(accounts, "auth0|late")).toBe(
      "auth0|late",
    );
    accounts.rows.set(
      accountIdFor("auth0|late"),
      create(IdentityAccountSchema, {
        metadata: { id: accountIdFor("auth0|late"), name: "late" },
        spec: {
          idpId: "auth0|late",
          provisioningMode: IdentityAccountProvisioningMode.direct,
        },
      }),
    );
    expect(await identityIdForSubject(accounts, "auth0|late")).toBe(
      accountIdFor("auth0|late"),
    );
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenNthCalledWith(1, "auth0|late");
    expect(lookup).toHaveBeenNthCalledWith(2, "auth0|late");
  });

  it("a store fault propagates as the same error — never a credential rejection", async () => {
    const fault = new Error("store is on fire");
    const broken: AccountsBySubject = {
      findDirectByIdpId: () => Promise.reject(fault),
    };
    const error = await identityIdForSubject(broken, "auth0|anyone").then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );
    expect(error).toBe(fault);
    expect(error).not.toBeInstanceOf(ConnectError);
  });

  it("a hit whose row carries no id is an infrastructure fault naming the subject — never a '' principal", async () => {
    const accounts = seeded("auth0|corrupt", "");
    const error = await identityIdForSubject(accounts, "auth0|corrupt").then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ConnectError);
    expect(String(error)).toContain("auth0|corrupt");
  });
});
