/**
 * Pins the message-level rules of the plan, subscription and license
 * contract through the shared validator every edition runs
 * (steps/validation.ts, the same instance the transport interceptor uses).
 *
 * Why here and not in a conformance suite: every billing kind is cloud_only,
 * so the open-source server never serves a Plan or a License and the
 * cross-edition suites, where field rules are normally proven against a
 * running server, cannot reach them. The vocabulary those kinds share with
 * the Enterprise edition (Entitlements, LicenseClaims) is verified offline
 * by a server that holds no store for it at all. The one place in this
 * repository where a rule on these messages can be proven red-then-green is
 * the validator itself, so this file drives it directly, one row per rule,
 * a passing shape beside every refused one.
 *
 * What the rows pin: the instrument decides which PlanTerms a plan may carry;
 * a license's timestamps are ordered (issue, expiry, grace); a limit is
 * present or absent, never zero; a feature is named once. A row that
 * stops matching means the contract moved, and the proto is where it moved.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  PlanInstrument,
  PlanSpecSchema,
} from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { LicenseSpecSchema } from "@stigmer/protos/ai/stigmer/billing/license/v1/spec_pb";
import {
  EntitlementLimitsSchema,
  EntitlementsSchema,
  Feature,
} from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import {
  LicenseClaimsSchema,
  LicenseTerm,
} from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { describe, expect, it } from "vitest";

import { validator } from "../steps/validation.js";

const t = (iso: string) => timestampFromDate(new Date(iso));

const customer = {
  id: "cus_acme",
  displayName: "Acme Corp",
  contactEmail: "billing@acme.example",
};
const entitlements = { features: [Feature.channels] };
const orderedTerm = {
  issuedAt: t("2026-09-01T00:00:00Z"),
  expiresAt: t("2027-09-01T00:00:00Z"),
  graceUntil: t("2027-10-01T00:00:00Z"),
};

/** One row: a message, its init, and the rule id it must trip, or none. */
interface Row<Desc extends DescMessage> {
  readonly name: string;
  readonly schema: Desc;
  readonly init: MessageInitShape<Desc>;
  readonly refusedBy?: string;
}

function row<Desc extends DescMessage>(r: Row<Desc>): Row<Desc> {
  return r;
}

const rows: ReadonlyArray<Row<DescMessage>> = [
  row({
    name: "a subscription plan with monthly terms",
    schema: PlanSpecSchema,
    init: {
      instrument: PlanInstrument.subscription,
      entitlements,
      terms: { monthlyMinimumMicros: 1n, usageShareBasisPoints: 100 },
    },
  }),
  row({
    name: "a license plan with an annual price",
    schema: PlanSpecSchema,
    init: {
      instrument: PlanInstrument.license,
      entitlements,
      terms: { annualPriceMicros: 1n },
    },
  }),
  row({
    name: "a plan with no terms at all",
    schema: PlanSpecSchema,
    init: { instrument: PlanInstrument.subscription, entitlements },
  }),
  row({
    name: "a license plan carrying a monthly minimum",
    schema: PlanSpecSchema,
    init: {
      instrument: PlanInstrument.license,
      entitlements,
      terms: { monthlyMinimumMicros: 1n },
    },
    refusedBy: "plan_spec.license_has_no_monthly_terms",
  }),
  row({
    name: "a license plan carrying a usage share",
    schema: PlanSpecSchema,
    init: {
      instrument: PlanInstrument.license,
      entitlements,
      terms: { usageShareBasisPoints: 100 },
    },
    refusedBy: "plan_spec.license_has_no_monthly_terms",
  }),
  row({
    name: "a subscription plan carrying an annual price",
    schema: PlanSpecSchema,
    init: {
      instrument: PlanInstrument.subscription,
      entitlements,
      terms: { annualPriceMicros: 1n },
    },
    refusedBy: "plan_spec.subscription_has_no_annual_price",
  }),
  row({
    name: "a usage share above one hundred percent",
    schema: PlanSpecSchema,
    init: {
      instrument: PlanInstrument.subscription,
      entitlements,
      terms: { usageShareBasisPoints: 10001 },
    },
    refusedBy: "int32.gte_lte",
  }),
  row({
    name: "ordered license claims",
    schema: LicenseClaimsSchema,
    init: {
      licenseId: "lic_1",
      customer,
      term: LicenseTerm.paid,
      entitlements,
      ...orderedTerm,
    },
  }),
  row({
    name: "claims expiring before they were issued",
    schema: LicenseClaimsSchema,
    init: {
      licenseId: "lic_1",
      customer,
      term: LicenseTerm.paid,
      entitlements,
      ...orderedTerm,
      expiresAt: t("2026-08-01T00:00:00Z"),
      graceUntil: t("2026-08-02T00:00:00Z"),
    },
    refusedBy: "license_claims.expires_after_issue",
  }),
  row({
    name: "claims whose grace ends before expiry",
    schema: LicenseClaimsSchema,
    init: {
      licenseId: "lic_1",
      customer,
      term: LicenseTerm.paid,
      entitlements,
      ...orderedTerm,
      graceUntil: t("2027-08-01T00:00:00Z"),
    },
    refusedBy: "license_claims.grace_not_before_expiry",
  }),
  row({
    name: "a customer with no contact address",
    schema: LicenseClaimsSchema,
    init: {
      licenseId: "lic_1",
      customer: { id: "cus_acme", displayName: "Acme Corp" },
      term: LicenseTerm.paid,
      entitlements,
      ...orderedTerm,
    },
    refusedBy: "required",
  }),
  row({
    name: "a customer whose contact address is not an email",
    schema: LicenseClaimsSchema,
    init: {
      licenseId: "lic_1",
      customer: { ...customer, contactEmail: "acme" },
      term: LicenseTerm.paid,
      entitlements,
      ...orderedTerm,
    },
    refusedBy: "string.email",
  }),
  row({
    name: "a license spec whose grace ends before expiry",
    schema: LicenseSpecSchema,
    init: {
      customer,
      entitlements,
      term: LicenseTerm.trial,
      expiresAt: orderedTerm.expiresAt,
      graceUntil: t("2027-08-01T00:00:00Z"),
    },
    refusedBy: "license_spec.grace_not_before_expiry",
  }),
  row({
    name: "a license spec with grace on the expiry instant",
    schema: LicenseSpecSchema,
    init: {
      customer,
      entitlements,
      term: LicenseTerm.trial,
      expiresAt: orderedTerm.expiresAt,
      graceUntil: orderedTerm.expiresAt,
    },
  }),
  row({
    name: "a limit of zero, which is never what an operator meant",
    schema: EntitlementLimitsSchema,
    init: { maxOrganizations: 0 },
    refusedBy: "int32.gt",
  }),
  row({
    name: "an absent limit, which is no limit",
    schema: EntitlementLimitsSchema,
    init: {},
  }),
  row({
    name: "a feature named twice",
    schema: EntitlementsSchema,
    init: { features: [Feature.channels, Feature.channels] },
    refusedBy: "repeated.unique",
  }),
  row({
    name: "the unspecified feature",
    schema: EntitlementsSchema,
    init: { features: [Feature.feature_unspecified] },
    refusedBy: "enum.not_in",
  }),
];

describe("the billing contract's rules, through the shared validator", () => {
  for (const r of rows) {
    const verdict =
      r.refusedBy === undefined ? "passes" : `is refused by ${r.refusedBy}`;
    it(`${r.name} ${verdict}`, () => {
      const result = validator().validate(r.schema, create(r.schema, r.init));
      if (r.refusedBy === undefined) {
        expect(result.kind).toBe("valid");
        return;
      }
      if (result.kind !== "invalid") {
        throw new Error(`expected a refusal, got ${result.kind}`);
      }
      expect(result.error.violations.map((v) => v.ruleId)).toContain(
        r.refusedBy,
      );
    });
  }
});
