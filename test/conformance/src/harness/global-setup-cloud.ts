// Vitest global setup for the cloud target: one environment per run.
// Domain: conformance harness (cloud target lifecycle).
//
// Unlike local targets — cheap enough for every suite file to boot its own
// server — the cloud environment (Testcontainers infra + the Java service) is
// far too heavy for per-file boot. It is provisioned once here and published
// to workers through the CLOUD_ENV env vars: vitest runs globalSetup in the
// main process, and workers fork afterwards and inherit process.env.
//
// When the address and token are already present in the environment (a
// pre-provisioned or deployed endpoint), the launcher boot is skipped
// entirely; the env-var contract is the interface either way.
//
// Since E1 (entry 20260906.04) the setup also owns the cloud-capability
// fixtures — the fake LLM upstream, Stripe API and Discord webhook the service
// dials. They boot FIRST (the service's base URLs are fixed at its boot), are
// handed to the launcher on its environment, and are scripted by the workers
// over the control URL this setup publishes.
import {
  bootstrapPrimaryIdentity,
  CLOUD_ENV,
  EDGE_AUTHENTICATION,
  spawnCloudEnvironment,
  type CloudEnvironment,
} from "./cloud-env";
import { launcherEnvFor, startCloudFixtures, type CloudFixtures } from "./cloud-fixtures";

export default async function setup(): Promise<() => Promise<void>> {
  if (process.env[CLOUD_ENV.address] !== undefined && process.env[CLOUD_ENV.token] !== undefined) {
    console.log(
      `cloud conformance: using pre-provisioned environment at ${process.env[CLOUD_ENV.address]}`,
    );
    return async () => {};
  }

  console.log("cloud conformance: starting cloud-capability fixtures (LLM upstream, Stripe, Discord)...");
  const fixtures: CloudFixtures = await startCloudFixtures();

  console.log("cloud conformance: booting hermetic environment (infra + stigmer-service)...");
  let environment: CloudEnvironment;
  try {
    environment = await spawnCloudEnvironment(launcherEnvFor(fixtures.addresses));
  } catch (err) {
    await fixtures.stop();
    throw err;
  }

  try {
    const identity = await bootstrapPrimaryIdentity(environment.grpcBaseUrl);
    process.env[CLOUD_ENV.address] = environment.grpcBaseUrl;
    process.env[CLOUD_ENV.httpAddress] = environment.httpBaseUrl;
    // The cloud-capability lanes: on Java every HTTP lane but bidi is the
    // Spring listener; the composition publishes per-lane listeners instead
    // (see TargetProfile.proxyBaseUrl for why the contract is per lane).
    process.env[CLOUD_ENV.proxyAddress] = environment.httpBaseUrl;
    process.env[CLOUD_ENV.publicAddress] = environment.httpBaseUrl;
    process.env[CLOUD_ENV.stripeWebhookAddress] = environment.httpBaseUrl;
    process.env[CLOUD_ENV.cursorBidiAddress] = environment.cursorBidiBaseUrl;
    process.env[CLOUD_ENV.stripeWebhookSecret] = fixtures.addresses.stripeWebhookSecret;
    process.env[CLOUD_ENV.fixturesControlUrl] = fixtures.addresses.controlUrl;
    process.env[CLOUD_ENV.token] = identity.token;
    process.env[CLOUD_ENV.platformClientId] = identity.platformClient.clientId;
    process.env[CLOUD_ENV.platformClientSecret] = identity.platformClient.clientSecret;
    process.env[CLOUD_ENV.operatorToken] = identity.operatorToken;
    // This setup chose STIGMER_SECURITY_MODE=test for the JAR (the launcher's
    // default — the tokenless bootstrap above depends on it), so it is the
    // one place that may declare the edge bypassed. Pre-provisioned
    // endpoints never reach this line and keep the enforced default.
    process.env[CLOUD_ENV.edgeAuthentication] = EDGE_AUTHENTICATION.bypassedTestMode;
  } catch (err) {
    await environment.stop();
    await fixtures.stop();
    throw err;
  }

  console.log(`cloud conformance: environment ready at ${environment.grpcBaseUrl}`);
  return async () => {
    // Reverse boot order: the JVM that dials the fixtures stops first.
    await environment.stop();
    await fixtures.stop();
  };
}
