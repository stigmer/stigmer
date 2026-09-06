// Runs the cloud-capability fixtures standalone (`npm run fixtures:serve`).
// Domain: conformance harness (cloud-capability fixtures, E1).
//
// For environments the hermetic global setup does not boot — the TS
// composition readout (stigmer-cloud `spike/readout-bootstrap.ts`), a
// deployed endpoint — the fixtures must still exist, because the server under
// test is booted with their addresses and the suites script them. This
// entrypoint starts them, prints the lines to `export` (the readout
// bootstrap's own convention: `export NAME=value` on stdout, prose on
// stderr), and serves until SIGINT/SIGTERM.
//
//   npx tsx scripts/cloud-fixtures-serve.ts
//
// The operator then boots the composition with the STIGMER_* values shown and
// exports the STIGMER_CONFORMANCE_CLOUD_* lines into the suite's shell.
import { CLOUD_ENV } from "../src/harness/cloud-env";
import { startCloudFixtures } from "../src/harness/cloud-fixtures";

async function main(): Promise<void> {
  const fixtures = await startCloudFixtures();
  const a = fixtures.addresses;

  console.error("cloud-capability fixtures serving; boot the server under test with:");
  console.error(`  STIGMER_STRIPE_WEBHOOK_SECRET=${a.stripeWebhookSecret}`);
  console.error(`  STIGMER_STRIPE_API_BASE=${a.stripeApiUrl}`);
  console.error(`  STIGMER_PROXY_LLM_OPENAI_BASEURL=${a.llmUpstreamUrl}`);
  console.error(`  STIGMER_PROXY_LLM_ANTHROPIC_BASEURL=${a.llmUpstreamUrl}`);
  console.error(`  STIGMER_LEADS_DISCORD_WEBHOOK_URL=${a.discordWebhookUrl}`);
  console.error("and export these into the conformance shell:");
  console.log(`export ${CLOUD_ENV.stripeWebhookSecret}=${a.stripeWebhookSecret}`);
  console.log(`export ${CLOUD_ENV.fixturesControlUrl}=${a.controlUrl}`);

  const stop = (): void => {
    void fixtures.stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
