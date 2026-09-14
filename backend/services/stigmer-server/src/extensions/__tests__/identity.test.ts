/**
 * Pins `isPlatformPipelineCaller` (extensions/identity.ts; 20260913.01
 * slice 5, Q-S5-10): the ONE definition of "the platform's own pipelines"
 * — a `machine` or `internal` caller, or any identity that entered
 * through the in-process transport — read by the identity-account
 * `create` RPC's admission rule (2a A7) and the three IamPolicy system
 * RPCs' (Q-OR-7). A wire `user`, `runner` or a composition's own class
 * (guest) is never one.
 */
import { describe, expect, it } from "vitest";

import { isPlatformPipelineCaller } from "../identity.js";
import type { CallerIdentity } from "../identity.js";

function caller(fields: Partial<CallerIdentity>): CallerIdentity {
  return {
    identityId: "ida_x",
    callerClass: "user",
    issuer: "",
    rawToken: "",
    ...fields,
  };
}

describe("isPlatformPipelineCaller", () => {
  it("admits machine and internal callers whatever their origin", () => {
    expect(isPlatformPipelineCaller(caller({ callerClass: "machine" }))).toBe(
      true,
    );
    expect(isPlatformPipelineCaller(caller({ callerClass: "internal" }))).toBe(
      true,
    );
    expect(
      isPlatformPipelineCaller(
        caller({ callerClass: "machine", origin: "wire" }),
      ),
    ).toBe(true);
  });

  it("admits any identity that entered through the in-process transport — a propagated user included", () => {
    expect(
      isPlatformPipelineCaller(
        caller({ callerClass: "user", origin: "in-process" }),
      ),
    ).toBe(true);
  });

  it("refuses wire users, runners and a composition's own classes", () => {
    expect(isPlatformPipelineCaller(caller({ callerClass: "user" }))).toBe(
      false,
    );
    expect(
      isPlatformPipelineCaller(caller({ callerClass: "user", origin: "wire" })),
    ).toBe(false);
    expect(isPlatformPipelineCaller(caller({ callerClass: "runner" }))).toBe(
      false,
    );
    expect(isPlatformPipelineCaller(caller({ callerClass: "guest" }))).toBe(
      false,
    );
  });
});
