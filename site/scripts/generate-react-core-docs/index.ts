/**
 * React core reference docs generator.
 *
 * Reads TypeDoc JSON from @stigmer/react-core (`npm run typedoc:json` in
 * sdk/react-core) and writes one Fumadocs MDX reference page and its
 * meta.json under docs/sdk/react-core/ (generate.ts).
 *
 * Usage: tsx scripts/generate-react-core-docs/index.ts
 * Runs as part of: make gen-react-core-docs
 */

import * as path from "node:path";
import { generate } from "./generate";

/* v8 ignore start -- @preserve: the entry's wiring; generate() is the unit under test, and make gen-react-core-docs-check runs this */
const API_JSON_PATH = path.resolve(process.cwd(), "..", "sdk", "react-core", "dist", "api.json");
const OUTPUT_DIR = process.env.REACT_CORE_DOCS_OUTPUT_DIR ?? path.resolve(process.cwd(), "..", "docs", "sdk", "react-core");

generate(API_JSON_PATH, OUTPUT_DIR).then(
  (count) => console.log(`[react-core-docs] ${count} exports → ${OUTPUT_DIR}`),
  (err: unknown) => {
    console.error(`[react-core-docs] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
/* v8 ignore stop */
