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

/** The three-arm decision (blueprint §5a — deny and unavailable are distinct). */
export type AuthzDecision =
  | { readonly kind: "allow" }
  /** A genuine denial — maps to PERMISSION_DENIED on the wire. */
  | { readonly kind: "deny"; readonly reason: string }
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
