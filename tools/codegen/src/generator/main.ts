// generator emits client-facing artifacts from the committed JSON schemas
// (tools/codegen/schemas, extracted from the protos by the
// protoc-gen-stigmer-schema buf plugin).
//
// One CLI, dispatched by --target, mirroring the Go generator's flag
// contract exactly (Makefiles swap from `go run` to this entry target by
// target as each port reaches byte parity). Targets not yet ported fail
// loudly rather than guessing.

import * as process from "node:process";

import { runDocsYamlCheck } from "./docs-yaml-gate.js";
import { parseDocsYamlRuleMode } from "./docs-yaml-rules.js";
import { runMCPTSGeneration } from "./mcp-ts.js";
import { runSDKClientTSGeneration } from "./sdk-client-ts.js";
import { runSDKDocsGeneration } from "./sdk-docs.js";
import { runTaskDocsGeneration } from "./task-docs.js";
import { runTaskRegistryGeneration } from "./task-registry.js";

interface Flags {
  schemaDir: string;
  outputDir: string;
  target: string;
  metaDir: string;
  apisDir: string;
  docsDir: string;
  rules: string;
  authoringDirs: string;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    schemaDir: "tools/codegen/schemas",
    outputDir: "",
    target: "",
    metaDir: "",
    apisDir: "",
    docsDir: "",
    rules: "off",
    authoringDirs: "",
  };
  const setters: Record<string, (v: string) => void> = {
    "schema-dir": (v) => (flags.schemaDir = v),
    "output-dir": (v) => (flags.outputDir = v),
    target: (v) => (flags.target = v),
    "meta-dir": (v) => (flags.metaDir = v),
    "apis-dir": (v) => (flags.apisDir = v),
    "docs-dir": (v) => (flags.docsDir = v),
    rules: (v) => (flags.rules = v),
    "authoring-dirs": (v) => (flags.authoringDirs = v),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf("=");
    let name: string;
    let value: string;
    if (eq !== -1) {
      name = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else {
      name = arg.slice(2);
      value = argv[++i] ?? "";
    }
    const setter = setters[name];
    if (setter === undefined) {
      throw new Error(`unknown flag: --${name}`);
    }
    setter(value);
  }
  return flags;
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));

  // docs-yaml-check is a pass/fail validator over the docs tree: it reads
  // no schemas and emits no files, so it has its own flag contract.
  if (flags.target === "docs-yaml-check") {
    if (flags.docsDir === "") {
      process.stderr.write("--docs-dir is required for --target=docs-yaml-check\n");
      process.exit(1);
    }
    const ruleMode = parseDocsYamlRuleMode(flags.rules);
    const extraDirs = flags.authoringDirs
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d !== "");
    runDocsYamlCheck(flags.docsDir, extraDirs, ruleMode);
    return;
  }

  if (flags.schemaDir === "" || flags.outputDir === "" || flags.target === "") {
    process.stderr.write("Usage: generator --schema-dir <dir> --output-dir <dir> --target <target>\n");
    process.exit(1);
  }

  switch (flags.target) {
    case "task-registry":
      if (flags.metaDir === "") {
        process.stderr.write("--meta-dir is required for --target=task-registry\n");
        process.exit(1);
      }
      runTaskRegistryGeneration(flags.schemaDir, flags.outputDir, flags.metaDir);
      break;
    case "mcp-ts":
      runMCPTSGeneration(flags.schemaDir, flags.outputDir);
      break;
    case "sdk-client-ts":
      runSDKClientTSGeneration(flags.schemaDir, flags.outputDir);
      break;
    case "sdk-docs":
      runSDKDocsGeneration(flags.schemaDir, flags.outputDir, flags.apisDir);
      break;
    case "task-docs":
      if (flags.metaDir === "") {
        process.stderr.write("--meta-dir is required for --target=task-docs\n");
        process.exit(1);
      }
      if (flags.apisDir === "") {
        process.stderr.write("--apis-dir is required for --target=task-docs (index enrichment template)\n");
        process.exit(1);
      }
      runTaskDocsGeneration(flags.schemaDir, flags.outputDir, flags.metaDir, flags.apisDir);
      break;
    default:
      process.stderr.write(
        `Unknown or not-yet-ported --target "${flags.target}" — remaining targets run via the Go generator until their port lands\n`,
      );
      process.exit(1);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
