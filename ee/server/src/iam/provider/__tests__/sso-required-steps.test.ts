/**
 * Pins the update-shape helpers of the sign-in requirement's rules
 * (../sso-required-steps.ts): what counts as an update whose only change is
 * turning the requirement off (the one update a lapsed license never
 * freezes), compared field by field, name and labels included.
 */
import { clone, create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";

import { onlyTurnsSsoRequiredOff } from "../sso-required-steps.js";

function required(labels: Record<string, string>): IdentityProvider {
  return create(IdentityProviderSchema, {
    metadata: { id: "idp_okta", org: "org_acme", name: "Acme Okta", labels },
    spec: { displayName: "Acme Okta", isSsoProvider: true, ssoRequired: true, allowedIssuers: ["https://acme.okta.test"] },
  });
}

function off(stored: IdentityProvider, change: (next: IdentityProvider) => void = () => {}): IdentityProvider {
  const next = clone(IdentityProviderSchema, stored);
  next.spec!.ssoRequired = false;
  change(next);
  return next;
}

describe("onlyTurnsSsoRequiredOff", () => {
  it("is true for the requirement going off and nothing else, labels kept", () => {
    const stored = required({ team: "security" });
    expect(onlyTurnsSsoRequiredOff(stored, off(stored))).toBe(true);
  });

  it("is false when anything else changes too: the spec, the name, a label", () => {
    const stored = required({ team: "security" });
    expect(onlyTurnsSsoRequiredOff(stored, off(stored, (next) => (next.spec!.displayName = "Okta")))).toBe(false);
    expect(onlyTurnsSsoRequiredOff(stored, off(stored, (next) => (next.metadata!.name = "Okta")))).toBe(false);
    expect(onlyTurnsSsoRequiredOff(stored, off(stored, (next) => (next.metadata!.labels = { team: "it" })))).toBe(false);
    expect(onlyTurnsSsoRequiredOff(stored, off(stored, (next) => (next.metadata!.labels = {})))).toBe(false);
  });

  it("is false when the requirement was not on, or stays on", () => {
    const stored = required({});
    const notOn = off(stored);
    expect(onlyTurnsSsoRequiredOff(notOn, off(notOn))).toBe(false);
    expect(onlyTurnsSsoRequiredOff(stored, clone(IdentityProviderSchema, stored))).toBe(false);
  });
});
