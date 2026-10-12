/**
 * The post-compose transport holder: a slot a builder hands to the lanes
 * that must call the composed server in-process (the grant-path client,
 * the invitation preview, and any lane of the host's own that does), filled
 * by the host with `server.inProcessTransport` after `composeServer`
 * returns and before `server.start()`.
 *
 * A holder rather than a transport because the transport does not exist
 * while the units are built: the units are inputs to `composeServer`, which
 * builds it. Each user reads `transport` at call time and owns its own
 * refusal for the empty slot (a lane used before the wiring fails loudly,
 * naming itself), so this type carries no behaviour.
 *
 * Sibling of unary-chain.ts: both are building blocks every extension lane
 * shares, whichever domain or edition it belongs to.
 */
import type { Transport } from "@connectrpc/connect";

export interface TransportRef {
  transport?: Transport;
}
