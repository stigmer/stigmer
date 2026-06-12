// `get` dispatch: resolve a single resource by reference. Most kinds go through
// the registry-bound SDK sub-clients (get-bindings); organizations are a
// special case (not org-scoped; slug lookups resolve via findMyOrganizations).

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { CliExitError, ExitCode, UsageError } from "../errors/index.js";
import { getterFor, type ResourceResult } from "./get-bindings.js";
import type { ParsedReference } from "./reference.js";

export async function fetchResource(
  client: Stigmer,
  kind: ApiResourceKind,
  ref: ParsedReference,
): Promise<ResourceResult> {
  if (kind === ApiResourceKind.organization) {
    return fetchOrganization(client, ref);
  }
  const getter = getterFor(kind);
  if (getter === undefined) {
    throw new UsageError("get is not implemented for this resource type");
  }
  return getter(client, ref);
}

async function fetchOrganization(client: Stigmer, ref: ParsedReference): Promise<ResourceResult> {
  if (ref.kind === "id") {
    return { schema: OrganizationSchema, message: await client.organization.get(ref.id) };
  }
  // Organizations are not org-scoped, so a bare token is a slug to resolve
  // against the caller's memberships rather than an org/slug pair.
  const mine = await client.organization.findMyOrganizations();
  const match = mine.entries.find(
    (org) => org.metadata?.slug === ref.slug || org.metadata?.name === ref.slug,
  );
  if (match === undefined) {
    throw new CliExitError(`organization "${ref.slug}" not found`, ExitCode.NotFound);
  }
  return { schema: OrganizationSchema, message: match };
}
