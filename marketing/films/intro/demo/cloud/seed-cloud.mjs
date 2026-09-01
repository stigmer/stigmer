#!/usr/bin/env node
/**
 * Seeds the MINIMAL Meridian world onto Stigmer Cloud — only what the
 * S4d embed shot needs: the widget on the Meridian page rendering a live
 * chat shell over the public-audience guest path (cloud-only RPCs; the
 * shot's owner ruling in stigmer-cloud project 20260902.01).
 *
 * Deliberately NOT the full local seed (../seed.mjs): the workflow and
 * its daily schedule stay off cloud — a live schedule on a real backend
 * would fire (and spend) every day after the camera stops.
 *
 * Idempotent: every step is an apply/push, safe to re-run.
 *
 * Preconditions: `stigmer auth login` done and the CLI backend set to
 * cloud (this script refuses to run otherwise, so it can never
 * half-seed a local stack).
 *
 * Usage: npm run demo:seed:cloud
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const resources = join(here, "../resources");
const bin = process.env.STIGMER_BIN ?? "stigmer";
const ORG = "meridian-travel";

const stigmer = (...args) => {
  console.log(`\n$ stigmer ${args.join(" ")}`);
  execFileSync(bin, args, { stdio: "inherit" });
};

// Refuse to run against anything but cloud — the whole point of this
// script is that it targets a real backend on purpose, never by accident.
const backend = execFileSync(bin, ["config", "get", "current_backend"]).toString().trim();
if (!backend.includes("cloud")) {
  console.error(`current_backend is "${backend}" — run \`stigmer auth login\` first; this script only seeds Stigmer Cloud.`);
  process.exit(1);
}

// 1. The organization.
stigmer("apply", "-f", join(resources, "organization.yaml"));

// 2. The MCP server. The stdio command is local-machine data (nothing on
// cloud spawns it — the S4d shot never exercises tools), but the agent's
// mcp_server_usages reference must resolve, and an identical manifest
// keeps the cloud org honest. Render the path placeholder like ../seed.mjs.
const rendered = mkdtempSync(join(tmpdir(), "meridian-seed-cloud-"));
try {
  const manifest = readFileSync(join(resources, "meridian-ops.yaml"), "utf8").replaceAll(
    "__MERIDIAN_DEMO_DIR__",
    dirname(resources),
  );
  const renderedPath = join(rendered, "meridian-ops.yaml");
  writeFileSync(renderedPath, manifest);
  stigmer("apply", "-f", renderedPath);
} finally {
  rmSync(rendered, { recursive: true, force: true });
}

// 3. The rebooking policy the agent pins.
stigmer("--org", ORG, "push", "skill", join(here, "../skills/rebooking-policy"), "--tag", "stable", "-m", "Initial rebooking policy");

// 4. The agent — the same manifest the film's scene 3 walks.
stigmer("apply", "-f", join(resources, "traveler-assist.yaml"));

// 5. The public-audience share (the guest path the embed rides).
stigmer("apply", "-f", join(here, "traveler-assist-share.yaml"));

console.log("\nMeridian cloud world seeded (S4d minimal set).");
console.log("Embed page: APP_ORIGIN=https://app.stigmer.ai npm run demo:embed");
console.log("Capture:    S4D_PAGE_URL=http://localhost:4173 npm run capture -- s4d-embed");
