/**
 * The child entry `__tests__/harness-boot-order.test.ts` spawns: one FRESH
 * runner process that does exactly what the composition roots do before
 * bootstrap — import `harness-adapters.js`, `harness/registry.js` and
 * `agent-host/hosting.js`, host the table, then `bootHarnesses` on a
 * proxy-mode config — and reports how it went. The test starts it with
 * `__test-utils__/refuse-engine-sdks.ts`, which makes importing an engine's
 * SDK in this process fail.
 *
 * Arms (argv[2]):
 *  - `boot`: host the table and boot it. Success means every harness was
 *    booted in a real agent host started from this build's entry, which
 *    announced itself and loaded every engine there; and that this process,
 *    the runner, loaded no engine's SDK.
 *  - `import-engine`: import `deepagents` here. Must fail naming it: proves
 *    the refusal is live, so the first arm's silence means something.
 *  - `import-claude`: the same for `@anthropic-ai/claude-agent-sdk`, the
 *    engine whose SDK is a dependency the runner never loads.
 *
 * Output: one line, `harness-boot-order: ok` or `harness-boot-order: <message>`,
 * then exit 0 on success and 1 on a rejection. The proxy endpoint is an inert
 * loopback nothing listens on; boot dials nothing.
 */

import { testConfig } from "./config-fixture.js";

const arm = process.argv[2];

async function main(): Promise<void> {
  if (arm === "import-engine") {
    await import("deepagents");
  } else if (arm === "import-claude") {
    await import("@anthropic-ai/claude-agent-sdk");
  } else if (arm !== "boot") {
    throw new Error(`harness-boot-order-child: unknown arm '${String(arm)}' (expected 'boot', 'import-engine' or 'import-claude')`);
  }

  const [{ HARNESS_ADAPTERS }, { adaptersOf, bootHarnesses, shutdownHarnesses }, { hostHarnesses }] = await Promise.all([
    import("../harness-adapters.js"),
    import("../harness/registry.js"),
    import("../agent-host/hosting.js"),
  ]);
  const config = testConfig({ proxyEndpoint: "http://127.0.0.1:1" });
  const hosted = await hostHarnesses(HARNESS_ADAPTERS, config);
  try {
    await bootHarnesses(adaptersOf(hosted.rows), config);
  } finally {
    await shutdownHarnesses(adaptersOf(hosted.rows)).catch(() => undefined);
    await hosted.close();
  }
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
