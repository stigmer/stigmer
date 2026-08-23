// Vitest global setup for the local-ts roster: compile the TS server once
// before any suite runs (the go-build global-setup's twin).
// Domain: conformance harness (server lifecycle).
import { buildTsServer } from "./ts-build";

export default async function setup(): Promise<void> {
  await buildTsServer();
}
