// Pins how the cloud environment makes a console person: a token the
// environment's direct-login tenant mints for a fresh subject, living a
// whole run, then the first sign-in (provisionMyAccount) through the clients
// that present it. The tenant and the clients are stubbed.
import { describe, expect, it } from "vitest";

import type { DirectLoginTenant } from "../../targets/target";
import type { ConformanceClients } from "../clients";
import { provisionConsolePerson } from "../cloud-env";
import { PERSON_TOKEN_TTL_SECONDS } from "../people";

describe("provisionConsolePerson", () => {
  it("mints a whole-run token for a fresh subject and provisions the account it names", async () => {
    const minted: Array<{ subject: string; ttlSeconds?: number }> = [];
    const tenant = {
      mint: (input: { subject: string; ttlSeconds?: number }) => (minted.push(input), "console-token"),
    } as unknown as DirectLoginTenant;
    const presented: string[] = [];
    const person = await provisionConsolePerson(tenant, (token) => {
      presented.push(token);
      return {
        identityAccountCommand: { provisionMyAccount: async () => ({ metadata: { id: "ida_01person" } }) },
      } as unknown as Pick<ConformanceClients, "identityAccountCommand">;
    });

    expect(person).toEqual({ token: "console-token", accountId: "ida_01person" });
    expect(presented).toEqual(["console-token"]);
    expect(minted).toEqual([{ subject: expect.stringMatching(/^auth0\|conformance-/), ttlSeconds: PERSON_TOKEN_TTL_SECONDS }]);
  });
});
