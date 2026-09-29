/**
 * Test fixtures for the Organization domain, shared by every composed
 * suite that writes into an Organization: `organizationInput` is the
 * smallest create the chain accepts, and `seedOrganizations` creates each
 * named Organization through the server's own create RPC, so the rows are
 * exactly what a person's first create writes (the slug is the id,
 * domain/organization/steps.ts).
 *
 * Why every such suite needs it: every org-scoped lane authorizes on the
 * Organization it names, and under every posture a missing one answers
 * NOT_FOUND before any other step (the trusted-local driver since
 * stigmer#1163, authorization/trusted-local-authorizer.ts). A suite that
 * writes under a slug nobody created is testing the phantom write that
 * fix removed, so it seeds the slugs it uses in its `beforeAll`, once the
 * server listens. A slug a test means to be absent is simply not seeded.
 */
import { createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";

import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

/** The smallest Organization create: slug, name and description all `slug`. */
export function organizationInput(slug: string) {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: slug },
  };
}

/** Creates each Organization, in order, as the transport's caller. */
export async function seedOrganizations(
  transport: Transport,
  slugs: ReadonlyArray<string>,
): Promise<void> {
  const organizations = createClient(OrganizationCommandController, transport);
  for (const slug of slugs) {
    await organizations.create(organizationInput(slug));
  }
}
