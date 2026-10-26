/**
 * The child entry `engine-fetch.test.ts` spawns twice at once: one separate
 * process installing the Claude engine into a shared root, as a desktop app
 * and a `stigmer up` on one machine would, then loading it.
 *
 * Input: argv[2] the engines root, argv[3] the pin as JSON, argv[4] the
 * platform package. Output: one JSON line, `{ downloaded, marker }` (whether
 * this process downloaded, and the marker the loaded engine exports), exit 0;
 * or `{ error }` and exit 1.
 */

import { pathToFileURL } from "node:url";

import { installClaudeEngine } from "../activities/execute-claude/engine-fetch.js";
import { findClaudeEngine, type ClaudeEnginePin } from "../activities/execute-claude/engine-home.js";

const [root, pinJson, platformPackage] = process.argv.slice(2) as [string, string, string];
const pin = JSON.parse(pinJson) as ClaudeEnginePin;

try {
  const { downloaded } = await installClaudeEngine({ root, pin, platformPackage, signal: new AbortController().signal, lockPollMs: 50 });
  const search = findClaudeEngine({ pin, root, resolveFromRunner: () => null });
  if (search.kind !== "found") throw new Error(`no engine after the install: ${search.skipped.join("; ")}`);
  const sdk = (await import(pathToFileURL(search.engine.entry).href)) as { marker: string };
  console.log(JSON.stringify({ downloaded, marker: sdk.marker }));
} catch (err) {
  console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
}
