// Pins the generated inputs of the organization-less kinds (License, Plan).
// Their contract says metadata.org is empty, so the input types org as `""`:
// omitting it and passing "" both compile, and a real organization is a type
// error (the @ts-expect-error lines fail typecheck if that ever loosens). The
// builder sends whatever an untyped caller passes, so the server's refusal
// names a wrong org instead of the SDK dropping it.
import { describe, expect, it } from "vitest";
import { LicenseTerm } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { PlanInstrument } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";

import { buildLicenseProto, type LicenseInput } from "../../gen/license";
import { buildPlanProto, type PlanInput } from "../../gen/plan";

const license: LicenseInput = {
  name: "acme-enterprise",
  customer: { id: "cus_acme", displayName: "Acme", contactEmail: "ops@acme.test" },
  entitlements: {},
  term: LicenseTerm.paid,
  expiresAt: "2027-09-30T00:00:00Z",
  graceUntil: "2027-10-30T00:00:00Z",
};

const plan: PlanInput = {
  name: "Team",
  instrument: PlanInstrument.subscription,
  entitlements: {},
};

describe("organization-less kinds' inputs", () => {
  it("need no org, and leave metadata.org empty", () => {
    expect(buildLicenseProto(license).metadata?.org).toBe("");
    expect(buildPlanProto(plan).metadata?.org).toBe("");
  });

  it("accept the empty org callers passed before", () => {
    expect(buildLicenseProto({ ...license, org: "" }).metadata?.org).toBe("");
    expect(buildPlanProto({ ...plan, org: "" }).metadata?.org).toBe("");
  });

  it("refuse a real organization at compile time", () => {
    // @ts-expect-error a License belongs to the platform, not to an organization
    const withOrg: LicenseInput = { ...license, org: "acme" };
    // @ts-expect-error a Plan belongs to the platform, not to an organization
    const planWithOrg: PlanInput = { ...plan, org: "acme" };
    expect(withOrg.org).toBe("acme");
    expect(planWithOrg.org).toBe("acme");
  });

  it("send an untyped caller's org as given, for the server to refuse", () => {
    const untyped = { ...license, org: "acme" } as unknown as LicenseInput;
    expect(buildLicenseProto(untyped).metadata?.org).toBe("acme");
  });
});
