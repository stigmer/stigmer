/**
 * How an installed app signs in, resolved at boot (native-sign-in.ts).
 *
 * The answer `getServerInfo` announces comes from the open-source setting
 * (STIGMER_OIDC_NATIVE_CLIENT_ID beside the issuer and audience) or from a
 * unit's declaration, never both. Pinned here, as a pure function: each
 * source's answer, the two boot faults with the sentence that names the
 * cause, and the two lenient cases that only warn. The composed proofs are
 * in auth-enabled-composition.test.ts (the setting on the wire) and
 * extensions/__tests__/extension-composition.test.ts (the boot faults
 * through composeServer).
 */
import { describe, expect, it } from "vitest";
import { resolveNativeSignIn, type NativeSignInSources } from "../native-sign-in.js";

const ISSUER = "https://id.acme.example";
const AUDIENCE = "https://api.acme.example";

const NOTHING: NativeSignInSources = {
  oidcIssuer: "",
  oidcAudience: "",
  oidcNativeClientId: "",
  declared: undefined,
  requireAuthentication: false,
};

const CLOUD = {
  value: { issuer: "https://id.stigmer.example/", audience: "https://api.stigmer.example/", clientId: "desktop" },
  declaredBy: "cloud-iam",
};

describe("resolveNativeSignIn", () => {
  it("announces nothing, and says nothing, on a server that trusts every request", () => {
    expect(resolveNativeSignIn(NOTHING)).toEqual({ answer: undefined, warnings: [] });
  });

  it("announces the open-source issuer, audience and native client together", () => {
    expect(
      resolveNativeSignIn({
        ...NOTHING,
        oidcIssuer: ISSUER,
        oidcAudience: AUDIENCE,
        oidcNativeClientId: "native-1",
        requireAuthentication: true,
      }),
    ).toEqual({ answer: { issuer: ISSUER, audience: AUDIENCE, clientId: "native-1" }, warnings: [] });
  });

  it("warns, and announces nothing, when the server signs people in but names no native client", () => {
    const resolved = resolveNativeSignIn({
      ...NOTHING,
      oidcIssuer: ISSUER,
      oidcAudience: AUDIENCE,
      requireAuthentication: true,
    });
    expect(resolved.answer).toBeUndefined();
    expect(resolved.warnings).toEqual([
      expect.stringMatching(
        /^STIGMER_OIDC_ISSUER is set but STIGMER_OIDC_NATIVE_CLIENT_ID is not — the desktop app cannot sign in to this server; register a public native client .*stigmer:\/\/auth\/callback/,
      ),
    ]);
  });

  it("warns that a native client set without an issuer is unused, and announces nothing", () => {
    const resolved = resolveNativeSignIn({ ...NOTHING, oidcNativeClientId: "native-1" });
    expect(resolved.answer).toBeUndefined();
    expect(resolved.warnings).toEqual([
      expect.stringMatching(/^STIGMER_OIDC_NATIVE_CLIENT_ID is set but STIGMER_OIDC_ISSUER is not — .* unused/),
    ]);
  });

  it("announces a unit's declaration as it was declared", () => {
    expect(resolveNativeSignIn({ ...NOTHING, declared: CLOUD, requireAuthentication: true })).toEqual({
      answer: CLOUD.value,
      warnings: [],
    });
  });

  it("refuses a declaration beside the open-source setting, naming the unit", () => {
    expect(() =>
      resolveNativeSignIn({
        ...NOTHING,
        oidcNativeClientId: "native-1",
        declared: CLOUD,
        requireAuthentication: true,
      }),
    ).toThrowError(
      "extension 'cloud-iam' declares native sign-in, and STIGMER_OIDC_NATIVE_CLIENT_ID is set too — a server announces one way to sign in; unset STIGMER_OIDC_NATIVE_CLIENT_ID or drop the declaration",
    );
  });

  it("refuses a declaration on a composition that trusts every request, naming the unit", () => {
    expect(() => resolveNativeSignIn({ ...NOTHING, declared: CLOUD })).toThrowError(
      /^extension 'cloud-iam' declares native sign-in on a composition without the require-authentication posture — a server that trusts every request has no sign-in to describe/,
    );
  });
});
