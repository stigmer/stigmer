// Every CLI test runs in a temporary home, however vitest runs it.
//
// The CLI keeps its config, credentials and runtime data under the home
// folder (config/paths.ts, local/paths.ts), found with `os.homedir()`. Tests
// that touch those files point HOME at a folder of their own, which works in
// vitest's default `forks` pool, where each test file is a process. In the
// `threads` pool (the one Stryker's vitest runner forces for the mutation
// sweep) a test file is a worker thread, and setting `process.env.HOME` in a
// worker does not move `os.homedir()`, which reads the process's real
// environment: on 2026-10-27 the sweep's first run of this suite wrote a
// test's fake token into the developer's own ~/.stigmer/config.yaml.
//
// So this setup file, which vitest loads before every test file, gives the
// suite a fresh home of its own and makes `os.homedir()` answer whatever HOME
// says, in every pool. A test that redirects HOME further still does so the
// way it always has.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

const home = mkdtempSync(join(tmpdir(), "stigmer-cli-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const homedir = (): string => process.env.HOME ?? actual.homedir();
  return { ...actual, homedir, default: { ...actual, homedir } };
});
