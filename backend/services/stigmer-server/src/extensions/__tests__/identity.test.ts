/**
 * Pins `isPlatformPipelineCaller` (extensions/identity.ts; 20260913.01
 * slice 5, Q-S5-10): the ONE definition of "the platform's own pipelines"
 * — a `machine` or `internal` caller, or any identity that entered
 * through the in-process transport — read by the identity-account
 * `create` RPC's admission rule (2a A7) and the three IamPolicy system
 * RPCs' (Q-OR-7). A wire `user`, `runner` or a composition's own class
 * (guest) is never one.
 *
 * Also pins `isServerComposedRequest`, the narrower predicate the label
 * guard, the memory-capture gate, the execution-context create check and
 * the default-instance arm of the instance creates share: `internal` or an
 * in-process origin, and never a wire `machine` account — the one row
 * where the two predicates part, pinned so a step trusting server-composed
 * state can never be widened to the wire by picking the wrong one.
 */
import { describe, expect, it } from "vitest";

import {
  isPlatformPipelineCaller,
  isServerComposedRequest,
} from "../identity.js";
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

describe("isServerComposedRequest", () => {
  it("is true for the internal class and for any identity that entered in-process", () => {
    expect(isServerComposedRequest(caller({ callerClass: "internal" }))).toBe(
      true,
    );
    expect(
      isServerComposedRequest(
        caller({ callerClass: "user", origin: "in-process" }),
      ),
    ).toBe(true);
    expect(
      isServerComposedRequest(
        caller({ callerClass: "channel", origin: "in-process" }),
      ),
    ).toBe(true);
  });

  it("is false for every wire caller, the machine class included — the row where it parts from isPlatformPipelineCaller", () => {
    const wireMachine = caller({ callerClass: "machine" });
    expect(isServerComposedRequest(wireMachine)).toBe(false);
    expect(isPlatformPipelineCaller(wireMachine)).toBe(true);
    expect(isServerComposedRequest(caller({ callerClass: "user" }))).toBe(
      false,
    );
    expect(
      isServerComposedRequest(caller({ callerClass: "user", origin: "wire" })),
    ).toBe(false);
    expect(isServerComposedRequest(caller({ callerClass: "runner" }))).toBe(
      false,
    );
  });
});
