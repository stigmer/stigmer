/**
 * The identity-federation capability (20260911.11, Q-IA-9): the four
 * federated-account RPC arms the identity-account controller dispatches
 * to when a composed unit provides them, plus the identity-provider
 * existence check their shared precondition rides. Single instance,
 * registered as `drivers.identityFederation` (the organizationDirectory
 * shape: a driver point that is byte-identical OSS behaviour when absent).
 *
 * Absent, the controller refuses the four RPCs UNIMPLEMENTED with the
 * edition reason (domain/identityaccount/constants.ts) — never INTERNAL,
 * the organization directory's absent-method precedent. Present, the
 * controller still owns what is shared: the annotation's Authorize step
 * on the organization, the ref-with-slug and org-match checks, and the
 * IdP-exists refusal through `providerExists`; the arm receives the
 * RESOLVED ref (org filled from the input when the ref left it empty)
 * and the authenticated caller, and owns only what differs per edition —
 * the natural-key lookups and writes on the federated rows.
 *
 * The federated natural key (provider ref + external subject) and its
 * lookups stay on the unit's own store: the IdentityAccountStore port
 * carries direct-account methods only, because a port does not carry
 * methods only one edition calls.
 */
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type {
  CreateFederatedAccountInput,
  DeprovisionFederatedAccountInput,
  ExternalSubLookup,
  UpdateFederatedAccountInput,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";

import type { CallerIdentity } from "./identity.js";

export interface IdentityFederation {
  createFederatedAccount(
    input: CreateFederatedAccountInput,
    ref: ApiResourceReference,
    caller: CallerIdentity,
  ): Promise<IdentityAccount>;
  updateFederatedAccount(
    input: UpdateFederatedAccountInput,
    ref: ApiResourceReference,
    caller: CallerIdentity,
  ): Promise<IdentityAccount>;
  deprovisionFederatedAccount(
    input: DeprovisionFederatedAccountInput,
    ref: ApiResourceReference,
    caller: CallerIdentity,
  ): Promise<IdentityAccount>;
  getByExternalSub(
    lookup: ExternalSubLookup,
    ref: ApiResourceReference,
    caller: CallerIdentity,
  ): Promise<IdentityAccount>;
  /** Whether the IdentityProvider `org/slug` exists — the arms' shared precondition. */
  providerExists(org: string, slug: string): Promise<boolean>;
}
