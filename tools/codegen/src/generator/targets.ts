// The generator's emitting targets, dispatched by name: each one reads the
// committed JSON schemas and writes one client-facing artifact tree. A name
// this table does not hold is refused with an error the CLI prints, never
// guessed at. docs-yaml-check is not here: it reads no schemas and has its
// own flag contract (main.ts).

import { runMCPTSGeneration } from "./mcp-ts.js";
import { runSDKClientGeneration } from "./sdk-client-go.js";
import { runSDKClientJavaGeneration } from "./sdk-client-java.js";
import { runSDKClientPythonGeneration } from "./sdk-client-python.js";
import { runSDKClientTSGeneration } from "./sdk-client-ts.js";
import { runSDKDocsGeneration } from "./sdk-docs.js";

/** Where a target reads and writes. */
export interface TargetPaths {
  readonly schemaDir: string;
  readonly outputDir: string;
  readonly apisDir: string;
}

/** Runs the named target; throws for a name no target holds. */
export function runGenerationTarget(target: string, paths: TargetPaths): void {
  switch (target) {
    case "mcp-ts":
      runMCPTSGeneration(paths.schemaDir, paths.outputDir);
      return;
    case "sdk-client-ts":
      runSDKClientTSGeneration(paths.schemaDir, paths.outputDir);
      return;
    case "sdk-client-python":
      runSDKClientPythonGeneration(paths.schemaDir, paths.outputDir);
      return;
    case "sdk-client-java":
      runSDKClientJavaGeneration(paths.schemaDir, paths.outputDir);
      return;
    case "sdk-client":
      runSDKClientGeneration(paths.schemaDir, paths.outputDir);
      return;
    case "sdk-docs":
      runSDKDocsGeneration(paths.schemaDir, paths.outputDir, paths.apisDir);
      return;
    default:
      throw new Error(`Unknown --target "${target}"`);
  }
}
