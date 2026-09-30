// The call verdict's fixture for a config that forgot the setup file: run by
// run-fixture.ts with `--no-setup`, its one call must reject by name instead
// of leaving the tag unjudged. ../../rpc-recorder.test.ts reads the report.
// Domain: conformance harness (the RPC contract's call verdict).
import { it } from "vitest";
import { createTransport, makeClients } from "../../../clients";
import { getFreePort } from "../../../ports";

it("[rpc:AgentQueryController.get] unjudged: sends its RPC under a config without the setup file", async () => {
  const clients = makeClients(createTransport(`http://127.0.0.1:${await getFreePort()}`));
  await clients.agentQuery.get({});
});
