/**
 * Pins `accountForStamp` (resolve.ts): the account a row's CREATOR STAMP
 * names, read the two ways a stamp has been written — as an account id
 * (rows stamped since 3.15.0) and as the raw issuer subject (rows the
 * 3.14.x verifiers stamped) — stated ONCE so the schedule fire caller and
 * the runner-subject verifier, which both make a server lane act as the
 * person a row names, cannot resolve the same stamp two ways. The read
 * order is `accountForCaller`'s: by id first, then the direct subject
 * lookup.
 *
 *   - an account-id stamp resolves by that id;
 *   - a raw-subject stamp resolves through the direct lookup;
 *   - the empty stamp is `undefined` with NO read — the store is never
 *     asked about "";
 *   - a stamp naming nobody (the laptop's `"system"`, a trusted-local
 *     email, a deleted account) is `undefined` — the CALLER decides what
 *     that means (the fire caller's deterministic refusal; the verifier's
 *     liveness sentence); this function never throws for it;
 *   - a store fault propagates as the same error object.
 *
 * Written failing on 2026-09-16, before the export exists; the change that follows
 * extracts it from the fire caller's inline read (extract, do not copy).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { accountIdFor } from "../constants.js";
import { accountForStamp } from "../resolve.js";
import type { AccountsByCaller } from "../resolve.js";
import { fakeIdentityAccountStore } from "./support.js";

const SUBJECT = "auth0|carol";
const CAROL = accountIdFor(SUBJECT);

function seeded() {
  const accounts = fakeIdentityAccountStore();
  accounts.rows.set(
    CAROL,
    create(IdentityAccountSchema, {
      metadata: { id: CAROL, name: "Carol Danvers" },
      spec: {
        idpId: SUBJECT,
        email: "carol@example.com",
        provisioningMode: IdentityAccountProvisioningMode.direct,
      },
    }),
  );
  return accounts;
}

describe("accountForStamp", () => {
  it("an account-id stamp resolves by that id", async () => {
    const account = await accountForStamp(seeded(), CAROL);
    expect(account?.metadata?.id).toBe(CAROL);
    expect(account?.spec?.email).toBe("carol@example.com");
  });

  it("a raw-subject stamp (the 3.14.x shape) resolves through the direct lookup to the same account", async () => {
    expect((await accountForStamp(seeded(), SUBJECT))?.metadata?.id).toBe(
      CAROL,
    );
  });

  it('the empty stamp is undefined with NO read — the store is never asked about ""', async () => {
    const findById = vi.fn(async () => undefined);
    const findDirectByIdpId = vi.fn(async () => undefined);
    const accounts: AccountsByCaller = { findById, findDirectByIdpId };
    expect(await accountForStamp(accounts, "")).toBeUndefined();
    expect(findById).not.toHaveBeenCalled();
    expect(findDirectByIdpId).not.toHaveBeenCalled();
  });

  it.each([
    ["the laptop's placeholder", "system"],
    ["a trusted-local email stamp", "operator@example.com"],
    ["a deleted account", accountIdFor("auth0|gone")],
  ])(
    "%s is undefined — the caller decides what nobody means",
    async (_label, stamp) => {
      expect(await accountForStamp(seeded(), stamp)).toBeUndefined();
    },
  );

  it("reads by id first, then by subject — two primary-key reads at most, in accountForCaller's order", async () => {
    const calls: string[] = [];
    const accounts: AccountsByCaller = {
      findById: async (id) => {
        calls.push(`id:${id}`);
        return undefined;
      },
      findDirectByIdpId: async (idpId) => {
        calls.push(`sub:${idpId}`);
        return undefined;
      },
    };
    await accountForStamp(accounts, SUBJECT);
    expect(calls).toEqual([`id:${SUBJECT}`, `sub:${SUBJECT}`]);
  });

  it("a store fault propagates as the same error object, never a credential rejection", async () => {
    const fault = new Error("connection reset");
    const accounts: AccountsByCaller = {
      findById: () => Promise.reject(fault),
      findDirectByIdpId: async () => undefined,
    };
    await expect(accountForStamp(accounts, CAROL)).rejects.toBe(fault);
  });
});
