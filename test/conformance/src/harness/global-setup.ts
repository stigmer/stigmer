// Vitest global setup: build the server binary once before any suite runs.
// Domain: conformance harness (server lifecycle).
//
// Paying the cold Go build here keeps it off the per-file hook budget and out
// of the parallel critical path — workers reuse the deterministic binary path.
import { buildServer } from "./go-build";

export default async function setup(): Promise<void> {
  await buildServer();
}
