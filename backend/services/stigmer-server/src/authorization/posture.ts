/**
 * The authorization posture — WHICH authorizer a composed server runs,
 * named once so the composition root, the boot log and the tests speak
 * one word for it. Three postures, decided by two facts the registry and
 * the config already hold:
 *
 *   - `unit-authorizer`: a unit registered its own Authorizer (the cloud
 *     composes OpenFGA). Nothing built in is installed — not the
 *     authorizer, not the directory, not the fire caller, and not the
 *     role lifecycle or the membership rules either (a composition with
 *     its own Authorizer has its own onboarding). The require-
 *     authentication posture does not change this.
 *   - `built-in`: no unit Authorizer AND the require-authentication
 *     posture (the OSS OIDC issuer, or a unit's declaration). Open source
 *     composes the built-in Authorizer, the organization directory and
 *     the schedule fire caller — the cloud's model evaluated over derived
 *     tuples — so the roles 2b records are enforced.
 *   - `trusted-local`: no unit Authorizer and no authentication posture —
 *     the laptop. The permissive default stays: one caller, nothing to
 *     separate; the trusted-local identity carries the operator's EMAIL,
 *     never an account id, and pre-2a rows are stamped `"system"`, so an
 *     enforcing evaluator would refuse the laptop's own history. The roles
 *     still exist (the lifecycle and the membership rules run) to feed the
 *     Members page truthfully.
 *
 * The type lives with the module that gives it meaning (the precedent:
 * `ConsoleSignInPosture` in transport/console/handler.ts); the
 * composition root computes the value once and hands it down.
 */
export type AuthorizationPosture =
  | "trusted-local"
  | "built-in"
  | "unit-authorizer";

export interface AuthorizationPostureInputs {
  /** A unit registered `authorizer` (ResolvedExtensions.authorizer !== undefined). */
  readonly unitAuthorizer: boolean;
  /** The require-authentication posture is on (the OIDC issuer or a unit's declaration). */
  readonly requireAuthentication: boolean;
}

export function authorizationPostureOf(
  inputs: AuthorizationPostureInputs,
): AuthorizationPosture {
  if (inputs.unitAuthorizer) {
    return "unit-authorizer";
  }
  return inputs.requireAuthentication ? "built-in" : "trusted-local";
}
