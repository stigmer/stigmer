import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { transport } from "./transport";

import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

// ---------------------------------------------------------------------------
// Client
//
// Same codegenv1 type-inference workaround used in execution-service.ts.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client: any = createClient(OrganizationQueryController, transport);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type { Organization };

/**
 * Fetch all organizations the authenticated user is a member of.
 *
 * Returns an empty array when the user has no org memberships.
 */
export async function fetchMyOrganizations(): Promise<Organization[]> {
  const request = create(EmptySchema, {});
  const response = await (client.findMyOrganizations(request) as Promise<{
    entries: Organization[];
  }>);
  return response.entries;
}
