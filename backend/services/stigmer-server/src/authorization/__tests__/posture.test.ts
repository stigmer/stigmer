/**
 * Pins the three authorization postures over the four input
 * combinations: a unit's Authorizer wins whatever the authentication
 * posture; without one, the require-authentication posture selects the
 * built-in drivers and its absence keeps the trusted-local default.
 */
import { describe, expect, it } from "vitest";

import { authorizationPostureOf } from "../posture.js";

describe("authorizationPostureOf", () => {
  it.each([
    [false, false, "trusted-local"],
    [false, true, "built-in"],
    [true, false, "unit-authorizer"],
    [true, true, "unit-authorizer"],
  ] as const)(
    "unitAuthorizer=%s requireAuthentication=%s → %s",
    (unitAuthorizer, requireAuthentication, want) => {
      expect(
        authorizationPostureOf({ unitAuthorizer, requireAuthentication }),
      ).toBe(want);
    },
  );
});
