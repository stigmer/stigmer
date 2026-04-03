/**
 * Narration Audio Generation Script for Stigmer Demo Scenarios
 *
 * Reads `narration` text from scenario step definitions, generates
 * MP3 audio clips via Microsoft Edge TTS, and writes per-scenario
 * manifests consumed by ScenarioPlayer at runtime.
 *
 * Hash-based caching ensures the script only calls TTS when narration
 * text actually changes. Re-running is fast and idempotent.
 *
 * Usage: tsx scripts/generate-narration.ts
 */

import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { pathToFileURL } from "url";
import { EdgeTTS } from "edge-tts-universal";

// ============================================================================
// Configuration
// ============================================================================

const SCENARIOS_DIR = path.join(
  process.cwd(),
  "src/components/docs/demos/scenarios",
);
const OUTPUT_DIR = path.join(process.cwd(), "public/demos");
const VOICE = "en-US-AndrewMultilingualNeural";

// ============================================================================
// Types
//
// Manifest shape mirrors engine/narration.ts (NarrationManifest /
// NarrationEntry). Defined locally so the build script has no import-time
// dependency on the React engine — the JSON it writes is the contract.
// ============================================================================

interface ManifestEntry {
  src: string;
  durationMs: number;
}

interface Manifest {
  steps: (ManifestEntry | null)[];
}

interface CacheEntry {
  hash: string;
  durationMs: number;
}

interface Cache {
  voice: string;
  steps: (CacheEntry | null)[];
}

// Minimal shape we need from each imported step object.
interface ImportedStep {
  delayMs: number;
  narration?: string;
}

// ============================================================================
// Scenario Discovery
// ============================================================================

async function discoverScenarios(): Promise<string[]> {
  const entries = await fs.readdir(SCENARIOS_DIR, { withFileTypes: true });
  const scenarios: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await fs.access(path.join(SCENARIOS_DIR, entry.name, "steps.ts"));
      scenarios.push(entry.name);
    } catch {
      // No steps.ts — static detail view, not a playback scenario.
    }
  }

  return scenarios.sort();
}

/**
 * Dynamically import a scenario's steps.ts and locate the exported
 * steps array. Uses duck-typing (array of objects with `delayMs`) so
 * it works regardless of the export name each scenario uses.
 */
async function loadSteps(scenario: string): Promise<ImportedStep[]> {
  const stepsPath = path.join(SCENARIOS_DIR, scenario, "steps.ts");
  const mod = await import(pathToFileURL(stepsPath).href);

  // tsx CJS interop nests named exports under `default`.
  const exports = mod.default ?? mod;

  for (const value of Object.values(exports)) {
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object" &&
      value[0] !== null &&
      "delayMs" in value[0]
    ) {
      return value as ImportedStep[];
    }
  }

  throw new Error(`No steps array found in ${scenario}/steps.ts`);
}

// ============================================================================
// Hashing & Caching
// ============================================================================

function computeHash(narration: string, voice: string): string {
  return crypto
    .createHash("sha256")
    .update(`${voice}\0${narration}`)
    .digest("hex");
}

async function loadCache(scenarioDir: string): Promise<Cache | null> {
  try {
    const raw = await fs.readFile(
      path.join(scenarioDir, ".narration-cache.json"),
      "utf-8",
    );
    return JSON.parse(raw) as Cache;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// TTS Synthesis
// ============================================================================

interface SynthesisResult {
  audio: Buffer;
  durationMs: number;
}

/**
 * Synthesize narration text to MP3 via Edge TTS.
 *
 * Duration is computed from word-boundary metadata returned by the
 * service. Falls back to a bitrate-based estimate if metadata is
 * unavailable (Edge TTS outputs 48 kbps mono MP3).
 */
async function synthesize(
  narration: string,
  voice: string,
): Promise<SynthesisResult> {
  const tts = new EdgeTTS(narration, voice);
  const result = await tts.synthesize();

  const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

  let durationMs = 0;
  if (result.subtitle.length > 0) {
    const last = result.subtitle[result.subtitle.length - 1];
    // offset and duration are in 100-nanosecond units.
    durationMs = Math.ceil((last.offset + last.duration) / 10_000);
  }

  if (durationMs === 0 && audioBuffer.length > 0) {
    durationMs = Math.ceil((audioBuffer.length * 8) / 48);
  }

  return { audio: audioBuffer, durationMs };
}

// ============================================================================
// Per-Scenario Processing
// ============================================================================

interface ScenarioStats {
  generated: number;
  cached: number;
  skipped: number;
}

async function processScenario(
  scenario: string,
): Promise<ScenarioStats | null> {
  const steps = await loadSteps(scenario);
  const hasNarration = steps.some((s) => s.narration);

  if (!hasNarration) return null;

  const scenarioDir = path.join(OUTPUT_DIR, scenario);
  await fs.mkdir(scenarioDir, { recursive: true });

  const existingCache = await loadCache(scenarioDir);
  const stats: ScenarioStats = { generated: 0, cached: 0, skipped: 0 };

  const newCacheSteps: (CacheEntry | null)[] = Array.from(
    { length: steps.length },
    () => null,
  );
  const manifestSteps: (ManifestEntry | null)[] = Array.from(
    { length: steps.length },
    () => null,
  );

  for (let i = 0; i < steps.length; i++) {
    const { narration } = steps[i];
    if (!narration) {
      stats.skipped++;
      continue;
    }

    const hash = computeHash(narration, VOICE);
    const mp3Path = path.join(scenarioDir, `step-${i}.mp3`);
    const srcUrl = `/demos/${scenario}/step-${i}.mp3`;

    const cachedEntry = existingCache?.steps[i] ?? null;
    if (
      cachedEntry &&
      cachedEntry.hash === hash &&
      existingCache?.voice === VOICE &&
      (await fileExists(mp3Path))
    ) {
      newCacheSteps[i] = cachedEntry;
      manifestSteps[i] = { src: srcUrl, durationMs: cachedEntry.durationMs };
      stats.cached++;
      console.log(`    step ${i}: cached`);
      continue;
    }

    console.log(`    step ${i}: generating...`);
    const { audio, durationMs } = await synthesize(narration, VOICE);
    await fs.writeFile(mp3Path, audio);

    newCacheSteps[i] = { hash, durationMs };
    manifestSteps[i] = { src: srcUrl, durationMs };
    stats.generated++;
    console.log(`    step ${i}: ${durationMs}ms (${audio.length} bytes)`);
  }

  const manifest: Manifest = { steps: manifestSteps };
  await fs.writeFile(
    path.join(scenarioDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  const cache: Cache = { voice: VOICE, steps: newCacheSteps };
  await fs.writeFile(
    path.join(scenarioDir, ".narration-cache.json"),
    JSON.stringify(cache, null, 2) + "\n",
  );

  return stats;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("🎙️  Stigmer Narration Generation");
  console.log("=================================");
  console.log(`Voice: ${VOICE}\n`);

  const scenarios = await discoverScenarios();
  console.log(`Discovered ${scenarios.length} scenarios with steps\n`);

  let totalGenerated = 0;
  let totalCached = 0;
  let totalSkipped = 0;
  let scenariosWithNarration = 0;
  const errors: { scenario: string; error: unknown }[] = [];

  for (const scenario of scenarios) {
    console.log(`  ${scenario}`);
    try {
      const stats = await processScenario(scenario);
      if (!stats) {
        console.log("    (no narration)");
        continue;
      }
      scenariosWithNarration++;
      totalGenerated += stats.generated;
      totalCached += stats.cached;
      totalSkipped += stats.skipped;
    } catch (error) {
      console.error(`    ❌ failed: ${error}`);
      errors.push({ scenario, error });
    }
  }

  console.log("\n=================================");
  console.log(`Scenarios with narration: ${scenariosWithNarration}`);
  console.log(`Audio files generated:    ${totalGenerated}`);
  console.log(`Audio files cached:       ${totalCached}`);
  console.log(`Steps without narration:  ${totalSkipped}`);

  if (errors.length > 0) {
    console.error(`\n❌ ${errors.length} scenario(s) failed:`);
    for (const { scenario, error } of errors) {
      console.error(`  - ${scenario}: ${error}`);
    }
    process.exit(1);
  }

  console.log("✅ Done");
}

main().catch((error) => {
  console.error("\n❌ Error generating narration:", error);
  process.exit(1);
});
