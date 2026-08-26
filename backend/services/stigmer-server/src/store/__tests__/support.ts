/**
 * Driver-neutral test fixtures shared by the store contract suite and the
 * per-driver tests: a small organization factory (a real ported proto
 * type, so tests exercise real resource bytes). Driver-physical helpers
 * (temp sqlite files, the Go-database fixture, Postgres test databases)
 * live with their drivers.
 */
import { create } from "@bufbuild/protobuf";

import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

/** Minimal valid organization resource for storage round-trips. */
export function makeOrganization(overrides?: {
  id?: string;
  name?: string;
  slug?: string;
  description?: string;
  labels?: Record<string, string>;
}): Organization {
  const id = overrides?.id ?? "acme";
  return create(OrganizationSchema, {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: {
      id,
      name: overrides?.name ?? "Acme",
      slug: overrides?.slug ?? id,
      labels: overrides?.labels ?? {},
    },
    spec: { description: overrides?.description ?? "a test organization" },
  });
}
