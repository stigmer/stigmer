// ---------------------------------------------------------------------------
// signup-params — the deployment's sign-up fragment, parsed once
//
// Pins what the fragment may carry: any parameter a provider reads to open
// its create-account screen, and none the sign-in flow sets itself, since
// oidc-client-ts spreads extras after its own parameters and a collision
// would silently rewrite the flow.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  parseSignupParams,
  RESERVED_SIGNUP_PARAMS,
  ReservedSignupParamError,
} from "../signup-params";

describe("parseSignupParams", () => {
  it("reads an empty or blank fragment as no parameters", () => {
    expect(parseSignupParams("")).toEqual({});
    expect(parseSignupParams("   ")).toEqual({});
  });

  it("reads a fragment into a frozen map, decoding values", () => {
    const params = parseSignupParams("hint=signup&ui_locales=en%20fr");
    expect(params).toEqual({ hint: "signup", ui_locales: "en fr" });
    expect(Object.isFrozen(params)).toBe(true);
  });

  it("allows a leading question mark", () => {
    expect(parseSignupParams("?hint=signup")).toEqual({ hint: "signup" });
  });

  it.each(RESERVED_SIGNUP_PARAMS)("refuses %s, a parameter the flow owns", (key) => {
    expect(() => parseSignupParams(`hint=signup&${key}=x`)).toThrow(ReservedSignupParamError);
    try {
      parseSignupParams(`${key}=x`);
    } catch (err) {
      expect(err).toBeInstanceOf(ReservedSignupParamError);
      expect((err as ReservedSignupParamError).key).toBe(key);
    }
  });

  it("covers every parameter of the code flow and the audience", () => {
    expect([...RESERVED_SIGNUP_PARAMS].sort()).toEqual(
      [
        "audience",
        "client_id",
        "code_challenge",
        "code_challenge_method",
        "nonce",
        "redirect_uri",
        "response_mode",
        "response_type",
        "scope",
        "state",
      ].sort(),
    );
  });
});
