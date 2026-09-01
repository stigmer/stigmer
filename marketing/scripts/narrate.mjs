#!/usr/bin/env node
/**
 * Generate per-scene narration for a film from its manifest.json.
 *
 * Usage: ELEVENLABS_API_KEY=... node scripts/narrate.mjs [films/intro]
 *
 * Writes assets/narration/<scene-id>.mp3 plus assets/narration/manifest.json
 * (scene id → { durationMs, textHash }). Uses the with-timestamps endpoint so
 * durations are millisecond-exact (the same choice the Scenar pipeline proved).
 * Clips are cached by text+voice hash: editing one scene's narration in the
 * manifest regenerates only that scene.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const filmDir = resolve(root, process.argv[2] ?? "films/intro");
const outDir = join(root, "assets", "narration");

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is required (planton secret get elevenlabs-api-key --ignore-env -o json)");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(filmDir, "manifest.json"), "utf8"));
const modelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2";

mkdirSync(outDir, { recursive: true });
const outManifestPath = join(outDir, "manifest.json");
const prev = existsSync(outManifestPath) ? JSON.parse(readFileSync(outManifestPath, "utf8")) : {};

/** Duration from the with-timestamps alignment: end of the last character. */
const durationFromAlignment = (alignment) => {
  const ends = alignment.character_end_times_seconds;
  return Math.round(ends[ends.length - 1] * 1000);
};

const next = {};
let generated = 0;
for (const scene of manifest.scenes) {
  const textHash = createHash("sha256")
    .update(`${manifest.voiceId}\n${modelId}\n${scene.narration}`)
    .digest("hex")
    .slice(0, 16);
  const mp3Path = join(outDir, `${scene.id}.mp3`);
  if (prev[scene.id]?.textHash === textHash && existsSync(mp3Path)) {
    next[scene.id] = prev[scene.id];
    console.log(`cached    ${scene.id} (${prev[scene.id].durationMs} ms)`);
    continue;
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${manifest.voiceId}/with-timestamps`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text: scene.narration, model_id: modelId }),
    }
  );
  if (!res.ok) {
    console.error(`FAILED ${scene.id}: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const body = await res.json();
  writeFileSync(mp3Path, Buffer.from(body.audio_base64, "base64"));
  next[scene.id] = { durationMs: durationFromAlignment(body.alignment), textHash };
  generated += 1;
  console.log(`generated ${scene.id} (${next[scene.id].durationMs} ms)`);
}

writeFileSync(outManifestPath, JSON.stringify(next, null, 2) + "\n");
console.log(`done: ${generated} generated, ${manifest.scenes.length - generated} cached`);
