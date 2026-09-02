#!/usr/bin/env node
/**
 * Generate the film's music bed from the manifest's `music` block via the
 * ElevenLabs Music API (sourcing decision at the rough-cut gate,
 * 2026-09-02: generated, not licensed).
 *
 * Usage: ELEVENLABS_API_KEY=... node scripts/music.mjs [films/intro] [--yes]
 *
 * Paid API: prints the plan and requires --yes (the presenter.mjs cost-gate
 * discipline). Cached by prompt+model+length hash, so re-runs are free until
 * the manifest's music block changes.
 *
 * Writes assets/music/bed.mp3 + assets/music/manifest.json. The composition
 * detects the file and mounts the bed (IntroFilm's MusicBed); without it the
 * film renders silent under voiceover, same degrade contract as every asset.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const filmDir = resolve(root, process.argv[2]?.startsWith("--") ? "films/intro" : (process.argv[2] ?? "films/intro"));
const confirmed = process.argv.includes("--yes");
const outDir = join(root, "assets", "music");

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is required (planton secret get elevenlabs-api-key --ignore-env -o json)");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(filmDir, "manifest.json"), "utf8"));
const music = manifest.music;
if (!music?.prompt || !music?.lengthMs) {
  console.error(`no music block in ${filmDir}/manifest.json (needs { prompt, lengthMs })`);
  process.exit(1);
}
const modelId = process.env.ELEVENLABS_MUSIC_MODEL_ID ?? "music_v2";

mkdirSync(outDir, { recursive: true });
const outManifestPath = join(outDir, "manifest.json");
const prev = existsSync(outManifestPath) ? JSON.parse(readFileSync(outManifestPath, "utf8")) : {};

const hash = createHash("sha256")
  .update(`${modelId}\n${music.lengthMs}\n${music.prompt}`)
  .digest("hex")
  .slice(0, 16);
const mp3Path = join(outDir, "bed.mp3");
if (prev.hash === hash && existsSync(mp3Path)) {
  console.log(`cached    bed.mp3 (${music.lengthMs} ms)`);
  process.exit(0);
}

console.log(`will generate a ${(music.lengthMs / 1000).toFixed(0)}s instrumental bed (model ${modelId})`);
console.log(`prompt: ${music.prompt}`);
if (!confirmed) {
  console.log("pass --yes to proceed (paid API)");
  process.exit(2);
}

const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", {
  method: "POST",
  headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt: music.prompt,
    music_length_ms: music.lengthMs,
    model_id: modelId,
    force_instrumental: true,
  }),
});
if (!res.ok) {
  console.error(`FAILED: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
writeFileSync(mp3Path, Buffer.from(await res.arrayBuffer()));
writeFileSync(outManifestPath, JSON.stringify({ hash, lengthMs: music.lengthMs, modelId }, null, 2) + "\n");
console.log("generated bed.mp3 → assets/music/bed.mp3");
