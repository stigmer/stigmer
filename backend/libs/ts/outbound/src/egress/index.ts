/**
 * `@stigmer/outbound/egress`: the address policy a Stigmer process dials
 * user-supplied URLs under, the check that applies it to a URL, and the
 * fetch that applies it to every hop. See each module's header.
 */
export { blockedReason, egressPolicyForPosture, type EgressPolicy, type EgressPosture } from "./address.js";
export {
  checkEgress,
  describeRefusal,
  EgressError,
  type EgressCheck,
  type EgressCheckOptions,
  type EgressRefusal,
  type LookupFn,
} from "./check.js";
export { asFetch, DEFAULT_MAX_REDIRECTS, guardedFetch, type GuardedFetchOptions, type OutboundFetch } from "./fetch.js";
export { nodeLookup } from "./node-lookup.js";
