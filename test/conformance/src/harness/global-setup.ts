// Vitest global setup (Class A): compile the TS server once before any
// suite runs. Paying the cold build here keeps it off the per-file hook
// budget and out of the parallel critical path — workers reuse the stable
// dist entry path.
// Domain: conformance harness (server lifecycle).
import { buildTsServer } from "./ts-build";

export default async function setup(): Promise<void> {
  await buildTsServer();
}
