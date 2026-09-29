// A fresh Organization per tenancy scope, created on the target.
// Domain: conformance support.
//
// Every org-scoped lane authorizes on the Organization it names, and every
// edition answers NOT_FOUND for one the server does not hold (the open
// source server without sign-in too, since stigmer#1163). So a scope is a
// real Organization, never a bare slug: every target provisions through
// this one create, whose caller becomes the Organization's owner. The
// slug and id come from the server's answer, because the name is all the
// create sends and the slug is derived from it.
import type { ConformanceClients } from "../harness/clients";
import { uniqueOrg } from "./naming";

const ORG_API_VERSION = "tenancy.stigmer.ai/v1";
const ORG_KIND = "Organization";

export interface CreatedOrganization {
  readonly slug: string;
  readonly id: string;
}

/**
 * Creates an Organization with a unique name through `organizationCommand`.
 * `scope` names what it provisions, for the refusal when the server answers
 * no slug or id.
 */
export async function createUniqueOrganization(
  organizationCommand: ConformanceClients["organizationCommand"],
  scope: string,
): Promise<CreatedOrganization> {
  const created = await organizationCommand.create({
    apiVersion: ORG_API_VERSION,
    kind: ORG_KIND,
    metadata: { name: uniqueOrg() },
  });
  const slug = created.metadata?.slug;
  const id = created.metadata?.id;
  if (slug === undefined || slug === "" || id === undefined || id === "") {
    throw new Error(
      `organization create returned no slug/id; cannot provision ${scope}`,
    );
  }
  return { slug, id };
}
