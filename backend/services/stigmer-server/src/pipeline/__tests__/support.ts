/**
 * Shared test fixtures for the pipeline and the domains.
 *
 * The caller identity for RequestContext construction: the identity
 * parameter is required, so every test constructs one explicitly — never a
 * hidden default that could mask a missed threading site in production
 * code. Overrides let adversarial tests pin specific caller classes.
 *
 * The run-gate authorizer, which isolates the AuthorizeRunTarget splice from
 * every other authorization site on a chain.
 *
 * The store-fault helpers the per-domain `store-faults` tests share: a store
 * whose reads fail with a chosen error, a dependency that must never be
 * reached once a load has failed, and the ConnectError a failing call
 * rejects with. Together they pin the error contract's store-fault rule
 * (`src/pipeline/errors.ts`): a typed not-found answers NotFound, any other
 * store failure a sanitized Internal.
 */
import { ConnectError } from "@connectrpc/connect";
import { expect } from "vitest";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { Store } from "../../store/interface.js";
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

/** A dependency the call must never reach once its load has failed. */
export function untouchable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      throw new Error(`${name}.${String(prop)} reached after a failed load`);
    },
  });
}

/** A store whose every read fails with the given error. */
export function failingStore(error: Error): Store {
  return {
    getResource: () => Promise.reject(error),
  } as unknown as Store;
}

/** The ConnectError `call` rejects with; fails the test if it resolves. */
export async function errorOf(
  call: () => Promise<unknown>,
): Promise<ConnectError> {
  const error = await call().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, "the call must fail").toBeInstanceOf(ConnectError);
  return error as ConnectError;
}
