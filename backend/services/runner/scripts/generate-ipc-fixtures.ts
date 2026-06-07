// CLI shell around `serializeFixtures()`: writes the golden IPC fixture artifact and its
// vendored crate copy, or (`--check`) verifies both committed copies are fresh. The typed
// generation lives in src/ipc-protocol-fixtures.ts (type-checked + shipped); this file is
// pure IO so it stays out of the tsc build graph. Run via `npm run gen:ipc-fixtures`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { serializeFixtures } from "../src/ipc-protocol-fixtures.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const runnerDir = dirname(scriptDir);
const repoRoot = join(runnerDir, "..", "..", "..");

// The canonical artifact lives with the runner (the contract's home); the crate vendors a
// byte-identical copy so it stays self-contained for a future standalone publish.
const CANONICAL = join(runnerDir, "fixtures", "ipc-protocol.generated.json");
const CRATE_COPY = join(
  repoRoot,
  "crates",
  "stigmer-runner-host",
  "fixtures",
  "ipc-protocol.generated.json",
);

const TARGETS = [CANONICAL, CRATE_COPY];

function write(): void {
  const content = serializeFixtures();
  for (const target of TARGETS) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    console.log(`wrote ${target}`);
  }
}

function check(): void {
  const expected = serializeFixtures();
  const stale: string[] = [];
  for (const target of TARGETS) {
    let actual: string;
    try {
      actual = readFileSync(target, "utf8");
    } catch {
      stale.push(target);
      continue;
    }
    if (actual !== expected) {
      stale.push(target);
    }
  }
  if (stale.length > 0) {
    console.error(
      "error: golden IPC fixtures are stale or missing:\n" +
        stale.map((p) => `  - ${p}`).join("\n") +
        "\n\nRun 'make gen-ipc-fixtures' (or 'npm run gen:ipc-fixtures' in the runner) and commit the result.",
    );
    process.exit(1);
  }
  console.log("✓ Golden IPC fixtures are up to date");
}

if (process.argv.includes("--check")) {
  check();
} else {
  write();
}
