// `stigmer validate -f <file|dir>` — offline validation of resource YAML, or
// of a plugin directory.
//
// Two inputs, one verb. A YAML file or a directory of YAML files is parsed
// document by document into its proto schema (structural validation, no
// server). A directory holding a plugin manifest (`plugin.json`,
// `.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json` or
// `.codex-plugin/plugin.json`) is read with `@stigmer/plugin-package`, the
// same reader the server installs with, so what validates here installs
// there and what is refused here is refused there with the same sentence.
// The plugin check runs BEFORE the YAML walk: a plugin's `ai.stigmer/*.yaml`
// documents would otherwise be validated as loose resources.
//
// A plugin refusal is a `UsageError` (exit 2) listing every problem at once;
// an accepted plugin renders as `success`, or `warning` when the reader had
// something to say, both exit 0. `--json` carries the normalised package as
// the result's `data`.

import type { PluginDialect } from "@stigmer/plugin-package";
import type { Command } from "commander";
import { UsageError } from "../errors/index.js";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { defaultRegistry, Verb } from "../registry/index.js";
import { loadDocuments, resolveYamlFiles } from "../resources/documents.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface ValidateFlags extends OutputFlags {
  file?: string;
}

export function registerValidate(program: Command): void {
  const validate = program
    .command("validate")
    .description("validate resource YAML files or a plugin directory offline")
    .requiredOption("-f, --file <path>", "path to a YAML file, a directory of YAML files, or a plugin directory")
    .action(async (options: ValidateFlags) => {
      renderResult(await runValidate(options), resultFormat(options));
    });
  addResultFlags(validate);
}

async function runValidate(options: ValidateFlags): Promise<CommandResult> {
  const path = options.file;
  if (path === undefined || path === "") {
    throw new UsageError("file path is required: use -f <file>");
  }

  const { isPluginDirectory } = await import("../resources/plugin.js");
  if (isPluginDirectory(path)) {
    return runValidatePlugin(path);
  }

  const files = resolveYamlFiles(path);
  if (files.length === 0) {
    throw new UsageError(`no YAML files found in ${path}`);
  }

  const { schemaForValidate, validateDocument } = await import("../resources/validate.js");
  const registry = defaultRegistry();
  const validated: string[] = [];

  for (const file of files) {
    // Validate stays lenient (default) — strict parsing is reserved for apply.
    for (const { kind, document } of loadDocuments(file)) {
      const info = registry.getByYamlKind(kind);
      if (info === undefined) {
        throw new UsageError(`unknown resource kind '${kind}' in ${file}`);
      }
      if (!info.supportedVerbs.has(Verb.Validate)) {
        throw new UsageError(`${info.displayName} does not support validation (in ${file})`);
      }
      const schema = schemaForValidate(info.kind);
      if (schema === undefined) {
        // The kind declares validate support but the CLI lacks a schema binding
        // — a CLI gap, not bad user input, so this is a general (exit 1) error.
        throw new Error(`validation is not implemented for ${info.displayName}`);
      }
      try {
        validateDocument(schema, document);
      } catch (err) {
        throw new UsageError(`${file}: invalid ${info.displayName}: ${(err as Error).message}`);
      }
      validated.push(`${file}: ${info.displayName} is valid`);
    }
  }

  const result = CommandResult.success(`Validation complete: ${validated.length} resource(s) valid`);
  const section = result.addSection("");
  for (const item of validated) section.item(item);
  return result;
}

async function runValidatePlugin(dir: string): Promise<CommandResult> {
  const { readPluginPackage } = await import("@stigmer/plugin-package");
  const { describePlugin, readPluginDirectory } = await import("../resources/plugin.js");

  const directory = readPluginDirectory(dir);
  const outcome = readPluginPackage(directory.files);

  if (!outcome.ok) {
    // Warnings ride along under the refusal so the author fixes everything
    // in one pass, not the errors now and the warnings on the next run.
    const lines = [
      `${dir}: plugin cannot be installed, ${count(outcome.errors.length, "problem")} found:`,
      ...outcome.errors.map((finding) => `  - ${finding.message}`),
    ];
    if (outcome.warnings.length > 0) {
      lines.push(`and ${count(outcome.warnings.length, "warning")}:`, ...outcome.warnings.map((finding) => `  - ${finding.message}`));
    }
    throw new UsageError(lines.join("\n"));
  }

  const { plugin, warnings } = outcome;
  const result =
    warnings.length === 0
      ? CommandResult.success(`Plugin '${plugin.name}' is valid`)
      : CommandResult.warning(`Plugin '${plugin.name}' is valid with ${count(warnings.length, "warning")}`);

  const about = result.addSection("Plugin");
  about.field("Name", plugin.name);
  if (plugin.version !== undefined) about.field("Version", plugin.version);
  about.field("Format", DIALECT_LABELS[plugin.dialect]);
  about.field("Manifests", plugin.manifestsFound.join(", "));
  about.field("Files", `${directory.stats.filesIncluded} read, ${directory.stats.filesIgnored} excluded by ignore rules`);

  const contents = result.addSection("Installs");
  contents.field("Skills", named(plugin.skills.map((s) => s.name)));
  contents.field("MCP servers", named(plugin.mcpServers.map((s) => `${s.name} (${s.transport})`)));
  contents.field("Sub-agents", named(plugin.subAgents.map((a) => a.name)));
  contents.field(
    "Variables",
    named(plugin.variables.map((v) => `${v.name}${v.optional ? " (optional)" : ""}${v.declaredBy === "inferred" ? " (inferred)" : ""}`)),
  );
  const overlay = [
    ...(plugin.overlay.agent !== undefined ? ["agent"] : []),
    ...plugin.overlay.workflows.map((w) => `workflow ${w.name}`),
    ...plugin.overlay.mcpServers.map((s) => `server overlay ${s.server}`),
  ];
  if (overlay.length > 0) contents.field("Stigmer overlay", overlay.join(", "));

  if (warnings.length > 0) {
    const section = result.addSection("Warnings");
    for (const warning of warnings) section.item(warning.message);
  }
  if (plugin.ignored.length > 0) {
    const section = result.addSection("Not installed");
    for (const component of plugin.ignored) section.item(`${component.kind} (${component.path})`);
  }

  return result.withData(describePlugin(plugin, warnings, directory.stats));
}

// The type import is erased at compile time, so the library itself still
// loads lazily inside the plugin route and `--help` never pays for it.
const DIALECT_LABELS: Readonly<Record<PluginDialect, string>> = {
  "agent-plugins": "Agent Plugins 1.0",
  claude: "Claude Code plugin",
  cursor: "Cursor plugin",
  codex: "Codex plugin",
};

function named(items: readonly string[]): string {
  return items.length === 0 ? "none" : `${items.length}: ${items.join(", ")}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
