/**
 * Video Export Script for Stigmer Demo Scenarios
 *
 * Records each demo scenario at 1920x1080 via Playwright, composites
 * narration audio via FFmpeg, and outputs MP4 files ready for
 * LinkedIn and YouTube.
 *
 * Requires:
 *   - A static build in out/ (run `make build` first)
 *   - Narration audio in out/demos/ (run `make generate-narration` before build)
 *   - ffmpeg on PATH
 *   - Playwright Chromium (npx playwright install chromium)
 *
 * Usage:
 *   tsx scripts/export-videos.ts                       # all scenarios
 *   tsx scripts/export-videos.ts --scenario=<id>       # single scenario
 */

import { execSync, spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { chromium } from "playwright";

// ============================================================================
// Configuration
// ============================================================================

const OUT_DIR = path.join(process.cwd(), "out");
const EXPORT_ROUTE_DIR = path.join(OUT_DIR, "demos", "export");
const OUTPUT_DIR = path.join(process.cwd(), "dist", "videos");

const VIEWPORT = { width: 960, height: 480 };
const DEVICE_SCALE_FACTOR = 2;
const VIDEO_SIZE = { width: 1920, height: 960 };

/** Seconds to dwell on the final step before ending the recording. */
const FINAL_FRAME_DWELL_S = 3;

/** Extra buffer beyond computed scenario duration for the Playwright wait. */
const TIMEOUT_BUFFER_MS = 15_000;

// ============================================================================
// Types
// ============================================================================

interface ManifestEntry {
  src: string;
  durationMs: number;
}

interface Manifest {
  steps: (ManifestEntry | null)[];
}

interface TimelineEntry {
  step: number;
  timestamp: number;
}

interface ScenarioResult {
  scenario: string;
  success: boolean;
  videoPath?: string;
  error?: string;
}

// ============================================================================
// Prerequisites
// ============================================================================

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
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

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function checkPrerequisites(): Promise<void> {
  if (!(await directoryExists(OUT_DIR))) {
    console.error(
      `Error: ${OUT_DIR} does not exist.\n` +
        "Run 'make generate-narration && make build' first.",
    );
    process.exit(1);
  }

  if (!(await directoryExists(EXPORT_ROUTE_DIR))) {
    console.error(
      `Error: ${EXPORT_ROUTE_DIR} does not exist.\n` +
        "The export route pages were not built. Run 'make build'.",
    );
    process.exit(1);
  }

  if (!commandExists("ffmpeg")) {
    console.error(
      "Error: ffmpeg is not installed or not on PATH.\n" +
        "Install with: brew install ffmpeg",
    );
    process.exit(1);
  }
}

// ============================================================================
// Scenario Discovery
// ============================================================================

async function discoverScenarios(): Promise<string[]> {
  const entries = await fs.readdir(EXPORT_ROUTE_DIR, { withFileTypes: true });
  // Next.js static export produces either subdirectories (with
  // trailingSlash) or .html files (without). Handle both.
  const scenarios: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      scenarios.push(entry.name);
    } else if (entry.name.endsWith(".html")) {
      scenarios.push(entry.name.replace(/\.html$/, ""));
    }
  }
  return scenarios.sort();
}

// ============================================================================
// Static File Server
// ============================================================================

interface Server {
  process: ChildProcess;
  port: number;
  url: string;
}

async function startServer(): Promise<Server> {
  const port = 3_456 + Math.floor(Math.random() * 1_000);
  const url = `http://localhost:${port}`;

  const child = spawn("npx", ["serve", OUT_DIR, "-l", String(port)], {
    stdio: "pipe",
    detached: false,
  });

  child.stderr?.on("data", () => {});
  child.stdout?.on("data", () => {});

  // Poll until the server responds.
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return { process: child, port, url };
    } catch {
      // Not ready yet.
    }
    await sleep(500);
  }

  child.kill();
  throw new Error(`Server did not start on port ${port} within 15 seconds`);
}

function stopServer(server: Server): void {
  server.process.kill("SIGTERM");
}

// ============================================================================
// Manifest & Timeline Helpers
// ============================================================================

async function loadManifest(scenario: string): Promise<Manifest | null> {
  const manifestPath = path.join(OUT_DIR, "demos", scenario, "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

/**
 * Compute a generous timeout for Playwright to wait for playback to
 * complete. Sums step delays using the unmuted formula (matching what
 * ScenarioPlayer does in video export mode) plus generous buffers.
 */
function computeTimeout(manifest: Manifest | null): number {
  if (!manifest) return 60_000;

  let totalMs = 0;
  for (const entry of manifest.steps) {
    totalMs += entry?.durationMs ?? 2_000;
  }

  return totalMs + FINAL_FRAME_DWELL_S * 1_000 + TIMEOUT_BUFFER_MS;
}

// ============================================================================
// FFmpeg
// ============================================================================

function getVideoDuration(videoPath: string): number {
  const output = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
    { encoding: "utf-8" },
  );
  return parseFloat(output.trim());
}

interface AudioClip {
  filePath: string;
  offsetMs: number;
}

function buildFfmpegArgs(
  videoPath: string,
  clips: AudioClip[],
  videoDurationS: number,
  outputPath: string,
): string[] {
  if (clips.length === 0) {
    // No audio — just transcode video to MP4.
    return [
      "-i", videoPath,
      "-c:v", "libx264", "-preset", "slow", "-crf", "18",
      "-an",
      "-movflags", "+faststart",
      "-y", outputPath,
    ];
  }

  const args: string[] = [
    "-i", videoPath,
    "-f", "lavfi", "-t", String(videoDurationS),
    "-i", `anullsrc=r=44100:cl=stereo`,
  ];

  for (const clip of clips) {
    args.push("-i", clip.filePath);
  }

  // Build filter_complex: adelay each clip, then amix everything.
  const filterParts: string[] = [];
  const mixInputs: string[] = ["[1:a]"];

  for (let i = 0; i < clips.length; i++) {
    const inputIdx = i + 2; // 0=video, 1=silence, 2..N=clips
    const label = `a${i}`;
    const ms = Math.round(clips[i].offsetMs);
    filterParts.push(`[${inputIdx}:a]adelay=${ms}|${ms}[${label}]`);
    mixInputs.push(`[${label}]`);
  }

  const mixCount = mixInputs.length;
  filterParts.push(
    `${mixInputs.join("")}amix=inputs=${mixCount}:duration=first:normalize=0[aout]`,
  );

  args.push("-filter_complex", filterParts.join(";"));
  args.push(
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "-y", outputPath,
  );

  return args;
}

function runFfmpeg(args: string[]): void {
  const cmd = `ffmpeg ${args.map((a) => `"${a}"`).join(" ")}`;
  execSync(cmd, { stdio: "pipe" });
}

// ============================================================================
// Per-Scenario Recording
// ============================================================================

async function recordScenario(
  scenario: string,
  serverUrl: string,
): Promise<ScenarioResult> {
  const manifest = await loadManifest(scenario);
  const timeout = computeTimeout(manifest);

  const tmpDir = path.join(process.cwd(), ".video-tmp", scenario);
  await fs.mkdir(tmpDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    colorScheme: "dark",
    recordVideo: { dir: tmpDir, size: VIDEO_SIZE },
  });

  const page = await context.newPage();
  const video = page.video()!;

  try {
    const pageUrl = `${serverUrl}/demos/export/${scenario}`;
    await page.goto(pageUrl, { waitUntil: "networkidle" });

    // Wait for the scenario to finish playing.
    await page.waitForSelector("[data-playback-complete='true']", {
      timeout,
    });

    // Dwell on the final frame so the viewer can absorb the result.
    await sleep(FINAL_FRAME_DWELL_S * 1_000);

    // Read the measured timeline before closing the page.
    const timeline = await page.evaluate(
      () =>
        (
          (window as unknown as Record<string, unknown>)
            .__exportTimeline as TimelineEntry[] | undefined
        ) ?? [],
    );

    await context.close();
    await browser.close();

    const webmPath = await video.path();

    // ----------------------------------------------------------------
    // FFmpeg: composite audio onto the video
    // ----------------------------------------------------------------

    const outputPath = path.join(OUTPUT_DIR, `${scenario}.mp4`);
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const videoDurationS = getVideoDuration(webmPath);

    const clips: AudioClip[] = [];
    if (manifest) {
      for (let i = 0; i < manifest.steps.length; i++) {
        const entry = manifest.steps[i];
        if (!entry) continue;

        const timelineEntry = timeline.find((t) => t.step === i);
        if (!timelineEntry) continue;

        const audioFile = path.join(
          OUT_DIR,
          "demos",
          scenario,
          `step-${i}.mp3`,
        );
        try {
          await fs.access(audioFile);
          clips.push({ filePath: audioFile, offsetMs: timelineEntry.timestamp });
        } catch {
          console.warn(
            `    Warning: audio file missing for step ${i}, skipping`,
          );
        }
      }
    }

    console.log(
      `    Compositing: ${clips.length} audio clip(s), ` +
        `video ${videoDurationS.toFixed(1)}s`,
    );

    const ffmpegArgs = buildFfmpegArgs(
      webmPath,
      clips,
      videoDurationS,
      outputPath,
    );
    runFfmpeg(ffmpegArgs);

    return { scenario, success: true, videoPath: outputPath };
  } catch (error) {
    // Ensure cleanup even on failure.
    try {
      await context.close();
    } catch { /* ignore */ }
    try {
      await browser.close();
    } catch { /* ignore */ }
    const message = error instanceof Error ? error.message : String(error);
    return { scenario, success: false, error: message };
  }
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(): { scenario?: string } {
  const scenarioArg = process.argv.find((a) => a.startsWith("--scenario="));
  return { scenario: scenarioArg?.split("=")[1] };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("Video Export Pipeline");
  console.log("=====================");

  await checkPrerequisites();

  const { scenario: singleScenario } = parseArgs();

  let scenarios: string[];
  if (singleScenario) {
    const hasDir = await directoryExists(path.join(EXPORT_ROUTE_DIR, singleScenario));
    const hasHtml = await fileExists(path.join(EXPORT_ROUTE_DIR, `${singleScenario}.html`));
    if (!hasDir && !hasHtml) {
      console.error(`Error: scenario "${singleScenario}" not found in build.`);
      process.exit(1);
    }
    scenarios = [singleScenario];
  } else {
    scenarios = await discoverScenarios();
  }

  console.log(`\nScenarios to export: ${scenarios.length}\n`);

  const server = await startServer();
  console.log(`Server running at ${server.url}\n`);

  const results: ScenarioResult[] = [];

  try {
    for (const scenario of scenarios) {
      console.log(`  ${scenario}`);
      const result = await recordScenario(scenario, server.url);
      results.push(result);

      if (result.success) {
        console.log(`    -> ${result.videoPath}`);
      } else {
        console.error(`    FAILED: ${result.error}`);
      }
      console.log();
    }
  } finally {
    stopServer(server);
  }

  // Cleanup temp directory.
  try {
    await fs.rm(path.join(process.cwd(), ".video-tmp"), { recursive: true });
  } catch { /* ignore */ }

  // Summary.
  console.log("=====================");
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`Exported: ${succeeded.length}/${results.length}`);

  if (failed.length > 0) {
    console.error(`\nFailed scenarios:`);
    for (const r of failed) {
      console.error(`  - ${r.scenario}: ${r.error}`);
    }
    process.exit(1);
  }

  console.log("Done");
}

main().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
