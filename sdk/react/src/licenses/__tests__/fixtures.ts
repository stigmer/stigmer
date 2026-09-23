// Shared License fixtures for the licenses suites: one builder over the
// generated schemas, so every test states only the fields it is about.

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { LicenseSchema, type License } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { LicenseTerm } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";

export interface LicenseFixture {
  readonly id: string;
  readonly customerId?: string;
  readonly customerName?: string;
  readonly contactEmail?: string;
  readonly term?: LicenseTerm;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly graceUntil?: string;
  readonly maxUsers?: number;
  readonly maxOrganizations?: number;
  readonly features?: readonly Feature[];
  readonly ticket?: string;
  readonly notes?: string;
}

export function license(f: LicenseFixture): License {
  return create(LicenseSchema, {
    apiVersion: "billing.stigmer.ai/v1",
    kind: "License",
    metadata: { id: f.id, name: `license ${f.id}`, slug: f.id.replace(/_/g, "-") },
    spec: {
      customer: {
        id: f.customerId ?? "cus_acme",
        displayName: f.customerName ?? "Acme Corp",
        contactEmail: f.contactEmail ?? "licensing@acme.test",
      },
      entitlements: {
        limits: {
          ...(f.maxUsers !== undefined && { maxUsers: f.maxUsers }),
          ...(f.maxOrganizations !== undefined && { maxOrganizations: f.maxOrganizations }),
        },
        features: [...(f.features ?? [Feature.platform_client])],
      },
      term: f.term ?? LicenseTerm.paid,
      expiresAt: timestampFromDate(new Date(f.expiresAt)),
      graceUntil: timestampFromDate(new Date(f.graceUntil ?? f.expiresAt)),
      notes: f.notes ?? "",
    },
    status: {
      keyId: "license-signing:v1",
      issuedAt: timestampFromDate(new Date(f.issuedAt)),
      ticket: f.ticket ?? "",
      audit: {
        specAudit: {
          createdBy: { id: "ida_operator", email: "operator@stigmer.test", displayName: "Platform Operator" },
          createdAt: timestampFromDate(new Date(f.issuedAt)),
        },
      },
    },
  });
}
