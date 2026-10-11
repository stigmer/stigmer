#!/usr/bin/env node
/**
 * Seeds the MINIMAL Meridian world onto Stigmer Cloud — only what an
 * embed-element demo needs: the widget on the Meridian page rendering a
 * live chat shell over the public-audience guest path (cloud-only RPCs).
 *
 * Deliberately NOT the full local seed (../seed.mjs): the daily digest
 * schedule stays off cloud — a live schedule on a real backend would fire
 * (and spend) every day after the camera stops. The meridian-ops plugin
 * stays off too: its server is a local program (stdio), which runs only in
 * the desktop app or the CLI, and a conversation hosted in a cloud sandbox
 * is refused at session create when a plugin it lists has one. The share's
 * guests are hosted there, so the cloud agent carries no plugin at all; the
 * embed shot never exercises tools, so nothing on screen changes.
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

import { recordShareId } from "../share-id.mjs";

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

// 2. The rebooking policy the agent pins.
stigmer("--org", ORG, "push", "skill", join(here, "../skills/rebooking-policy"), "--tag", "stable", "-m", "Initial rebooking policy");

// 3. The agent — the manifest the film's scene 3 walks, rendered without
// the meridian-ops plugin (see the header): the `plugins` block goes, and so
// does the fare-search sub-agent's tool list, which names only that
// plugin's search tool. Rendering from the one manifest keeps the cloud
// agent's instructions and skills identical to the film's; a manifest edit
// that moves either block fails here rather than seeding a plugin cloud
// would refuse.
const rendered = mkdtempSync(join(tmpdir(), "meridian-seed-cloud-"));
try {
  const renderedPath = join(rendered, "traveler-assist.yaml");
  writeFileSync(renderedPath, withoutPlugin(readFileSync(join(resources, "traveler-assist.yaml"), "utf8")));
  stigmer("apply", "-f", renderedPath);
} finally {
  rmSync(rendered, { recursive: true, force: true });
}

// 4. The public-audience share (the guest path the embed rides).
stigmer("apply", "-f", join(here, "traveler-assist-share.yaml"));
// The embed names the share by its id; record the cloud share's id for the
// embed page (../share-id.mjs).
recordShareId(bin, ORG, "traveler-assist");

console.log("\nMeridian cloud world seeded (S4d minimal set).");
console.log("Embed page: APP_ORIGIN=https://app.stigmer.ai npm run demo:embed");
console.log("Capture:    S4D_PAGE_URL=http://localhost:4173 npm run capture -- s4d-embed");

/**
 * The agent manifest with the meridian-ops plugin removed: the `plugins:`
 * block with the comment lines directly above it, and every sub-agent
 * `tools:` list that names only that plugin's tools. Each removal must match
 * exactly once, so the render cannot silently keep the plugin.
 */
function withoutPlugin(manifest) {
  const removals = [
    ["plugins block", /\n(?: {2}#.*\n)* {2}plugins:\n(?: {4,}.*\n)+/g],
    ["fare-search tools", /^ {6}tools: \[mcp__plugin_meridian-ops_[^\]]*\]\n/gm],
  ];
  let out = manifest;
  for (const [what, pattern] of removals) {
    const found = out.match(pattern)?.length ?? 0;
    if (found !== 1) throw new Error(`traveler-assist.yaml: expected one ${what}, found ${found}`);
    out = out.replace(pattern, "");
  }
  return out;
}
