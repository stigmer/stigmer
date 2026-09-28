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
//   npx tsx scripts/cloud-fixtures-serve.ts --default-reply
//
// `--default-reply` puts the fake LLM in default-reply mode (stigmer/stigmer#1402):
// a local development stack's agent runs get a canned text turn for every call
// nobody scripted. A conformance readout never passes it: the suites script
// every call and treat an unscripted one as a failure.
//
// The operator then boots the composition with the STIGMER_* values shown and
// exports the STIGMER_CONFORMANCE_CLOUD_* lines into the suite's shell.
import { CLOUD_ENV } from "../src/harness/cloud-env";
import { startCloudFixtures } from "../src/harness/cloud-fixtures";

const KNOWN_FLAGS = new Set(["--default-reply"]);

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  const unknown = flags.filter((flag) => !KNOWN_FLAGS.has(flag));
  if (unknown.length > 0) {
    console.error(`cloud-fixtures-serve: unknown argument(s) ${unknown.join(" ")} (known: ${[...KNOWN_FLAGS].join(", ")})`);
    process.exit(2);
  }
  const llmDefaultReply = flags.includes("--default-reply");
  const fixtures = await startCloudFixtures({ llmDefaultReply });
  const a = fixtures.addresses;

  console.error("cloud-capability fixtures serving; boot the server under test with:");
  console.error(`  STIGMER_STRIPE_WEBHOOK_SECRET=${a.stripeWebhookSecret}`);
  console.error(`  STIGMER_STRIPE_API_BASE=${a.stripeApiUrl}`);
  console.error(`  STIGMER_PROXY_LLM_OPENAI_BASEURL=${a.llmUpstreamUrl}`);
  console.error(`  STIGMER_PROXY_LLM_ANTHROPIC_BASEURL=${a.llmUpstreamUrl}`);
  console.error(`  STIGMER_LEADS_DISCORD_WEBHOOK_URL=${a.discordWebhookUrl}`);
  if (llmDefaultReply) console.error("the fake LLM answers every unscripted request with its default reply (--default-reply)");
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
