// Unit tests for `stigmer auth whoami`'s result (commands/auth/whoami.ts;
// 20260911.11 A3): the command runs the SDK's ensureMyIdentityAccount — the
// same first-sign-in flow the console runs — and RENDERS what it learned.
// whoamiResult is the pure half: given the account and whether this call
// created it, the CommandResult a person reads. A first sign-in says so
// (visibility of system status); a missing organization is a hint, not a
// failure; an empty profile (the unconfigured laptop's operator) renders
// only the fields it has. Accounts are built with the generated schema
// (DD-007: the generated type is the contract; refinement 12, slice 4).

import { create } from "@bufbuild/protobuf";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { describe, expect, it } from "vitest";

import { whoamiResult } from "./whoami.js";

const ALICE = {
  metadata: { id: "ida_wtr3jcf281yfk9xx61kj59fsme", name: "alice@example.com" },
  spec: {
    idpId: "auth0|alice",
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Liddell",
    isMachineAccount: false,
  },
};
const ACCOUNT = create(IdentityAccountSchema, ALICE);

function fields(
  result: ReturnType<typeof whoamiResult>,
): Record<string, string> {
  return Object.fromEntries(
    result.sections.flatMap((s) => s.fields.map((f) => [f.key, f.value])),
  );
}

describe("whoamiResult", () => {
  it("renders an existing account as 'Authenticated' with its identity fields", () => {
    const result = whoamiResult(ACCOUNT, { created: false, org: "acme" });
    expect(result.status).toBe("success");
    expect(result.message).toBe("Authenticated");
    expect(fields(result)).toEqual({
      "Account ID": "ida_wtr3jcf281yfk9xx61kj59fsme",
      Name: "alice@example.com",
      Email: "alice@example.com",
      "Full Name": "Alice Liddell",
      "Account Type": "User Account",
      Organization: "acme",
    });
    expect(result.hints).toEqual([]);
  });

  it("says so when this call created the account — the first sign-in is visible, never silent", () => {
    const result = whoamiResult(ACCOUNT, { created: true, org: "acme" });
    expect(result.status).toBe("success");
    expect(result.message).toBe(
      "Authenticated — your account was created on this first sign-in",
    );
    expect(fields(result)["Account ID"]).toBe("ida_wtr3jcf281yfk9xx61kj59fsme");
  });

  it("a missing organization is a hint with the command that sets it", () => {
    const result = whoamiResult(ACCOUNT, { created: false, org: "" });
    expect(fields(result).Organization).toBeUndefined();
    expect(result.hints).toEqual([
      "No organization set. Use: stigmer config context set --org <slug>",
    ]);
  });

  it("renders only the fields an empty profile has (the unconfigured laptop's operator)", () => {
    const result = whoamiResult(
      create(IdentityAccountSchema, {
        metadata: { id: "ida_fn0zdvkkkhhrb4wry43zba8gnn", name: "system" },
        spec: { idpId: "local|system" },
      }),
      { created: false, org: "local" },
    );
    expect(fields(result)).toEqual({
      "Account ID": "ida_fn0zdvkkkhhrb4wry43zba8gnn",
      Name: "system",
      "Account Type": "User Account",
      Organization: "local",
    });
  });

  it("names a machine account", () => {
    const result = whoamiResult(
      create(IdentityAccountSchema, {
        ...ALICE,
        spec: { ...ALICE.spec, isMachineAccount: true },
      }),
      { created: false, org: "acme" },
    );
    expect(fields(result)["Account Type"]).toBe("Machine Account");
  });
});
