// gen-cli-docs generates MDX reference documentation for every stigmer CLI
// command by walking the commander command tree (the TypeScript analogue of the
// retired Go cmd/gen-cli-docs). Output is committed to docs/cli/commands/ and
// verified for freshness in CI via `make gen-cli-docs-check`.
//
// Each command has a hand-written enrichment template (client-apps/cli/docs/
// commands/<name>.mdx) that controls the page layout and prose. The generator
// injects auto-generated sections (usage syntax, flag tables, subcommands) at
// marked insertion points so flags stay in lockstep with the source. Commands
// without an enrichment fall back to a generated default page.
//
// Enrichment markers:
//
//   {/* AUTO_USAGE */}        — replaced with ## Usage + syntax code block
//   {/* AUTO_FLAGS */}        — replaced with ## Options + flags table
//   {/* AUTO_GLOBAL_FLAGS */} — replaced with ## Global Flags + flags table
//   {/* AUTO_SUBCOMMANDS */}  — replaced with ## Subcommands + inline docs
//
// Usage:
//
//   tsx scripts/gen-cli-docs.ts --output ../../docs/cli/commands/
//
// Run via `make gen-cli-docs`, which also formats the output with prettier.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command, Option } from "commander";
import { buildProgram } from "../src/program.js";

// ---------------------------------------------------------------------------
// Command grouping
// ---------------------------------------------------------------------------
//
// Commander (v12) has no native help-group concept, so the grouping that the Go
// CLI declared in root.go via cobra groups lives here as the single source of
// truth. groupOrder controls display order in the sidebar and index page;
// COMMAND_GROUP assigns every visible top-level command to a group. Any new
// non-hidden command MUST be added here, or generation fails loudly (see
// resolveGroup) rather than silently dropping the command from the docs.

const groupOrder = ["core", "lifecycle", "resource", "artifact", "server", "config"] as const;
type GroupId = (typeof groupOrder)[number];

const groupTitles: Record<GroupId, string> = {
  core: "Core Commands",
  lifecycle: "Lifecycle",
  resource: "Resource Management",
  artifact: "Artifact Commands",
  server: "Server Commands",
  config: "Configuration",
};

const COMMAND_GROUP: Record<string, GroupId> = {
  // Core
  run: "core",
  resume: "core",
  execution: "core",
  usage: "core",
  // Lifecycle
  up: "lifecycle",
  down: "lifecycle",
  status: "lifecycle",
  logs: "lifecycle",
  setup: "lifecycle",
  reset: "lifecycle",
  // Resource Management
  apply: "resource",
  get: "resource",
  list: "resource",
  delete: "resource",
  validate: "resource",
  diff: "resource",
  search: "resource",
  draft: "resource",
  connect: "resource",
  tag: "resource",
  // Artifact
  push: "artifact",
  download: "artifact",
  // Server
  "mcp-server": "server",
  seedpack: "server",
  // Configuration
  auth: "config",
  apikey: "config",
  config: "config",
  completion: "config",
  version: "config",
};

// sectionHeaderRe matches terminal-style UPPERCASE section headers found in
// command descriptions (e.g. "USAGE FORMS:", "ENVIRONMENT VARIABLES:").
const sectionHeaderRe = /^([A-Z][A-Z0-9]+(?: [A-Za-z0-9]+)*):\s*$/;

// angleBracketRe matches bare CLI placeholder tokens like <id>, <agent-ref>,
// <name-or-id> that MDX would otherwise parse as JSX elements.
const angleBracketRe = /<([a-zA-Z][a-zA-Z0-9_-]*)>/g;

interface FlagDoc {
  name: string;
  shorthand: string;
  type: string;
  defaultValue: string;
  usage: string;
}

// ---------------------------------------------------------------------------
// Command-tree introspection
// ---------------------------------------------------------------------------

// Commander does not expose a public `hidden` getter on Command; the internal
// `_hidden` flag is the only signal (set via .command(name, { hidden: true })).
function isHidden(cmd: Command): boolean {
  return (cmd as unknown as { _hidden?: boolean })._hidden === true;
}

// Positional arguments were renamed from `_args` to `registeredArguments` in
// commander v11+; read the public field with a typed fallback for safety.
interface RegisteredArgument {
  name(): string;
  required: boolean;
  variadic: boolean;
}

function registeredArguments(cmd: Command): RegisteredArgument[] {
  const c = cmd as unknown as { registeredArguments?: RegisteredArgument[]; _args?: RegisteredArgument[] };
  return c.registeredArguments ?? c._args ?? [];
}

function commandPath(cmd: Command): string {
  const parts: string[] = [];
  let current: Command | null = cmd;
  while (current) {
    parts.unshift(current.name());
    current = current.parent;
  }
  return parts.join(" ");
}

function shortDescription(cmd: Command): string {
  return cmd.summary() || cmd.description();
}

function resolveGroup(cmd: Command): GroupId {
  const group = COMMAND_GROUP[cmd.name()];
  if (group === undefined) {
    throw new Error(
      `command "${cmd.name()}" has no group assignment in scripts/gen-cli-docs.ts COMMAND_GROUP. ` +
        `Add it to a group (or mark the command hidden) so it is documented intentionally.`,
    );
  }
  return group;
}

function documentedCommands(program: Command): Command[] {
  return program.commands.filter((cmd) => !isHidden(cmd) && cmd.name() !== "help");
}

function visibleSubcommands(cmd: Command): Command[] {
  return cmd.commands
    .filter((sub) => !isHidden(sub) && sub.name() !== "help")
    .sort((a, b) => a.name().localeCompare(b.name()));
}

function groupCommands(program: Command): Map<GroupId, Command[]> {
  const grouped = new Map<GroupId, Command[]>();
  for (const cmd of documentedCommands(program)) {
    const group = resolveGroup(cmd);
    const bucket = grouped.get(group) ?? [];
    bucket.push(cmd);
    grouped.set(group, bucket);
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.name().localeCompare(b.name()));
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Flag collection
// ---------------------------------------------------------------------------

// The user-facing long flag name without dashes (e.g. "file", "no-web"). For a
// negated option (--no-web) commander reports `long` as "--no-web", which is the
// flag a user actually types, so we render it verbatim.
function flagLongName(option: Option): string {
  if (option.long) return option.long.replace(/^--/, "");
  if (option.short) return option.short.replace(/^-/, "");
  return option.name();
}

function flagType(option: Option): string {
  if (option.negate) return "bool";
  const takesValue = option.required || option.optional;
  if (!takesValue) return "bool";
  if (option.variadic) return "stringArray";
  return "string";
}

function flagDefault(option: Option): string {
  const value = option.defaultValue;
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "";
  if (Array.isArray(value)) return value.length > 0 ? value.join(",") : "";
  if (typeof value === "number") return value === 0 ? "" : String(value);
  const str = String(value);
  return str === "" || str === "[]" ? "" : str;
}

function isDocumentedOption(option: Option): boolean {
  if (option.hidden) return false;
  const long = option.long ?? "";
  return long !== "--help" && long !== "--version";
}

function toFlagDoc(option: Option): FlagDoc {
  return {
    name: flagLongName(option),
    shorthand: option.short ?? "",
    type: flagType(option),
    defaultValue: flagDefault(option),
    usage: option.description,
  };
}

function collectGlobalFlags(program: Command): FlagDoc[] {
  return sortFlags(program.options.filter(isDocumentedOption).map(toFlagDoc));
}

function collectLocalFlags(cmd: Command): FlagDoc[] {
  return sortFlags(cmd.options.filter(isDocumentedOption).map(toFlagDoc));
}

function sortFlags(flags: FlagDoc[]): FlagDoc[] {
  return [...flags].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Usage line
// ---------------------------------------------------------------------------

function usageLine(cmd: Command): string {
  let line = commandPath(cmd);
  for (const arg of registeredArguments(cmd)) {
    const name = arg.variadic ? `${arg.name()}...` : arg.name();
    line += arg.required ? ` <${name}>` : ` [${name}]`;
  }
  if (collectLocalFlags(cmd).length > 0) {
    line += " [flags]";
  }
  return line;
}

// ---------------------------------------------------------------------------
// Auto-generated section renderers (for enrichment marker replacement)
// ---------------------------------------------------------------------------

function renderAutoUsage(cmd: Command): string {
  return `## Usage\n\n\`\`\`bash\n${usageLine(cmd)}\n\`\`\``;
}

function renderAutoFlags(cmd: Command): string {
  const flags = collectLocalFlags(cmd);
  if (flags.length === 0) return "";
  return `## Options\n\n${flagsTable(flags)}`.trimEnd();
}

function renderAutoGlobalFlags(globalFlags: FlagDoc[]): string {
  if (globalFlags.length === 0) return "";
  return `## Global Flags\n\n${flagsTable(globalFlags)}`.trimEnd();
}

function renderAutoSubcommands(cmd: Command): string {
  const subs = visibleSubcommands(cmd);
  if (subs.length === 0) return "";
  let out = "## Subcommands\n\n";
  for (const sub of subs) {
    out += renderSubcommand(sub);
  }
  return out.trimEnd();
}

function renderSubcommand(sub: Command): string {
  let out = `### ${commandPath(sub)}\n\n`;
  const description = sub.description() || sub.summary();
  if (description !== "") {
    out += `${formatLongDescription(description)}\n\n`;
  }
  out += `\`\`\`bash\n${usageLine(sub)}\n\`\`\`\n\n`;
  const flags = collectLocalFlags(sub);
  if (flags.length > 0) {
    out += `${flagsTable(flags)}\n`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Page rendering — individual command pages
// ---------------------------------------------------------------------------

export function renderEnrichedPage(cmd: Command, globalFlags: FlagDoc[], enrichment: string): string {
  const replaced = enrichment
    .split("{/* AUTO_USAGE */}")
    .join(renderAutoUsage(cmd))
    .split("{/* AUTO_FLAGS */}")
    .join(renderAutoFlags(cmd))
    .split("{/* AUTO_GLOBAL_FLAGS */}")
    .join(renderAutoGlobalFlags(globalFlags))
    .split("{/* AUTO_SUBCOMMANDS */}")
    .join(renderAutoSubcommands(cmd));
  return frontmatter(commandPath(cmd), shortDescription(cmd)) + replaced.trim() + "\n";
}

export function renderDefaultPage(cmd: Command, globalFlags: FlagDoc[]): string {
  let out = frontmatter(commandPath(cmd), shortDescription(cmd));

  const description = cmd.description() || cmd.summary();
  if (description !== "") {
    out += `${formatLongDescription(description)}\n\n`;
  }

  out += `## Usage\n\n\`\`\`bash\n${usageLine(cmd)}\n\`\`\`\n\n`;

  const localFlags = collectLocalFlags(cmd);
  if (localFlags.length > 0) {
    out += `## Options\n\n${flagsTable(localFlags)}\n`;
  }
  if (globalFlags.length > 0) {
    out += `## Global Flags\n\n${flagsTable(globalFlags)}\n`;
  }

  const subs = visibleSubcommands(cmd);
  if (subs.length > 0) {
    out += "## Subcommands\n\n";
    for (const sub of subs) {
      out += renderSubcommand(sub);
    }
  }

  out += "## See also\n\n- [Command Reference](./) — all available commands\n";
  return out;
}

// ---------------------------------------------------------------------------
// Page rendering — commands index page
// ---------------------------------------------------------------------------

export function renderIndexPage(grouped: Map<GroupId, Command[]>, globalFlags: FlagDoc[]): string {
  let out = frontmatter("Command Reference", "Complete reference for all stigmer CLI commands.");
  out += "Complete reference for all `stigmer` CLI commands, organized by category.\n\n";

  for (const gid of groupOrder) {
    const cmds = grouped.get(gid);
    if (cmds === undefined || cmds.length === 0) continue;
    out += `## ${groupTitles[gid]}\n\n`;
    out += "| Command | Description |\n";
    out += "|---------|-------------|\n";
    for (const cmd of cmds) {
      out += `| [\`${commandPath(cmd)}\`](./${cmd.name()}) | ${escapeTable(shortDescription(cmd))} |\n`;
    }
    out += "\n";
  }

  if (globalFlags.length > 0) {
    out += "## Global Flags\n\n";
    out += "These flags are available on every command.\n\n";
    out += `${flagsTable(globalFlags)}\n`;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Section writers
// ---------------------------------------------------------------------------

function frontmatter(title: string, description: string): string {
  return (
    "---\n" +
    `title: ${escapeYAML(title)}\n` +
    `description: ${escapeYAML(description)}\n` +
    "---\n\n" +
    "{/* Auto-generated by gen-cli-docs. Do not edit manually. */}\n" +
    "{/* To enrich this page, edit the template in client-apps/cli/docs/commands/ */}\n\n"
  );
}

function flagsTable(flags: FlagDoc[]): string {
  let out = "| Flag | Type | Default | Description |\n";
  out += "|------|------|---------|-------------|\n";
  for (const flag of flags) {
    out += `| ${formatFlagName(flag)} | \`${flag.type}\` | ${formatDefault(flag)} | ${escapeTable(flag.usage)} |\n`;
  }
  return out;
}

function formatFlagName(flag: FlagDoc): string {
  let name = `\`--${flag.name}\``;
  if (flag.shorthand !== "") {
    name += `, \`${flag.shorthand}\``;
  }
  return name;
}

function formatDefault(flag: FlagDoc): string {
  if (flag.defaultValue === "") return "";
  if (flag.type === "bool" && flag.defaultValue === "false") return "";
  return `\`${flag.defaultValue}\``;
}

// ---------------------------------------------------------------------------
// Text formatting
// ---------------------------------------------------------------------------

// formatLongDescription converts terminal-formatted descriptions to web-friendly
// markdown: UPPERCASE SECTION: headers become ### headings, two-space leading
// indentation is stripped, and the result is MDX-escaped.
function formatLongDescription(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";

  const result: string[] = [];
  for (const rawLine of trimmed.split("\n")) {
    const match = sectionHeaderRe.exec(rawLine);
    if (match) {
      result.push("", `### ${toTitleCase(match[1])}`, "");
      continue;
    }
    const line = rawLine.startsWith("  ") ? rawLine.slice(2) : rawLine;
    result.push(line);
  }

  return escapeMDX(collapseBlankLines(result.join("\n").trim()));
}

function collapseBlankLines(input: string): string {
  const out: string[] = [];
  let prevBlank = false;
  for (const line of input.split("\n")) {
    const blank = line.trim() === "";
    if (blank && prevBlank) continue;
    out.push(line);
    prevBlank = blank;
  }
  return out.join("\n");
}

function toTitleCase(input: string): string {
  return input
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

function escapeYAML(value: string): string {
  if (/[:#{}[\]&*!|>'"@`]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function escapeTable(value: string): string {
  return escapeMDX(value.replace(/\|/g, "\\|"));
}

// escapeMDX makes prose safe for MDX by escaping characters the compiler would
// otherwise parse as JSX or markdown would parse as formatting. Bare
// <placeholder> tokens are wrapped in backticks; outside backtick spans, angle
// brackets and curly braces are backslash-escaped, and underscores are escaped
// so identifiers like `aex_`/`wex_` do not form accidental emphasis spans.
function escapeMDX(value: string): string {
  const wrapped = value.replace(angleBracketRe, "`<$1>`");

  let out = "";
  let inCode = false;
  for (const char of wrapped) {
    if (char === "`") {
      inCode = !inCode;
      out += "`";
    } else if (!inCode && char === "<") {
      out += "\\<";
    } else if (!inCode && char === "{") {
      out += "\\{";
    } else if (!inCode && char === "}") {
      out += "\\}";
    } else if (!inCode && char === "_") {
      out += "\\_";
    } else {
      out += char;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// meta.json (Fumadocs sidebar)
// ---------------------------------------------------------------------------

export function renderMetaJSON(grouped: Map<GroupId, Command[]>): string {
  const pages: string[] = ["index"];
  for (const gid of groupOrder) {
    const cmds = grouped.get(gid);
    if (cmds === undefined || cmds.length === 0) continue;
    pages.push(`---${groupTitles[gid]}---`);
    for (const cmd of cmds) {
      pages.push(cmd.name());
    }
  }
  return `${JSON.stringify({ title: "Commands", pages }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Generation entry point
// ---------------------------------------------------------------------------

export interface GenerateResult {
  enriched: number;
  defaulted: number;
}

export function generate(outputDir: string, enrichmentsDir: string, program: Command = buildProgram()): GenerateResult {
  mkdirSync(outputDir, { recursive: true });

  const globalFlags = collectGlobalFlags(program);
  const grouped = groupCommands(program);

  let enriched = 0;
  let defaulted = 0;
  for (const cmd of documentedCommands(program)) {
    const enrichment = readEnrichment(enrichmentsDir, cmd.name());
    const content =
      enrichment !== undefined ? renderEnrichedPage(cmd, globalFlags, enrichment) : renderDefaultPage(cmd, globalFlags);
    writeFileSync(join(outputDir, `${cmd.name()}.mdx`), content);
    if (enrichment !== undefined) enriched++;
    else defaulted++;
  }

  writeFileSync(join(outputDir, "index.mdx"), renderIndexPage(grouped, globalFlags));
  writeFileSync(join(outputDir, "meta.json"), renderMetaJSON(grouped));

  return { enriched, defaulted };
}

function readEnrichment(enrichmentsDir: string, name: string): string | undefined {
  try {
    const content = readFileSync(join(enrichmentsDir, `${name}.mdx`), "utf8");
    return content.length > 0 ? content : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv: string[]): void {
  const args = parseArgs(argv);
  if (args.output === "") {
    process.stderr.write("error: --output is required\n");
    process.exit(1);
  }
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const enrichmentsDir = args.enrichmentsDir !== "" ? resolve(args.enrichmentsDir) : resolve(scriptDir, "../docs/commands");
  const result = generate(resolve(args.output), enrichmentsDir);
  process.stdout.write(
    `generated ${result.enriched + result.defaulted} command pages ` +
      `(${result.enriched} enriched, ${result.defaulted} default) + index in ${args.output}\n`,
  );
}

function parseArgs(argv: string[]): { output: string; enrichmentsDir: string } {
  let output = "";
  let enrichmentsDir = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--output") output = argv[++i] ?? "";
    else if (argv[i] === "--enrichments-dir") enrichmentsDir = argv[++i] ?? "";
  }
  return { output, enrichmentsDir };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
