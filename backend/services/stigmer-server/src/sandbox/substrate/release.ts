/**
 * The Agent Substrate release this server speaks to, named once beside the
 * stubs generated from it (gen/, from the tag in
 * ../../../buf.gen.substrate.yaml; a test holds the two equal).
 *
 * Substrate has no version call, so a server and a control plane at
 * different releases learn of each other only by a refused call: gRPC
 * answers a service or method the control plane does not serve with
 * UNIMPLEMENTED ("unknown service …", "unknown method …"). The gateway
 * names this release in that error (gateway.ts, SubstrateReleaseError), so
 * the operator is told which release to install.
 */
export const SUBSTRATE_RELEASE = "v1.0.0";
