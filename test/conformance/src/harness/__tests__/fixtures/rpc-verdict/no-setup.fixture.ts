// The call verdict's fixture for a config that forgot the setup file: run by
// run-fixture.ts with `--no-setup`, its one call must reject by name instead
// of leaving the tag unjudged. ../../rpc-recorder.test.ts reads the report.
// Domain: conformance harness (the RPC contract's call verdict).
import { it } from "vitest";
import { createTransport, makeClients } from "../../../clients";
import { UNREACHABLE_HOST_PORT } from "@stigmer/test-support/ports";

it("[rpc:AgentQueryController.get] unjudged: sends its RPC under a config without the setup file", async () => {
  const clients = makeClients(createTransport(`http://${UNREACHABLE_HOST_PORT}`));
  await clients.agentQuery.get({});
});
