/**
 * The port-contract runner — the scaffolding every domain store PORT's
 * contract kit is built on (identity-account's store-contract.ts since
 * 20260911.11 A11; IamPolicy's since 20260913.01 slice 2, when this was
 * lifted out of the first kit so the second did not carry a copy).
 *
 * A port kit is a list of named cases a DRIVER's test iterates: open
 * source runs them over its adapter on sqlite and Postgres, a composition
 * runs the same list over the store it registers as a driver, so "the port
 * holds" is one statement proven per driver, never restated per
 * repository. This module owns the part every kit shares and no kit should
 * restate: a FRESH fixture per case, the body run over it, cleanup after,
 * and the rule that a failing body is the failure reported (a cleanup that
 * fails after a failed body must not replace the assertion that matters
 * with a teardown detail; a cleanup that fails after a passing body is a
 * real failure).
 *
 * Shape. The package's precedent is store/__tests__/store-contract.ts —
 * `describeStoreContract(makeFixture)` over the generic Store, a vitest
 * `describe`. A port kit is consumed by ANOTHER package's tests through the
 * published barrel, so it ships in dist/ and must not import vitest (a
 * devDependency that would enter the root barrel's runtime import graph).
 * It therefore returns cases instead of calling `describe`, asserts through
 * node:assert/strict, and the consumer's framework does
 * `for (const c of cases) it(c.name, c.run)`. Do not "fix" it back to the
 * precedent's vitest shape.
 *
 * `disconnect` is the one escape hatch a port cannot express: a port has
 * no lifecycle by design (a composition owns its store's), yet "an outage
 * never reads as not-found" is the line that matters most, so a fixture
 * cuts its store from the database and the kit asserts that the fault
 * propagates. `cleanup` must tolerate a disconnected store.
 */

/** One fresh, isolated store per case, plus the one escape hatch the port cannot express. */
export interface PortContractFixture<Port> {
  readonly store: Port;
  /**
   * Cuts the store from its database so every later call is an
   * infrastructure fault. `cleanup` still runs afterwards and must tolerate
   * a disconnected store (both OSS drivers' `close` is idempotent; a pool
   * fixture ends a per-case pool here and skips it in cleanup).
   */
  disconnect(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface PortContractCase {
  /** The contract line, in the port's words; the framework prints it as the test name. */
  readonly name: string;
  /** Makes a FRESH fixture, runs the case, cleans up. A failing assertion wins over a failing cleanup. */
  run(): Promise<void>;
}

/** A case body over a live fixture; the runner owns the fixture's lifecycle around it. */
export type PortContractBody<Port> = (
  fixture: PortContractFixture<Port>,
) => Promise<void>;

/** A kit's declaration: the contract line and the body that proves it. */
export type PortContractDeclaration<Port> = readonly [
  name: string,
  body: PortContractBody<Port>,
];

/**
 * Runs `body` over a fresh fixture. The body's failure is the one reported:
 * a cleanup failure after a failed body would otherwise replace the
 * assertion that matters with a teardown detail.
 */
async function withFixture<Port>(
  makeFixture: () => Promise<PortContractFixture<Port>>,
  body: PortContractBody<Port>,
): Promise<void> {
  const fixture = await makeFixture();
  let failed = false;
  try {
    await body(fixture);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await fixture.cleanup();
    } catch (cleanupError) {
      if (!failed) {
        throw cleanupError;
      }
    }
  }
}

/** The kit's declarations as runnable cases over `makeFixture`, one fresh fixture per case, in declared order. */
export function portContractCases<Port>(
  declarations: ReadonlyArray<PortContractDeclaration<Port>>,
  makeFixture: () => Promise<PortContractFixture<Port>>,
): ReadonlyArray<PortContractCase> {
  return declarations.map(([name, body]) => ({
    name,
    run: () => withFixture(makeFixture, body),
  }));
}
