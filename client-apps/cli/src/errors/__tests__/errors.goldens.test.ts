// Goldens of the errors whose words depend on what the running command
// recorded: a server that cannot be reached, once for each source of the
// address the backend client dialled (the local daemon, a cloud and a
// self-hosted backend, the STIGMER_SERVER_ADDRESS override) and once for the
// connect probe's timeout; a missing resource whose type the command
// resolved; and the requests a server refuses inside a named command. The
// errors with nothing recorded are frozen beside the other human output
// (output/__tests__/human.goldens.test.ts). Each golden holds the plain form
// and the --debug one, whose stack is set by hand so it names no machine's
// paths; `npx vitest run -u` rewrites them.

import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectGolden } from "../../__test-utils__/golden.js";
import { createBackendClient } from "../../client/client.js";
import { setActionCommand, setActionResourceType, setServerAddress, type ServerAddress } from "../../runtime.js";
import { classify } from "../classify.js";
import { formatError } from "../handle.js";

afterEach(() => {
  setServerAddress(undefined);
  setActionCommand("");
  setActionResourceType("");
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** An error with a stack that names no machine's paths. */
function withStack<E extends Error>(error: E): E {
  error.stack = `${error.name}: ${error.message}\n    at command (src/commands/example.ts:1:1)`;
  return error;
}

async function expectErrorGolden(error: Error, name: string): Promise<void> {
  const cli = classify(error);
  expect(cli).not.toBeNull();
  await expectGolden(`exit ${cli!.exitCode}\n\n${formatError(cli!, false)}\n--- with --debug ---\n${formatError(cli!, true)}`, `error-${name}`);
}

describe("CLI-04 a server that cannot be reached is named by the address tried, with its fix", () => {
  const addresses: ReadonlyArray<readonly [string, ServerAddress]> = [
    ["local", { address: "localhost:7234", source: "local" }],
    ["cloud", { address: "api.example.com:443", source: "cloud" }],
    ["selfhost", { address: "stigmer.acme.internal:7234", source: "selfhost" }],
    ["environment", { address: "10.0.0.5:7234", source: "environment" }],
  ];

  it.each(addresses)("prints the unreachable %s server", async (name, address) => {
    setServerAddress(address);
    await expectErrorGolden(withStack(new ConnectError("connect ECONNREFUSED 10.0.0.5:7234", Code.Unavailable)), `unavailable-${name}`);
  });

  it("prints the connect probe's timeout as an unreachable server, with how long it waited", async () => {
    // The local daemon's address, unless the shell running the tests overrides it.
    vi.stubEnv("STIGMER_SERVER_ADDRESS", "");
    vi.useFakeTimers();
    const silent = createRouterTransport(({ service }) => {
      service(PlatformQueryController, {
        getServerInfo: () => new Promise<never>(() => undefined),
      });
    });
    const client = createBackendClient({ config: { backend: {} }, transport: silent });
    const failure = client.connect().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(10_000);
    await expectErrorGolden(withStack((await failure) as Error), "connect-timeout-local");
  });
});

describe("CLI-04 what a named command's errors point at", () => {
  it("prints a missing resource with the list of its type", async () => {
    setActionCommand("stigmer get");
    setActionResourceType("agent");
    await expectErrorGolden(withStack(new ConnectError("agent 'demo/reviewer' not found", Code.NotFound)), "not-found-agent");
  });

  const refusals: ReadonlyArray<readonly [string, ConnectError]> = [
    ["invalid-argument", new ConnectError("spec.instructions: value is required", Code.InvalidArgument)],
    ["failed-precondition", new ConnectError("the session has a turn that waits for an answer", Code.FailedPrecondition)],
    ["already-exists", new ConnectError("agent 'demo/reviewer'", Code.AlreadyExists)],
  ];

  it.each(refusals)("prints %s with the command's help", async (name, error) => {
    setActionCommand("stigmer apply");
    await expectErrorGolden(withStack(error), `${name}-in-command`);
  });
});
