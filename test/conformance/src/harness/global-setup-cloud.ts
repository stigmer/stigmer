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
import {
  bootstrapPrimaryIdentity,
  CLOUD_ENV,
  spawnCloudEnvironment,
  type CloudEnvironment,
} from "./cloud-env";

export default async function setup(): Promise<() => Promise<void>> {
  if (process.env[CLOUD_ENV.address] !== undefined && process.env[CLOUD_ENV.token] !== undefined) {
    console.log(
      `cloud conformance: using pre-provisioned environment at ${process.env[CLOUD_ENV.address]}`,
    );
    return async () => {};
  }

  console.log("cloud conformance: booting hermetic environment (infra + stigmer-service)...");
  const environment: CloudEnvironment = await spawnCloudEnvironment();

  try {
    const identity = await bootstrapPrimaryIdentity(environment.grpcBaseUrl);
    process.env[CLOUD_ENV.address] = environment.grpcBaseUrl;
    process.env[CLOUD_ENV.httpAddress] = environment.httpBaseUrl;
    process.env[CLOUD_ENV.token] = identity.token;
    process.env[CLOUD_ENV.platformClientId] = identity.platformClient.clientId;
    process.env[CLOUD_ENV.platformClientSecret] = identity.platformClient.clientSecret;
    process.env[CLOUD_ENV.operatorToken] = identity.operatorToken;
  } catch (err) {
    await environment.stop();
    throw err;
  }

  console.log(`cloud conformance: environment ready at ${environment.grpcBaseUrl}`);
  return () => environment.stop();
}
