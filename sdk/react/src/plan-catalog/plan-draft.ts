// The plan create form's draft and its translation to the SDK's
// PlanInput: dollars typed by an operator become exact micros, a percent
// becomes basis points, and every field the contract cannot take is
// refused here with the field that is wrong, before a request is sent.

import type { PlanInput } from "@stigmer/sdk";
import { PlanInstrument } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";

// BigInt(...), not literals: the docs site compiles this source for a
// target below ES2020, which has no BigInt literal syntax.
const MICROS_PER_CENT = BigInt(10_000);
const CENTS_PER_USD = BigInt(100);

/** What an operator types to create a subscription plan. */
export interface PlanDraft {
  readonly name: string;
  readonly slug: string;
  readonly monthlyMinimumUsd: string;
  readonly usageSharePercent: string;
  readonly features: readonly Feature[];
  /** Empty: the plan includes every managed organization. */
  readonly includedManagedOrganizations: string;
  readonly perExtraOrganizationUsd: string;
}

export const EMPTY_PLAN_DRAFT: PlanDraft = {
  name: "",
  slug: "",
  monthlyMinimumUsd: "",
  usageSharePercent: "10",
  features: [Feature.channels, Feature.sharing],
  includedManagedOrganizations: "",
  perExtraOrganizationUsd: "",
};

/** The draft as a PlanInput, or the first field that is wrong and why. */
export type PlanDraftResult =
  | { readonly ok: true; readonly input: PlanInput }
  | { readonly ok: false; readonly field: keyof PlanDraft; readonly message: string };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A dollar amount with at most two decimals as exact micros, or `null`. */
export function parseUsd(text: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const cents = BigInt(match[1] ?? "0") * CENTS_PER_USD + BigInt((match[2] ?? "").padEnd(2, "0"));
  return cents * MICROS_PER_CENT;
}

/** A percent with at most two decimals as basis points, or `null`. */
export function parseBasisPoints(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const points = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return points <= 10_000 ? points : null;
}

/** Translate a draft into the create request, refusing what the contract cannot take. */
export function planInputFromDraft(draft: PlanDraft): PlanDraftResult {
  const name = draft.name.trim();
  if (name === "") {
    return { ok: false, field: "name", message: "A plan needs a name." };
  }
  const slug = draft.slug.trim();
  if (!SLUG.test(slug)) {
    return { ok: false, field: "slug", message: "Lowercase letters, digits and single hyphens, e.g. team-2027." };
  }
  const minimum = parseUsd(draft.monthlyMinimumUsd);
  if (minimum === null) {
    return { ok: false, field: "monthlyMinimumUsd", message: "A dollar amount, e.g. 99 or 99.50." };
  }
  const share = parseBasisPoints(draft.usageSharePercent);
  if (share === null) {
    return { ok: false, field: "usageSharePercent", message: "A percent from 0 to 100, e.g. 10." };
  }
  const managed = draft.features.includes(Feature.managed_organizations);
  let includedManagedOrganizations: number | undefined;
  let perExtraOrganizationMicros: bigint | undefined;
  if (managed && draft.includedManagedOrganizations.trim() !== "") {
    const included = Number(draft.includedManagedOrganizations.trim());
    if (!Number.isInteger(included) || included < 0) {
      return { ok: false, field: "includedManagedOrganizations", message: "A whole number, or empty for unlimited." };
    }
    includedManagedOrganizations = included;
    const fee = parseUsd(draft.perExtraOrganizationUsd === "" ? "0" : draft.perExtraOrganizationUsd);
    if (fee === null) {
      return { ok: false, field: "perExtraOrganizationUsd", message: "A dollar amount per organization, e.g. 25." };
    }
    perExtraOrganizationMicros = fee;
  }
  return {
    ok: true,
    input: {
      name,
      slug,
      org: "",
      instrument: PlanInstrument.subscription,
      entitlements: {
        features: [...new Set(draft.features)].sort((a, b) => a - b),
        ...(includedManagedOrganizations === undefined ? {} : { limits: { includedManagedOrganizations } }),
      },
      terms: {
        monthlyMinimumMicros: minimum,
        usageShareBasisPoints: share,
        ...(perExtraOrganizationMicros === undefined ? {} : { perExtraOrganizationMicros }),
      },
    },
  };
}

