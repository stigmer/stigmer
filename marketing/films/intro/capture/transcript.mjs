#!/usr/bin/env node
/**
 * S3e transcript capture: runs the real `stigmer apply` against the live
 * local stack and records the exact command + output as JSON. The scene-3
 * terminal shot is a styled replay of THIS transcript inside a Remotion
 * terminal component (owner decision, 2026-09-02): deterministic and
 * re-renderable, content 100% real.
 *
 * Environment: STIGMER_BIN / HOME as for seed.mjs.
 * Output: assets/recordings/s3e-apply-transcript.json
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bin = process.env.STIGMER_BIN ?? "stigmer";
const outDir = join(here, "../../../assets/recordings");

// The film shows the command a user would type from the demo directory.
const displayCommand = "stigmer apply -f traveler-assist.yaml";
const manifest = join(here, "../demo/resources/traveler-assist.yaml");

// Off camera: remove the agent first so the on-camera apply is a genuine
// CREATE (the scene is "one command — and our agent is live", not an update).
try {
  execFileSync(bin, ["--org", "meridian-travel", "delete", "agent", "traveler-assist", "--force"], { stdio: "ignore" });
} catch {
  // Fine: the agent didn't exist yet.
}

// The CLI renders its human-readable result on stderr (stdout stays
// machine-clean for piping) — the transcript wants exactly what a
// terminal shows, so merge both streams in order.
// --org matches the manifest's org so the CLI has no context to warn
// about — the transcript reads as a user working in their own org.
const output = execSync(`${JSON.stringify(bin)} --org meridian-travel apply -f ${JSON.stringify(manifest)} 2>&1`, {
  encoding: "utf8",
});

// The share pins the agent by id (slug-reuse protection); recreating the
// agent above changed that id, so re-apply the share to re-pin it.
execFileSync(bin, ["apply", "-f", join(here, "../demo/resources/traveler-assist-share.yaml")], { stdio: "ignore" });

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "s3e-apply-transcript.json"),
  JSON.stringify({ command: displayCommand, output: output.trimEnd(), capturedAt: new Date().toISOString() }, null, 2) + "\n",
);

// The S3b code panel drifts over the agent manifest. Stage a copy where
// staticFile can serve it (assets/ is the public dir, gitignored) — the
// committed YAML stays the single source; this command regenerates both
// film-data artifacts together. The leading header comment addresses the
// film's maintainers, not its audience: strip everything before
// apiVersion, keeping the in-spec section comments (they are the shot's
// callouts).
const yamlLines = readFileSync(manifest, "utf8").split("\n");
const specStart = yamlLines.findIndex((l) => l.startsWith("apiVersion:"));
writeFileSync(join(outDir, "s3b-agent-yaml.txt"), yamlLines.slice(Math.max(0, specStart)).join("\n"));

console.log("captured s3e transcript → assets/recordings/s3e-apply-transcript.json");
console.log("staged   s3b agent yaml → assets/recordings/s3b-agent-yaml.txt");
console.log(output);
