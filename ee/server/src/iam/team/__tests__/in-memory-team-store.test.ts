/**
 * Holds the in-memory Team store the unit suites run on to the
 * port's contract kit (../store-contract.ts), the same cases a host's
 * adapter passes in its own suites: a suite that passes over this double is
 * passing over a store proven to answer as a real driver does.
 * The fixture's outage is a wrapper that refuses every call once cut,
 * since a map has no connection to lose.
 */
import { describe, it } from "vitest";

import { teamStoreContract, type TeamStoreContractFixture } from "../store-contract.js";
import { InMemoryTeamStore } from "./in-memory-team-store.js";

function makeFixture(): Promise<TeamStoreContractFixture> {
  const inner = new InMemoryTeamStore();
  let cut = false;
  const store = new Proxy(inner, {
    get: (target, member) => {
      const value: unknown = Reflect.get(target, member);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]): unknown =>
        cut ? Promise.reject(new Error("the store was cut from its database")) : Reflect.apply(value, target, args);
    },
  });
  return Promise.resolve({
    store,
    disconnect: () => {
      cut = true;
      return Promise.resolve();
    },
    cleanup: () => Promise.resolve(),
  });
}

describe("the in-memory Team store holds the port's contract", () => {
  for (const contractCase of teamStoreContract(makeFixture)) {
    it(contractCase.name, contractCase.run);
  }
});
