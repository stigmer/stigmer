// `stigmer diff -f <file|dir>` — show a unified diff of local YAML vs remote
// state, per document. Auto-detects each document's kind; only workflows are
// diffable today (others render as "new"). Heavy modules are lazy-imported
// inside the action so `--help` stays fast (DD-001).

import { basename } from "node:path";
import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { shouldColorize, type Styler, styler } from "../output/index.js";
import { defaultRegistry } from "../registry/index.js";
import { globalOrg } from "./shared.js";

interface DiffFlags {
  file?: string;
  context?: string;
}

const DEFAULT_CONTEXT = 3;

export function registerDiff(program: Command): void {
  program
    .command("diff")
    .description("compare local YAML with remote resource state")
    .requiredOption("-f, --file <path>", "path to a YAML file or directory")
    .option("--context <n>", "number of context lines in diff output", String(DEFAULT_CONTEXT))
    .action((options: DiffFlags, command: Command) => runDiff(options, command));
}

async function runDiff(options: DiffFlags, command: Command): Promise<void> {
  const path = options.file;
  if (path === undefined || path === "") {
    throw new UsageError("file path is required: use -f <file>");
  }
  const contextLines = parseContext(options.context);

  const [{ connectBackend }, { loadDocuments, resolveYamlFiles }, { diffDocument }] = await Promise.all([
    import("../backend.js"),
    import("../resources/documents.js"),
    import("../resources/diff.js"),
  ]);

  const files = resolveYamlFiles(path);
  if (files.length === 0) {
    throw new UsageError(`no YAML files found in ${path}`);
  }

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const registry = defaultRegistry();
  const style = styler(shouldColorize(process.stdout));

  let hasDiffs = false;
  for (const file of files) {
    for (const { kind, document, raw } of loadDocuments(file)) {
      const info = registry.getByYamlKind(kind);
      if (info === undefined) {
        throw new UsageError(`unknown resource kind '${kind}' in ${file}`);
      }
      const result = await diffDocument(client.stigmer, info.kind, raw, document, basename(file), org, contextLines);
      if (result.status === "new") {
        process.stdout.write(`--- ${file} (new resource, not yet deployed)\n`);
        process.stdout.write(`${style.green("+ entire file is new")}\n\n`);
        hasDiffs = true;
      } else if (result.status === "changed") {
        process.stdout.write(colorizeDiff(result.text, style));
        hasDiffs = true;
      }
    }
  }

  if (!hasDiffs) {
    process.stdout.write(`${style.green("✓ No differences found")}\n`);
  }
}

function colorizeDiff(text: string, style: Styler): string {
  return `${text
    .split("\n")
    .map((line) => colorizeLine(line, style))
    .join("\n")}\n`;
}

function colorizeLine(line: string, style: Styler): string {
  if (line.startsWith("+++") || line.startsWith("---")) return style.bold(line);
  if (line.startsWith("@@")) return style.cyan(line);
  if (line.startsWith("+")) return style.green(line);
  if (line.startsWith("-")) return style.red(line);
  return line;
}

function parseContext(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_CONTEXT;
  if (!/^\d+$/.test(raw)) throw new UsageError(`invalid --context value "${raw}"`);
  return Number.parseInt(raw, 10);
}
