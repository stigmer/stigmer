// The plan create form's draft and its translation to the SDK's
// PlanInput: dollars typed by an operator become exact micros, and every
// field the contract cannot take is refused here with the field that is
// wrong, before a request is sent. The monthly fee travels as the terms'
// `monthlyMinimumMicros`, a wire name the contract keeps.

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
  readonly features: readonly Feature[];
  /** Empty: the plan includes every child organization. */
  readonly includedChildOrgs: string;
  readonly perExtraOrganizationUsd: string;
}

export const EMPTY_PLAN_DRAFT: PlanDraft = {
  name: "",
  slug: "",
  monthlyMinimumUsd: "",
  features: [Feature.channels, Feature.sharing],
  includedChildOrgs: "",
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
  const childOrgs = draft.features.includes(Feature.child_orgs);
  let includedChildOrgs: number | undefined;
  let perExtraOrgMicros: bigint | undefined;
  if (childOrgs && draft.includedChildOrgs.trim() !== "") {
    const included = Number(draft.includedChildOrgs.trim());
    if (!Number.isInteger(included) || included < 0) {
      return { ok: false, field: "includedChildOrgs", message: "A whole number, or empty for unlimited." };
    }
    includedChildOrgs = included;
    const fee = parseUsd(draft.perExtraOrganizationUsd === "" ? "0" : draft.perExtraOrganizationUsd);
    if (fee === null) {
      return { ok: false, field: "perExtraOrganizationUsd", message: "A dollar amount per organization, e.g. 25." };
    }
    perExtraOrgMicros = fee;
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
        ...(includedChildOrgs === undefined ? {} : { limits: { includedChildOrgs } }),
      },
      terms: {
        monthlyMinimumMicros: minimum,
        ...(perExtraOrgMicros === undefined ? {} : { perExtraOrgMicros }),
      },
    },
  };
}

