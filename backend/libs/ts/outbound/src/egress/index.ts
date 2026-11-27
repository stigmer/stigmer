/**
 * `@stigmer/outbound/egress`: the address policy a Stigmer process dials
 * user-supplied URLs under, the check that applies it to a URL, the fetch
 * that applies it to every hop, and the variables a sandbox's processes
 * trust its egress gateway by. See each module's header.
 */
export { blockedReason, egressPolicyForPosture, type EgressPolicy, type EgressPosture } from "./address.js";
export {
  checkEgress,
  describeRefusal,
  EgressError,
  refusalWithholdsResolution,
  refusedAddress,
  type EgressCheck,
  type EgressCheckOptions,
  type EgressRefusal,
  type LookupFn,
  type RefusedAddress,
} from "./check.js";
export { asFetch, DEFAULT_MAX_REDIRECTS, DEFAULT_MAX_RESPONSE_BYTES, guardedFetch, type GuardedFetchOptions, type OutboundFetch } from "./fetch.js";
export { nodeLookup } from "./node-lookup.js";
export { GATEWAY_TRUST_VARIABLES, type GatewayTrustVariable } from "./trust.js";
