/**
 * The trusted-local Authorizer — open source's driver for the one
 * authorization decision seam (extensions/authorizer.ts) under the
 * trusted-local posture (posture.ts): the laptop, a server with no sign-in.
 * It separates no callers (there is one, the operator), so every check is
 * `allow`, with one exception that is not a permission question at all.
 *
 * A check whose target is an Organization the store does not hold is
 * `not-found`. "Does this Organization exist" is a load question, and
 * every posture's Authorizer answers it the same way: the built-in
 * driver's arm 4 (authorizer.ts) before any permission is evaluated, and
 * the cloud's on its deny path (stigmer-cloud
 * src/authorizer/fga-authorizer.ts, the existence probe). The Authorize
 * step turns the arm into the load-first chain's NOT_FOUND,
 * `Organization not found: <slug>`, so a server without sign-in refuses a
 * write into a phantom Organization with the sentence a server with
 * sign-in answers, instead of storing it under a slug nothing lists
 * (stigmer#1163). Reads that name the Organization (a list by org, a
 * usage report) are answered the same way, as they are under sign-in.
 *
 * Why the Organization alone. Every org-scoped lane authorizes on it (a
 * create by `metadata.org`, a list or report by `org`), and its
 * absence is the one no later step catches. The other kinds' update, get
 * and delete chains load their target first and answer NOT_FOUND
 * themselves, and a general existence read would refuse the rowless
 * `platform` (model/bindings.ts), whose checks the laptop must keep
 * allowing. An Organization's id is its slug (domain/organization/
 * steps.ts), so the read is one primary key; the posture is open source's
 * edition only (compose.ts refuses a wider edition without sign-in), so
 * every Organization is a row in this store.
 *
 * Arms, in order: an empty target id is `allow` (a platform-scoped write
 * names no Organization, and the Authorize step maps a not-found on an
 * empty id to INTERNAL); a kind other than the Organization is `allow`
 * with no read; a missing Organization is `not-found`; a present one is
 * `allow`. A store fault is `unavailable` with its cause, the built-in
 * driver's guard: an outage is never softened into a refusal of a
 * different kind, and the driver never throws.
 *
 * Proven by __tests__/trusted-local-authorizer.postgres.test.ts (the arms, on both
 * store drivers) and extensions/__tests__/built-in-authorization-
 * composed.test.ts (the wire, beside the same sentence under sign-in).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../extensions/authorizer.js";
import { ResourceNotFoundError } from "../store/interface.js";
import type { Store } from "../store/interface.js";

/** The one read the driver makes: the Organization's row by id. */
export type TrustedLocalAuthorizerStore = Pick<Store, "getResource">;

export interface TrustedLocalAuthorizerDeps {
  readonly store: TrustedLocalAuthorizerStore;
}

export function newTrustedLocalAuthorizer(
  deps: TrustedLocalAuthorizerDeps,
): Authorizer {
  return {
    async authorize(_caller, check: AuthzCheck): Promise<AuthzDecision> {
      if (
        check.resourceKind !== ApiResourceKind.organization ||
        check.resourceId === ""
      ) {
        return { kind: "allow" };
      }
      try {
        await deps.store.getResource(
          ApiResourceKind.organization,
          check.resourceId,
          OrganizationSchema,
        );
        return { kind: "allow" };
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return { kind: "not-found" };
        }
        return {
          kind: "unavailable",
          cause: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
  };
}
