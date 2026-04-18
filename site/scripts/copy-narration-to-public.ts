/**
 * Copy co-located narration audio from scenario source directories
 * to public/demos/ for Next.js static serving.
 *
 * Source of truth: scenarios/<id>/narration/
 * Serving target:  public/demos/<id>/
 *
 * Usage: tsx scripts/copy-narration-to-public.ts
 */

import * as fs from "fs/promises";
import * as path from "path";

const SCENARIOS_DIR = path.resolve("src/components/docs/demos/scenarios");
const PUBLIC_DEMOS_DIR = path.resolve("public/demos");

async function main(): Promise<void> {
  const entries = await fs.readdir(SCENARIOS_DIR, { withFileTypes: true });
  let copied = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const narrationDir = path.join(SCENARIOS_DIR, entry.name, "narration");
    try {
      await fs.access(narrationDir);
    } catch {
      skipped++;
      continue;
    }

    const targetDir = path.join(PUBLIC_DEMOS_DIR, entry.name);
    await fs.mkdir(targetDir, { recursive: true });

    const files = await fs.readdir(narrationDir);
    for (const file of files) {
      await fs.copyFile(
        path.join(narrationDir, file),
        path.join(targetDir, file),
      );
    }

    copied++;
  }

  console.log(`Copied narration for ${copied} scenario(s), skipped ${skipped}`);
}

main().catch((err) => {
  console.error("Failed to copy narration:", err);
  process.exit(1);
});
