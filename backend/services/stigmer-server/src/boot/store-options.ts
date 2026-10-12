/**
 * What the composition root opens the store with: the list indexes
 * (list-indexes.ts) and the session event gates
 * (domain/session/events/gates.ts), both derived by the store on every
 * write and re-derived at open. One constant, so a test that opens a store
 * the way the server does cannot forget either.
 */
import { SESSION_EVENT_GATES } from "../domain/session/events/gates.js";
import type { StoreOpenOptions } from "../store/interface.js";
import { LIST_INDEXES } from "./list-indexes.js";

export const STORE_OPEN_OPTIONS: StoreOpenOptions = {
  listIndexes: LIST_INDEXES,
  sessionEventGates: SESSION_EVENT_GATES,
};
