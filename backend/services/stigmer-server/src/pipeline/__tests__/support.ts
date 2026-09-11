/**
 * Shared test identity for RequestContext construction (O2, ruling Q3):
 * the identity parameter is required, so every test constructs one
 * explicitly — never a hidden default that could mask a missed threading
 * site in production code. Overrides let adversarial tests pin specific
 * caller classes.
 */
import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { isRunGateCheck } from "../steps/authorize-run-target.js";

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

/**
 * An Authorizer that answers `decide()` to run-gate checks ONLY and allows
 * everything else (the position-1 organization checks, the reserved-label
 * guard's operator check), recording the run-gate checks it saw. Composed
 * into a test server as an extension unit, it isolates the AuthorizeRunTarget
 * splice from every other authorization site on the chain: a refusal it
 * produces can only have come from the run gate. `decide` is read per
 * check so one composed server can pin the allow and the deny arms.
 */
export function runGateOnlyAuthorizer(decide: () => AuthzDecision): {
  authorizer: Authorizer;
  runGateChecks: AuthzCheck[];
} {
  const runGateChecks: AuthzCheck[] = [];
  return {
    runGateChecks,
    authorizer: {
      authorize(_caller, check) {
        if (!isRunGateCheck(check)) {
          return Promise.resolve({ kind: "allow" });
        }
        runGateChecks.push(check);
        return Promise.resolve(decide());
      },
    },
  };
}
