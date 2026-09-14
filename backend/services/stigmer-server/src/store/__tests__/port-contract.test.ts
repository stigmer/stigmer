/**
 * Pins the port-contract runner (../port-contract.ts), the scaffolding every
 * domain store port's kit is built on (identity-account since 20260911.11;
 * IamPolicy since 20260913.01 slice 2, when the scaffolding was lifted out
 * of the first kit so the second did not copy it):
 *
 *   - every case makes a FRESH fixture, runs its body over it, and cleans
 *     up — in that order, once each;
 *   - a failing body is the failure reported: a cleanup that fails after
 *     a failed body must not replace the assertion that matters with a
 *     teardown detail;
 *   - a cleanup that fails after a PASSING body is a real failure and
 *     propagates;
 *   - the case list keeps the declared names in the declared order, so a
 *     consumer's pinned name list is a faithful diff of the contract.
 */
import { describe, expect, it } from "vitest";

import { portContractCases } from "../port-contract.js";
import type { PortContractFixture } from "../port-contract.js";

interface Probe {
  readonly label: string;
}

type ProbeFixture = PortContractFixture<Probe>;

function fixtureFactory(
  log: string[],
  options: { readonly failCleanup?: boolean } = {},
): () => Promise<ProbeFixture> {
  let made = 0;
  return async () => {
    made += 1;
    const label = `fixture-${made}`;
    log.push(`make ${label}`);
    return {
      store: { label },
      disconnect: async () => {
        log.push(`disconnect ${label}`);
      },
      cleanup: async () => {
        log.push(`cleanup ${label}`);
        if (options.failCleanup === true) {
          throw new Error(`cleanup of ${label} failed`);
        }
      },
    };
  };
}

describe("portContractCases", () => {
  it("keeps the declared names in the declared order", () => {
    const cases = portContractCases<Probe>(
      [
        ["first line", async () => {}],
        ["second line", async () => {}],
      ],
      fixtureFactory([]),
    );
    expect(cases.map((contractCase) => contractCase.name)).toEqual([
      "first line",
      "second line",
    ]);
  });

  it("makes a fresh fixture per case, runs the body over it, then cleans up — once each", async () => {
    const log: string[] = [];
    const cases = portContractCases<Probe>(
      [
        [
          "a",
          async ({ store }) => {
            log.push(`body over ${store.label}`);
          },
        ],
        [
          "b",
          async ({ store }) => {
            log.push(`body over ${store.label}`);
          },
        ],
      ],
      fixtureFactory(log),
    );
    for (const contractCase of cases) {
      await contractCase.run();
    }
    expect(log).toEqual([
      "make fixture-1",
      "body over fixture-1",
      "cleanup fixture-1",
      "make fixture-2",
      "body over fixture-2",
      "cleanup fixture-2",
    ]);
  });

  it("reports the body's failure, not the cleanup's, when both fail", async () => {
    const log: string[] = [];
    const [only] = portContractCases<Probe>(
      [
        [
          "assertion loses to nothing",
          async () => {
            throw new Error("the assertion that matters");
          },
        ],
      ],
      fixtureFactory(log, { failCleanup: true }),
    );
    await expect(only?.run()).rejects.toThrow("the assertion that matters");
    expect(log).toEqual(["make fixture-1", "cleanup fixture-1"]);
  });

  it("a cleanup failure after a passing body is a real failure", async () => {
    const [only] = portContractCases<Probe>(
      [["passes", async () => {}]],
      fixtureFactory([], { failCleanup: true }),
    );
    await expect(only?.run()).rejects.toThrow("cleanup of fixture-1 failed");
  });
});
