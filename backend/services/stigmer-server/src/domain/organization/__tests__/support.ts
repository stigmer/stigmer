/**
 * Test fixtures for the Organization domain, shared by every composed
 * suite that writes into an Organization: `organizationInput` is the
 * smallest create the chain accepts, and `seedOrganizations` creates each
 * named Organization through the server's own create RPC, so the rows are
 * exactly what a person's first create writes: the server mints each id
 * (org_<ulid>) and keeps the slug as the organization's name
 * (domain/organization/steps.ts). It answers each slug's minted id, which
 * a suite uses wherever a value is stored, compared with stored data,
 * passed in-process or written straight to the store; a serving request
 * may still name the organization by slug, since the serving chain
 * resolves it (pipeline/interceptors/organization-names.ts).
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

import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";

/** The smallest Organization create: slug, name and description all `slug`. */
export function organizationInput(slug: string) {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: slug },
  };
}

/** An organization's minted id by its slug, as `seedOrganizations` answers it. */
export type OrganizationIds = ReadonlyMap<string, string>;

/**
 * Creates each Organization, in order, as the transport's caller, and
 * answers each slug's minted id.
 */
export async function seedOrganizations(
  transport: Transport,
  slugs: ReadonlyArray<string>,
): Promise<OrganizationIds> {
  const organizations = createClient(OrganizationCommandController, transport);
  const ids = new Map<string, string>();
  for (const slug of slugs) {
    const created = await organizations.create(organizationInput(slug));
    ids.set(slug, created.metadata?.id ?? "");
  }
  return ids;
}

/** The minted id of a seeded slug; a slug the suite never seeded fails loudly. */
export function organizationId(ids: OrganizationIds, slug: string): string {
  const id = ids.get(slug);
  if (id === undefined || id === "") {
    throw new Error(`organization ${slug} was not seeded`);
  }
  return id;
}
