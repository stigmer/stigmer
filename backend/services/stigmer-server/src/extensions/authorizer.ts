/**
 * The Authorizer extension point — the one authorization decision seam of
 * the convergence blueprint (20260826.02 blueprint/03 §5, DD-007), carried
 * by the extension registry from O1 (20260826.09) and CONSUMED by O2,
 * which splices the shared Authorize step at position 1 of every chain and
 * installs the OSS permissive single-team default.
 *
 * The interface is transcribed verbatim from the ratified design. The
 * `unavailable` arm is deliberate: the Java StepResult distinguishes
 * denial from evaluation error so an authorization-backend outage surfaces
 * as an INTERNAL fault, never a silent lockout dressed as
 * PERMISSION_DENIED. An interface without that distinction would be wrong
 * on day one — the deny/unavailable mapping is wire contract (deny →
 * PERMISSION_DENIED; unavailable → INTERNAL), unit-tested both arms when
 * O2 lands the step.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { CallerIdentity } from "./identity.js";

/**
 * One authorization check: may `caller` exercise `permission` on the named
 * resource? Permission names are the shared IamPermission enum verbatim —
 * in the cloud they are the FGA relation vocabulary.
 */
export interface AuthzCheck {
  readonly permission: IamPermission;
  readonly resourceKind: ApiResourceKind;
  readonly resourceId: string;
}

/**
 * The decision arms (blueprint §5a — deny and unavailable are distinct).
 *
 * `not-found` is the C2 ruling-Q1 refinement (DD-007 addendum,
 * 20260827.10): for RESOURCE-SCOPED checks, an authorizer that has
 * verified the target does not exist answers not-found instead of deny —
 * the Authorize step maps it to NOT_FOUND with the domain copy, matching
 * the Java edition's deliberate load-before-authorize order
 * (stigmer#224: a nonexistent id answers NOT_FOUND, never
 * PERMISSION_DENIED). Only meaningful with a known kind and a non-empty
 * resource id — anything else is an authorizer contract bug and surfaces
 * as INTERNAL. The OSS permissive default never emits it.
 */
export type AuthzDecision =
  | { readonly kind: "allow" }
  /** A genuine denial — maps to PERMISSION_DENIED on the wire. */
  | { readonly kind: "deny"; readonly reason: string }
  /** The resource-scoped target does not exist — maps to NOT_FOUND. */
  | { readonly kind: "not-found" }
  /** An evaluation failure — maps to INTERNAL on the wire, never a denial. */
  | { readonly kind: "unavailable"; readonly cause: Error };

/**
 * The pure decision interface. Exactly ONE implementation is composed per
 * server (the resolver enforces it): OSS's permissive single-team default
 * (O2) or an extension's (the cloud registers OpenFGA). Write concerns —
 * tuple seeding on create — are NOT authorization checks; they ride the
 * post-persist gate slots (blueprint §5b item 4).
 */
export interface Authorizer {
  authorize(caller: CallerIdentity, check: AuthzCheck): Promise<AuthzDecision>;
}
