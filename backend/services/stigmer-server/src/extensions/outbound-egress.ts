/**
 * The outbound-egress driver point: WHICH addresses this edition's control
 * plane may dial when it reaches a URL a user supplied. Single instance,
 * registered as `drivers.outboundEgress` (the policyGrantScope shape: a
 * driver point whose absence is open source's own behaviour). Absent, the
 * composition root installs `relaxedEgressPolicy()`: everything but the
 * link-local range is allowed, because a server beside a self-hosted
 * control plane (`http://localhost:3000/mcp`, the proto's own example) is
 * the normal case and the link-local range, which carries the cloud
 * metadata endpoint, costs a local user nothing to refuse. The cloud
 * registers `strictEgressPolicy()`: loopback, private, link-local and
 * unspecified refused, because its control plane sits on infrastructure
 * with reach to internal services.
 *
 * Who reads it: nobody in the domains directly. The composition root builds
 * ONE guarded fetch from the policy (`@stigmer/outbound/egress`
 * `guardedFetch`, which judges the first URL and every redirect hop) and
 * hands it to the McpServer connect slice as `outboundFetch`, the only
 * fetch the McpServer domain's OAuth code and its save-time endpoint probe
 * hold. Before this point existed every OAuth fetch (discovery, dynamic
 * client registration, the authorize preflight, token exchange and
 * refresh) defaulted to the raw global `fetch` in every edition, which is
 * the exposure the point closes.
 *
 * The contract every policy is held to:
 *
 *   - It judges ADDRESSES, not names: the check resolves a hostname and
 *     asks about every address it has, so a name with one public and one
 *     private record is refused. A policy that wanted a hostname allowlist
 *     would be a different seam.
 *   - It is TOTAL: an unparseable address is refused ("unrecognized"),
 *     never a throw.
 *   - It is SYNCHRONOUS: an edition's egress posture is a fact about where
 *     it runs, never I/O.
 *
 * Both constructors are thin over the shared classification in
 * `@stigmer/outbound/egress`, so a composition registers a posture and owns
 * no copy of the ranges; the runner's `web_fetch` guard reads the same
 * table, so the two processes refuse the same addresses under the same
 * posture name.
 */
import { egressPolicyForPosture, type EgressPolicy } from "@stigmer/outbound/egress";

/** The egress contract (single-instance point, ExtensionDrivers.outboundEgress). */
export type OutboundEgressPolicy = EgressPolicy;

/** Open source's own posture: only the link-local (cloud metadata) range is refused. */
export function relaxedEgressPolicy(): OutboundEgressPolicy {
  return egressPolicyForPosture("relaxed");
}

/** The managed-cloud posture: loopback, private, link-local and unspecified addresses refused. */
export function strictEgressPolicy(): OutboundEgressPolicy {
  return egressPolicyForPosture("strict");
}
