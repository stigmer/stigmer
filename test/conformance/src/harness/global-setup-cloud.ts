// Vitest global setup for the cloud target: the environment is pre-provisioned.
// Domain: conformance harness (cloud target lifecycle).
//
// The cloud targets connect to an environment somebody else booted and
// published through the CLOUD_ENV variables (cloud-env.ts) — since 2026-09-10
// that is the TypeScript composition, booted by stigmer-cloud's readout recipe
// (backend/services/stigmer-server/spike/README.md there), which also starts
// the cloud-capability fixtures (fake LLM upstream, Stripe, Discord —
// cloud-fixtures.ts, imported from this workspace) and mints the suite's
// identities. Until the Java stigmer-service retired (stigmer-cloud DD-013)
// this setup could boot that service hermetically through a Go launcher in
// test/integration; the OSS repository cannot boot the private composition,
// so the launcher half retired with the service and this setup now REFUSES to
// run without a declared environment rather than silently testing nothing.
//
// vitest runs globalSetup in the main process; workers fork afterwards and
// inherit process.env, so the contract is read from the environment as-is.
import { CLOUD_ENV } from "./cloud-env";

export default async function setup(): Promise<() => Promise<void>> {
  const missing = [CLOUD_ENV.address, CLOUD_ENV.token].filter(
    (name) => process.env[name] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `cloud conformance: no pre-provisioned environment — ${missing.join(", ")} unset. ` +
        "The cloud targets are provisioned by stigmer-cloud's readout recipe " +
        "(backend/services/stigmer-server/spike/README.md), which exports the STIGMER_CONFORMANCE_CLOUD_* contract; " +
        "this repository boots no cloud edition.",
    );
  }
  console.log(
    `cloud conformance: using pre-provisioned environment at ${process.env[CLOUD_ENV.address]}`,
  );
  return async () => {};
}
