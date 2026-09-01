#!/usr/bin/env node
/**
 * Seeds the Meridian Travel demo world onto a local Stigmer stack — the
 * film's "everything on screen is real" promise made reproducible: run
 * this against any fresh `stigmer up` and the console matches the film.
 *
 * Idempotent: every step is an apply/push, safe to re-run.
 *
 * Environment:
 *   STIGMER_BIN   stigmer CLI to use          (default: stigmer on PATH)
 *   HOME          the stack's home, if isolated (passed through to the CLI)
 *
 * Usage: npm run demo:seed
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bin = process.env.STIGMER_BIN ?? "stigmer";
const ORG = "meridian-travel";

const stigmer = (...args) => {
  console.log(`\n$ stigmer ${args.join(" ")}`);
  execFileSync(bin, args, { stdio: "inherit" });
};

// 1. The organization.
stigmer("apply", "-f", join(here, "resources/organization.yaml"));

// 2. The MCP server — the committed manifest carries a placeholder for
// this checkout's absolute path (a local stdio server runs from wherever
// the repo lives); render it and apply the rendered copy.
const rendered = mkdtempSync(join(tmpdir(), "meridian-seed-"));
try {
  const manifest = readFileSync(join(here, "resources/meridian-ops.yaml"), "utf8").replaceAll(
    "__MERIDIAN_DEMO_DIR__",
    here,
  );
  const renderedPath = join(rendered, "meridian-ops.yaml");
  writeFileSync(renderedPath, manifest);
  stigmer("apply", "-f", renderedPath);
} finally {
  rmSync(rendered, { recursive: true, force: true });
}

// 3. The rebooking policy — pushed as a versioned skill and published
// under the "stable" tag the agent pins.
stigmer("--org", ORG, "push", "skill", join(here, "skills/rebooking-policy"), "--tag", "stable", "-m", "Initial rebooking policy");

// 4. The agent (traveler-assist + fare-search sub-agent).
stigmer("apply", "-f", join(here, "resources/traveler-assist.yaml"));

// 5. The workflow and its daily schedule.
stigmer("apply", "-f", join(here, "resources/disruption-digest.yaml"));
stigmer("apply", "-f", join(here, "resources/disruption-digest-schedule.yaml"));

// 6. The hosted-chat share (share link + embed origins for the Meridian page).
stigmer("apply", "-f", join(here, "resources/traveler-assist-share.yaml"));

console.log("\nMeridian Travel demo world seeded.");
console.log("Console:    http://localhost:7234");
console.log("Share link: http://localhost:7234/chat/meridian-travel/traveler-assist");
console.log("Embed page: npm run demo:embed  →  http://localhost:4173");
