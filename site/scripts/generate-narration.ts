/**
 * Thin wrapper that invokes the Scenar CLI's narrate command
 * within a tsx process, ensuring TypeScript steps files can be
 * dynamically imported.
 *
 * Narration audio is co-located with scenarios:
 *   scenarios/<id>/narration/manifest.json + step-N.mp3
 *
 * A separate build step copies narration/ folders to public/demos/
 * for Next.js static serving (see copy-narration-to-public.ts).
 *
 * Usage: tsx scripts/generate-narration.ts
 */

import { run } from "@scenar/cli";

run([
  "node",
  "scenar",
  "narrate",
  "src/components/docs/demos/scenarios",
  "--tts",
  "edge-tts",
  "--voice",
  "en-US-AndrewMultilingualNeural",
  "--base-url",
  "/demos",
]);
