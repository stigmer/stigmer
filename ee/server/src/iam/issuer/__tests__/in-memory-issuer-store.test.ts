/**
 * Holds the in-memory FederationIssuer store the unit suites run on to the
 * port's contract kit (../store-contract.ts), the same cases a host's
 * adapter passes in its own suites: a suite that passes over this double is
 * passing over a store proven to answer as a real driver does.
 * The fixture's outage is a wrapper that refuses every call once cut,
 * since a map has no connection to lose.
 */
import { describe, it } from "vitest";

import { federationIssuerStoreContract, type FederationIssuerStoreContractFixture } from "../store-contract.js";
import { InMemoryIssuerStore } from "./in-memory-issuer-store.js";

function makeFixture(): Promise<FederationIssuerStoreContractFixture> {
  const inner = new InMemoryIssuerStore();
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

describe("the in-memory FederationIssuer store holds the port's contract", () => {
  for (const contractCase of federationIssuerStoreContract(makeFixture)) {
    it(contractCase.name, contractCase.run);
  }
});
