/**
 * The child entry `__tests__/harness-boot-order.test.ts` spawns: one FRESH
 * Node process that does exactly what the composition roots do before
 * bootstrap — import `harness-adapters.js` and `harness/registry.js`, then
 * `bootHarnesses` on a proxy-mode config — and reports how it went.
 *
 * Why a child process: the `node:http2` ESM facade is snapshotted once per
 * process at its first import, so the positive load-order contract ("the
 * patch reached the facade") cannot be observed inside a shared vitest
 * worker that has already imported half the runner. A fresh process is the
 * only honest instrument (`http2-interceptor.test.ts` says as much).
 *
 * Arms (argv[2]):
 *  - `boot`: import the two pre-boot modules, boot with a proxy endpoint and
 *    a bound token ref. Success means the pre-boot graph was connect-free,
 *    both interceptors installed, `assertHttp2ConnectPatched` passed, and the
 *    SDK slice loaded from inside `boot`.
 *  - `boot-after-connect-node`: the same, after importing the Stigmer client
 *    (connect-node) FIRST. Must fail with the facade sentence: proves the
 *    guard is live inside `boot`, so a future regression is loud.
 *
 * Output: one line, `harness-boot-order: ok` or `harness-boot-order: <message>`,
 * then exit 0 on success and 1 on a rejection. The proxy endpoint is an inert
 * loopback nothing listens on; boot dials nothing.
 */

import { testConfig } from "./config-fixture.js";

const arm = process.argv[2];

async function main(): Promise<void> {
  if (arm === "boot-after-connect-node") {
    await import("../client/stigmer-client.js");
  } else if (arm !== "boot") {
    throw new Error(`harness-boot-order-child: unknown arm '${String(arm)}' (expected 'boot' or 'boot-after-connect-node')`);
  }

  const [{ HARNESS_ADAPTERS }, { adaptersOf, bootHarnesses }] = await Promise.all([
    import("../harness-adapters.js"),
    import("../harness/registry.js"),
  ]);
  const config = testConfig({
    proxyEndpoint: "http://127.0.0.1:1",
    proxyTokenRef: { current: "boot-order-test-token" },
  });
  await bootHarnesses(adaptersOf(HARNESS_ADAPTERS), config);
}

main().then(
  () => {
    process.stdout.write("harness-boot-order: ok\n");
    process.exit(0);
  },
  (err: unknown) => {
    process.stdout.write(`harness-boot-order: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
