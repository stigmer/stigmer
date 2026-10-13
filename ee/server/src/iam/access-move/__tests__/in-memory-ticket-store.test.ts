/**
 * Holds the in-memory access move ticket store the move's suites run on to
 * the port's contract kit (../store-contract.ts), the same cases the
 * Postgres adapter passes (postgres-store.postgres.test.ts beside this
 * suite). The fixture's outage is a wrapper that refuses every call once
 * cut, since a map has no connection to lose.
 */
import { describe, it } from "vitest";

import {
  accessMoveTicketStoreContract,
  type AccessMoveTicketStoreContractFixture,
} from "../store-contract.js";
import { newInMemoryTicketStore } from "./in-memory-ticket-store.js";

function makeFixture(): Promise<AccessMoveTicketStoreContractFixture> {
  const inner = newInMemoryTicketStore();
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

describe("the in-memory access move ticket store holds the port's contract", () => {
  for (const contractCase of accessMoveTicketStoreContract(makeFixture)) {
    it(contractCase.name, contractCase.run);
  }
});
