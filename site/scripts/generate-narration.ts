/**
 * Thin wrapper that invokes the Scenar CLI's narrate command
 * within a tsx process, ensuring TypeScript steps files can be
 * dynamically imported.
 *
 * Usage: tsx scripts/generate-narration.ts
 */

import { run } from "@scenar/cli";

run([
  "node",
  "scenar",
  "narrate",
  "src/components/docs/demos/scenarios",
  "--out",
  "public/demos",
  "--tts",
  "edge-tts",
  "--voice",
  "en-US-AndrewMultilingualNeural",
  "--base-url",
  "/demos",
]);
