/**
 * Remotion Video Render Script
 *
 * Renders demo scenario compositions to H.264 MP4 files using
 * Remotion's programmatic API. Bundles the project once, discovers
 * compositions from the bundle, and renders each requested scenario
 * sequentially.
 *
 * Prerequisites:
 *   - node_modules installed (yarn install)
 *   - Narration audio in public/demos/ (run make generate-narration)
 *
 * Usage:
 *   tsx scripts/render-videos.ts                       # all scenarios
 *   tsx scripts/render-videos.ts --scenario=<id>       # single scenario
 */

import * as path from "path";
import * as fs from "fs/promises";
import { bundle } from "@remotion/bundler";
import {
  getCompositions,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import { webpackOverride } from "../video/webpack";

// ============================================================================
// Configuration
// ============================================================================

const ENTRY_POINT = path.join(process.cwd(), "video/index.ts");
const OUTPUT_DIR = path.join(process.cwd(), "dist/videos");

const CODEC = "h264" as const;
const CRF = 18;
const PIXEL_FORMAT = "yuv420p" as const;

/** Composition ID used for pipeline testing — excluded from batch renders. */
const TEST_COMPOSITION_ID = "HelloWorld";

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseScenarioFilter(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--scenario="));
  return arg?.split("=")[1] ?? null;
}

// ============================================================================
// Rendering
// ============================================================================

interface RenderResult {
  id: string;
  success: boolean;
  outputPath?: string;
  elapsedS?: number;
  error?: string;
}

async function renderScenario(
  id: string,
  serveUrl: string,
): Promise<RenderResult> {
  const startMs = performance.now();
  const outputPath = path.join(OUTPUT_DIR, `${id}.mp4`);

  try {
    const composition = await selectComposition({ serveUrl, id });

    process.stdout.write(`  ${id} `);

    let lastPct = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: CODEC,
      outputLocation: outputPath,
      crf: CRF,
      pixelFormat: PIXEL_FORMAT,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct <= lastPct) return;
        lastPct = pct;
        const filled = ".".repeat(Math.floor(pct / 5));
        const empty = " ".repeat(20 - filled.length);
        process.stdout.write(`\r  ${id} ${filled}${empty} ${pct}%`);
      },
    });

    const elapsedS = (performance.now() - startMs) / 1000;
    const relPath = path.relative(process.cwd(), outputPath);
    process.stdout.write(
      `\r  ${id} ${"."
        .repeat(20)} 100%  -> ${relPath} (${elapsedS.toFixed(1)}s)\n`,
    );

    return { id, success: true, outputPath, elapsedS };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`\r  ${id} FAILED: ${message}\n`);
    return { id, success: false, error: message };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const scenarioFilter = parseScenarioFilter();

  console.log("Remotion Video Render");
  console.log("=====================\n");

  // Bundle the Remotion project (cached on subsequent runs).
  const bundleStart = performance.now();
  process.stdout.write("Bundling...");
  const serveUrl = await bundle({
    entryPoint: ENTRY_POINT,
    webpackOverride,
  });
  const bundleElapsed = ((performance.now() - bundleStart) / 1000).toFixed(1);
  console.log(` done (${bundleElapsed}s)\n`);

  // Discover compositions from the bundle.
  const allCompositions = await getCompositions(serveUrl);
  const scenarioIds = allCompositions
    .map((c) => c.id)
    .filter((id) => id !== TEST_COMPOSITION_ID);

  // Resolve which scenarios to render.
  let targetIds: string[];
  if (scenarioFilter) {
    if (!scenarioIds.includes(scenarioFilter)) {
      console.error(`Unknown scenario: "${scenarioFilter}"\n`);
      console.error("Available scenarios:");
      for (const id of scenarioIds) {
        console.error(`  - ${id}`);
      }
      process.exit(1);
    }
    targetIds = [scenarioFilter];
  } else {
    targetIds = scenarioIds;
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  console.log(
    `Rendering ${targetIds.length} scenario${targetIds.length === 1 ? "" : "s"}:\n`,
  );

  const results: RenderResult[] = [];
  for (const id of targetIds) {
    results.push(await renderScenario(id, serveUrl));
  }

  // Summary.
  console.log("\n=====================");
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const totalElapsedS = results.reduce(
    (sum, r) => sum + (r.elapsedS ?? 0),
    0,
  );

  console.log(
    `Rendered: ${succeeded.length}/${results.length} (${formatElapsed(totalElapsedS)})`,
  );

  if (failed.length > 0) {
    console.error("\nFailed:");
    for (const r of failed) {
      console.error(`  - ${r.id}: ${r.error}`);
    }
    process.exit(1);
  }

  console.log("Done");
}

main().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
