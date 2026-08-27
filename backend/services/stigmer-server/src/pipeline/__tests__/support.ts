/**
 * Shared test identity for RequestContext construction (O2, ruling Q3):
 * the identity parameter is required, so every test constructs one
 * explicitly — never a hidden default that could mask a missed threading
 * site in production code. Overrides let adversarial tests pin specific
 * caller classes.
 */
import type { CallerIdentity } from "../../extensions/identity.js";

export function testCallerIdentity(
  overrides: Partial<CallerIdentity> = {},
): CallerIdentity {
  return {
    identityId: "test-caller",
    callerClass: "user",
    issuer: "",
    rawToken: "",
    ...overrides,
  };
}
