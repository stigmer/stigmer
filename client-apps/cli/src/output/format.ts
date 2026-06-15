// Unified output-format resolution.
//
// The Go CLI grew three inconsistent output conventions (D-CLI-2): reads used
// `-o table|json|yaml`, mutations used `--json`/`--quiet`, and streaming used
// `--json` for NDJSON. The TS CLI unifies the *surface* on a single
// `-o/--output` flag with one universal vocabulary — table | json | yaml |
// ndjson — and keeps `--json`/`--quiet` as back-compat aliases.
//
// The *meaning* of each universal value adapts to the command's class so a
// single mental model ("json = machine-readable") works everywhere:
//
//   universal | read   | mutating | streaming
//   ----------|--------|----------|----------
//   table     | table  | human    | inline
//   json      | json   | json     | ndjson
//   yaml      | yaml   | —        | —
//   ndjson    | —      | —        | ndjson
//   --json    | json   | json     | ndjson
//   --quiet   | —      | quiet    | —

import { UsageError } from "../errors/usage-error.js";

/** Internal format the renderers consume, after class-aware resolution. */
export type OutputFormat = "table" | "json" | "yaml" | "human" | "quiet" | "ndjson" | "inline";

/** Output behavior class a command belongs to. */
export type CommandClass = "read" | "mutating" | "streaming";

/** Raw output-selection flags as parsed from the command line. */
export interface OutputFlags {
  readonly output?: string;
  readonly json?: boolean;
  readonly quiet?: boolean;
}

const UNIVERSAL_FORMATS = ["table", "json", "yaml", "ndjson"] as const;
type UniversalFormat = (typeof UNIVERSAL_FORMATS)[number];

// Maps the universal vocabulary onto each class's internal renderer format.
// A missing entry means that universal value is not supported by the class.
const CLASS_FORMAT_MAP: Record<CommandClass, Partial<Record<UniversalFormat, OutputFormat>>> = {
  read: { table: "table", json: "json", yaml: "yaml" },
  mutating: { table: "human", json: "json" },
  streaming: { table: "inline", json: "ndjson", ndjson: "ndjson" },
};

const DEFAULT_FORMAT: Record<CommandClass, OutputFormat> = {
  read: "table",
  mutating: "human",
  streaming: "inline",
};

/**
 * Resolve the explicit/alias output flags into a single renderer format,
 * honoring the command class's defaults and supported values. Throws a
 * UsageError (exit code 2) on conflicting or unsupported selections.
 */
export function resolveFormat(flags: OutputFlags, commandClass: CommandClass): OutputFormat {
  if (flags.json === true && flags.quiet === true) {
    throw new UsageError("--json and --quiet cannot be used together");
  }

  if (flags.output !== undefined && flags.output !== "") {
    return resolveExplicit(flags.output, commandClass);
  }

  if (flags.quiet === true) {
    return "quiet";
  }

  if (flags.json === true) {
    return CLASS_FORMAT_MAP[commandClass].json ?? "json";
  }

  return DEFAULT_FORMAT[commandClass];
}

function resolveExplicit(raw: string, commandClass: CommandClass): OutputFormat {
  const value = raw.toLowerCase();
  if (!isUniversalFormat(value)) {
    throw new UsageError(
      `invalid --output value "${raw}" (expected one of: ${UNIVERSAL_FORMATS.join(", ")})`,
    );
  }
  const mapped = CLASS_FORMAT_MAP[commandClass][value];
  if (mapped === undefined) {
    throw new UsageError(
      `--output ${value} is not supported by this command (supported: ${supportedFormats(commandClass).join(", ")})`,
    );
  }
  return mapped;
}

/** The universal output values a given command class supports, for help/errors. */
export function supportedFormats(commandClass: CommandClass): UniversalFormat[] {
  return UNIVERSAL_FORMATS.filter((value) => CLASS_FORMAT_MAP[commandClass][value] !== undefined);
}

function isUniversalFormat(value: string): value is UniversalFormat {
  return (UNIVERSAL_FORMATS as readonly string[]).includes(value);
}
