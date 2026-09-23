// Pure customer derivation for the licenses surface.
//
// There is no Customer resource: a license carries its customer as a value,
// and the id is minted on the issuing side and reused for every renewal. The
// customers an operator can pick from are therefore the distinct customer
// ids across the issued licenses, each read from its most recently issued
// license (the freshest name and contact address the operator wrote).
//
// A customer entered twice under two ids would split one company's renewal
// history, and nothing downstream could join it back. The new-customer arm
// guards against that with `findCustomerMatches`: a name or contact address
// that already belongs to a customer is surfaced before the operator mints
// a second id for it.

import type { License } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import type { LicenseCustomer } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { toDate } from "./license-format.js";

/** One customer as the issued licenses know them. */
export interface LicenseCustomerSummary {
  /** The customer value from the customer's most recently issued license. */
  readonly customer: LicenseCustomer;
  /** How many licenses have been issued to this customer. */
  readonly licenseCount: number;
}

/**
 * The distinct customers across `licenses`, sorted by display name. A
 * license without a customer id is skipped: it cannot be renewed against,
 * so offering it in a picker would mint nothing but confusion.
 */
export function deriveLicenseCustomers(
  licenses: readonly License[],
): readonly LicenseCustomerSummary[] {
  const byId = new Map<string, { latest: License; count: number }>();
  for (const license of licenses) {
    const id = license.spec?.customer?.id;
    if (!id) continue;
    const entry = byId.get(id);
    if (!entry) {
      byId.set(id, { latest: license, count: 1 });
      continue;
    }
    entry.count += 1;
    if (issuedMs(license) > issuedMs(entry.latest)) entry.latest = license;
  }

  const summaries: LicenseCustomerSummary[] = [];
  for (const { latest, count } of byId.values()) {
    const customer = latest.spec?.customer;
    if (customer) summaries.push({ customer, licenseCount: count });
  }
  return summaries.sort((a, b) =>
    a.customer.displayName.localeCompare(b.customer.displayName),
  );
}

/**
 * Existing customers a new customer would duplicate: the same display name
 * or the same contact address, compared without case or surrounding and
 * repeated whitespace. An empty candidate field matches nothing.
 */
export function findCustomerMatches(
  customers: readonly LicenseCustomerSummary[],
  candidate: { readonly displayName: string; readonly contactEmail: string },
): readonly LicenseCustomerSummary[] {
  const name = normalize(candidate.displayName);
  const email = normalize(candidate.contactEmail);
  if (name === "" && email === "") return [];
  return customers.filter(
    ({ customer }) =>
      (name !== "" && normalize(customer.displayName) === name)
      || (email !== "" && normalize(customer.contactEmail) === email),
  );
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function issuedMs(license: License): number {
  return toDate(license.status?.issuedAt)?.getTime() ?? Number.NEGATIVE_INFINITY;
}
