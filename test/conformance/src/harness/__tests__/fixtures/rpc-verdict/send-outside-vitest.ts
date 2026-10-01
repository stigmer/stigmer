// Sends one call through createTransport from a plain `tsx` process, as the
// live benchmark (scripts/benchmark-harnesses.ts) does, and prints what the
// call failed with. Run by ../../rpc-recorder.test.ts with VITEST_* removed
// from the environment: the recorder must stay out of the way, so the error
// is the transport's own, never vitest's "failed to access its internal
// state".
// Domain: conformance harness (the RPC contract's call verdict).
import { ConnectError } from "@connectrpc/connect";
import { createTransport, makeClients } from "../../../clients";
import { UNREACHABLE_HOST_PORT } from "@stigmer/test-support/ports";

const clients = makeClients(createTransport(`http://${UNREACHABLE_HOST_PORT}`));
try {
  await clients.agentQuery.get({});
  console.log(JSON.stringify({ outcome: "answered" }));
} catch (error) {
  console.log(
    JSON.stringify({
      outcome: error instanceof ConnectError ? "connect-error" : "other-error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}
