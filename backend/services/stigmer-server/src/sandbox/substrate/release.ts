/**
 * The Agent Substrate release this server speaks to, named once beside the
 * stubs generated from it (gen/, from the tag in
 * ../../../buf.gen.substrate.yaml; a test holds the two equal).
 *
 * Substrate has no version call, so a server and a control plane at
 * different releases learn of each other only by a refused call: Substrate
 * denies a method it has no authorization rule for, before routing it, with
 * PERMISSION_DENIED. The gateway names this release in that sentence
 * (gateway.ts, skewSentence), so the operator is told which release to
 * install rather than which grant to add.
 */
export const SUBSTRATE_RELEASE = "v1.0.0";
