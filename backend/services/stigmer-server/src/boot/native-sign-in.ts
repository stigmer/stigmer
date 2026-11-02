/**
 * What `getServerInfo` tells an installed app about signing in.
 *
 * An app on a person's computer (the desktop app) asks the server it points
 * at how to sign in, before anyone is signed in: the answer is the
 * `native_sign_in` field, the identity provider's issuer, the audience this
 * server's access tokens carry, and the public native client registered
 * for such apps. Nothing about sign-in is built into the app, so one app
 * serves Stigmer Cloud and any company's own server.
 *
 * The answer has two sources, and a composition uses at most one:
 *   - the open-source setting STIGMER_OIDC_NATIVE_CLIENT_ID, beside the
 *     issuer and audience the server already verifies against;
 *   - a composed unit's `nativeSignIn` declaration (the unit that holds the
 *     composition's identity tenant), for a composition whose verifiers are
 *     its own.
 *
 * {@link resolveNativeSignIn} decides, as a pure function of the
 * configuration and the registry's fold, so every rule is tested without a
 * server. Two rules are boot faults, each named for the operator: both
 * sources at once (two answers to one question), and a declaration on a
 * composition that trusts every request (no sign-in to describe). The
 * open-source setting is lenient like the console's client id: unset under
 * an issuer, no app can sign in and the server warns; set without an
 * issuer, it describes nothing and the server warns that it is unused.
 */

import type { NativeSignInDeclaration } from "../extensions/registry.js";

/** What the composition root knows when it resolves the answer. */
export interface NativeSignInSources {
  /** STIGMER_OIDC_ISSUER, "" when the open-source OIDC posture is off. */
  readonly oidcIssuer: string;
  /** STIGMER_OIDC_AUDIENCE, set whenever the issuer is (config.ts). */
  readonly oidcAudience: string;
  /** STIGMER_OIDC_NATIVE_CLIENT_ID, "" when unset. */
  readonly oidcNativeClientId: string;
  /** A unit's declaration, folded by the registry. */
  readonly declared:
    | { readonly value: NativeSignInDeclaration; readonly declaredBy: string }
    | undefined;
  /** The resolved require-authentication posture (issuer OR a unit's declaration). */
  readonly requireAuthentication: boolean;
}

/** The answer, and what the composition root should warn about. */
export interface ResolvedNativeSignIn {
  /** What `getServerInfo` announces; undefined announces nothing. */
  readonly answer: NativeSignInDeclaration | undefined;
  /** Boot warnings, each a sentence for the operator. */
  readonly warnings: readonly string[];
}

/**
 * Resolves the native sign-in answer. Throws, naming the cause, for a
 * composition that sets both sources or declares one without the
 * require-authentication posture.
 */
export function resolveNativeSignIn(sources: NativeSignInSources): ResolvedNativeSignIn {
  const { declared } = sources;
  const settingIsSet = sources.oidcNativeClientId !== "";

  if (declared !== undefined && settingIsSet) {
    throw new Error(
      `extension '${declared.declaredBy}' declares native sign-in, and STIGMER_OIDC_NATIVE_CLIENT_ID is set too — a server announces one way to sign in; unset STIGMER_OIDC_NATIVE_CLIENT_ID or drop the declaration`,
    );
  }
  if (declared !== undefined) {
    if (!sources.requireAuthentication) {
      throw new Error(
        `extension '${declared.declaredBy}' declares native sign-in on a composition without the require-authentication posture — a server that trusts every request has no sign-in to describe; declare requireAuthentication on the unit that registers a verifier, or drop the declaration`,
      );
    }
    return { answer: declared.value, warnings: [] };
  }

  if (sources.oidcIssuer === "") {
    return {
      answer: undefined,
      warnings: settingIsSet
        ? [
            "STIGMER_OIDC_NATIVE_CLIENT_ID is set but STIGMER_OIDC_ISSUER is not — this server signs nobody in, so the native client describes nothing and is unused; set the issuer and audience, or unset it",
          ]
        : [],
    };
  }
  if (!settingIsSet) {
    return {
      answer: undefined,
      warnings: [
        "STIGMER_OIDC_ISSUER is set but STIGMER_OIDC_NATIVE_CLIENT_ID is not — the desktop app cannot sign in to this server; register a public native client (Authorization Code with PKCE, redirects stigmer://auth/callback and http://127.0.0.1:17234-17236/auth/callback) at the issuer and set it",
      ],
    };
  }
  return {
    answer: {
      issuer: sources.oidcIssuer,
      audience: sources.oidcAudience,
      clientId: sources.oidcNativeClientId,
    },
    warnings: [],
  };
}
