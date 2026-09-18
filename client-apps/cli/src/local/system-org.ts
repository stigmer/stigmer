// The system organization, as code: the one `stigmer` org every Stigmer
// backend carries, which the official default plugins are installed into
// and the local CLI falls back to when no org is configured.
//
// This is the only place the org is defined. The bootstrap creates it when
// a backend does not have it (a fresh local data dir, a raw self-hosted
// server); on the hosted platform it already exists, owned by IAM, and the
// create never fires. Its slug is the same in both editions, so nothing
// here is configurable: a bootstrap that could be pointed at another org
// would put the platform's public defaults where no cross-org lookup finds
// them.
//
// "Ensure" is find-then-create with the race closed by the server: two
// launchers racing the same check see one `already-exists`, and that IS the
// desired end state, so it is reported as `present`, never rethrown. Any
// other refusal (a self-hosted authorizer that denies the reserved label,
// a backend that refuses the create) propagates with the server's sentence;
// the caller decides how loud to be.

import { ManagementMode } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/enum_pb";
import { type Stigmer, StigmerError } from "@stigmer/sdk";

/** The system organization's slug, identical across editions. */
export const SYSTEM_ORG = "stigmer";

/**
 * Marks the system org so an operator can tell it from a user's own org in
 * any listing. Informational: no server or client code path reads it.
 */
export const SYSTEM_ORG_LABEL = "stigmer.ai/system";

export type EnsureSystemOrgOutcome = "present" | "created";

/**
 * Make sure the system organization exists on the backend `stigmer` is bound
 * to. Idempotent; a lost create race counts as `present`.
 */
export async function ensureSystemOrg(
  stigmer: Stigmer,
): Promise<EnsureSystemOrgOutcome> {
  const mine = await stigmer.organization.findMyOrganizations();
  if (mine.entries.some((org) => org.metadata?.slug === SYSTEM_ORG)) {
    return "present";
  }
  try {
    // Organizations are self-owning: the org field is the slug itself, the
    // shape the console's create form and the e2e harness both use.
    await stigmer.organization.create({
      name: "Stigmer",
      slug: SYSTEM_ORG,
      org: SYSTEM_ORG,
      description: "System organization for Stigmer installations",
      labels: { [SYSTEM_ORG_LABEL]: "true" },
      managementMode: ManagementMode.self_managed,
    });
    return "created";
  } catch (error) {
    if (error instanceof StigmerError && error.code === "already-exists") {
      return "present";
    }
    throw error;
  }
}
