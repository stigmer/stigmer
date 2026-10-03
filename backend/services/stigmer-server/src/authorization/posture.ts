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
 *     tuples — so the role rows are enforced. An edition above
 *     open source may run it too, once every kind it serves has rows the
 *     derivation can read (`kindsWithoutRows` below).
 *   - `trusted-local`: no unit Authorizer and no authentication posture —
 *     the laptop. The permissive driver (trusted-local-authorizer.ts): one
 *     caller, nothing to separate, so every check is allowed except one
 *     that names an Organization the server does not hold, which is
 *     not-found as under the other two postures (stigmer#1163). The
 *     trusted-local identity carries the operator's EMAIL,
 *     never an account id, and pre-2a rows are stamped `"system"`, so an
 *     enforcing evaluator would refuse the laptop's own history. The roles
 *     still exist (the lifecycle and the membership rules run) to feed the
 *     Members page truthfully. Open source's edition only: a composition
 *     serving an edition above it refuses to boot here, since an edition
 *     of many organizations with no sign-in would act as the operator for
 *     every request that carries no credential.
 *
 * The type lives with the module that gives it meaning (the precedent:
 * `ConsoleSignInPosture` in transport/console/handler.ts); the
 * composition root computes the value once and hands it down.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import type { ResourceRowReader } from "../extensions/resource-row-reader.js";
import { kindServedByEdition } from "../pipeline/apiresource-meta.js";
import type { Model } from "./model/index.js";

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

/**
 * The kinds an edition serves whose rows the built-in authorizer could not
 * read: declared by the model with a row schema, served by the edition,
 * not served by open source (whose kinds are its own store's), and not
 * `identity_account` (read through the account port), with no reader
 * registered for them. Empty means the built-in posture can answer every
 * check the edition's lanes make. The composition root refuses a built-in
 * posture that leaves any, rather than answer from rows that are not there.
 */
export function kindsWithoutRows(inputs: {
  readonly edition: ServerEdition;
  readonly model: Model;
  readonly readers: ReadonlyMap<ApiResourceKind, ResourceRowReader>;
}): ReadonlyArray<ApiResourceKind> {
  return inputs.model.declarations
    .filter(
      (declaration) =>
        declaration.schema !== undefined &&
        declaration.kind !== ApiResourceKind.identity_account &&
        kindServedByEdition(declaration.kind, inputs.edition) &&
        !kindServedByEdition(declaration.kind, ServerEdition.oss) &&
        !inputs.readers.has(declaration.kind),
    )
    .map((declaration) => declaration.kind);
}
