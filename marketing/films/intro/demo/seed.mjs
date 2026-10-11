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
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { recordShareId } from "./share-id.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = process.env.STIGMER_BIN ?? "stigmer";
const ORG = "meridian-travel";

const stigmer = (...args) => {
  console.log(`\n$ stigmer ${args.join(" ")}`);
  execFileSync(bin, args, { stdio: "inherit" });
};

// 1. The organization.
stigmer("apply", "-f", join(here, "resources/organization.yaml"));

// 2. The meridian-ops plugin — one stdio MCP server (mcp/meridian-ops.mjs)
// in Claude Code's plugin layout (plugins/meridian-ops/). A plugin server
// cannot name a working directory, so the committed .mcp.json passes the
// script's absolute path as its argument, behind a placeholder for this
// checkout's location. The script must run from the demo directory, not
// from a copy inside the plugin archive: it imports the MCP SDK from
// marketing/node_modules. Render the placeholder into a temp copy and push
// that; pushing unchanged content again reports "unchanged", so re-runs are
// no-ops.
//
// Rebooking moves real money, so it always stops for a human: the server
// marks rebook_booking destructive (MCP annotation destructiveHint: true),
// and Stigmer asks before any tool so marked.
const rendered = mkdtempSync(join(tmpdir(), "meridian-seed-"));
try {
  const plugin = join(rendered, "meridian-ops");
  cpSync(join(here, "plugins/meridian-ops"), plugin, { recursive: true });
  const mcpConfig = join(plugin, ".mcp.json");
  writeFileSync(mcpConfig, readFileSync(mcpConfig, "utf8").replaceAll("__MERIDIAN_DEMO_DIR__", here));
  stigmer("--org", ORG, "push", "plugin", plugin, "-m", "Meridian operations tools");
} finally {
  rmSync(rendered, { recursive: true, force: true });
}

// 3. The rebooking policy — pushed as a versioned skill and published
// under the "stable" tag the agent pins.
stigmer("--org", ORG, "push", "skill", join(here, "skills/rebooking-policy"), "--tag", "stable", "-m", "Initial rebooking policy");

// 4. The agent (traveler-assist + fare-search sub-agent).
stigmer("apply", "-f", join(here, "resources/traveler-assist.yaml"));

// 5. The daily digest schedule.
stigmer("apply", "-f", join(here, "resources/disruption-digest-schedule.yaml"));

// 6. The hosted-chat share (share link + embed origins for the Meridian page).
stigmer("apply", "-f", join(here, "resources/traveler-assist-share.yaml"));
// A share link names the share by its id; record it for the embed page
// and the capture script (share-id.mjs).
const shareId = recordShareId(bin, ORG, "traveler-assist");

console.log("\nMeridian Travel demo world seeded.");
console.log("Console:    http://localhost:7234");
console.log(`Share link: http://localhost:7234/chat/${shareId}`);
console.log("Embed page: npm run demo:embed  →  http://localhost:4173");
