// Vitest global setup for the cloud execution run (Class B vs the Java
// stigmer-service).
// Domain: conformance harness (cloud target lifecycle).
//
// The environment story is the cloud Class A setup verbatim — one hermetic
// environment per run, published through the CLOUD_ENV contract (or a
// pre-provisioned endpoint, skipping the boot) — so it is delegated to
// global-setup-cloud rather than re-encoded. What Class B adds is the engine's
// cold build: each suite file's CloudExecutionTarget spawns the TS runner, and
// paying `make build-runner` once here (like global-setup-execution does for
// the local engine) keeps it off the per-file hook budget and satisfies the
// runner's stale-build guard for the from-dist launch.
import cloudSetup from "./global-setup-cloud";
import { buildRunner } from "./runner-build";

export default async function setup(): Promise<() => Promise<void>> {
  const teardown = await cloudSetup();
  try {
    await buildRunner();
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}
