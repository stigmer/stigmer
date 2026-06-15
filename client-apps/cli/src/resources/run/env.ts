// Runtime-environment assembly for agent execution.
//
// Ports the Go CLI's `internal/cli/envfile` package (parser.go + merge.go): it
// parses `--env`/`--secret` flags and `--env-file`/`--secret-file` files into a
// single merged map of runtime values, each tagged secret or plaintext.
//
// Precedence is load-order, lowest to highest (mirrors LoadAndMergeWithSecrets):
//   env-files (in order) < secret-files (in order) < --env flags < --secret flags
// so a later source overrides an earlier one on key collision, and a secret
// source overriding a plaintext source flips the value to secret. This exact
// ordering is a wire-parity contract with the Go CLI.

import { readFileSync } from "node:fs";
import type { EnvVarInput } from "@stigmer/sdk";
import { UsageError } from "../../errors/index.js";

/** A merged runtime environment: variable name -> value + secret flag. */
export type RuntimeEnv = Record<string, EnvVarInput>;

/** The four raw env sources collected from CLI flags, in precedence groups. */
export interface EnvSources {
  readonly envFlags: readonly string[];
  readonly secretFlags: readonly string[];
  readonly envFiles: readonly string[];
  readonly secretFiles: readonly string[];
}

/**
 * Load and merge every env source into one map. Mirrors Go's
 * LoadAndMergeWithSecrets: files are processed before flags, and within each
 * tier secrets are layered after plaintext, so the precedence is
 * env-files < secret-files < --env < --secret (later wins).
 */
export function loadAndMergeEnv(sources: EnvSources): RuntimeEnv {
  const layers: RuntimeEnv[] = [];
  for (const path of sources.envFiles) layers.push(parseEnvFile(path, false));
  for (const path of sources.secretFiles) layers.push(parseEnvFile(path, true));
  if (sources.envFlags.length > 0) layers.push(parseEnvFlags(sources.envFlags, false));
  if (sources.secretFlags.length > 0) layers.push(parseEnvFlags(sources.secretFlags, true));
  return mergeEnv(layers);
}

// Later layers override earlier ones; mirrors Go's MergeEnvSources.
function mergeEnv(layers: readonly RuntimeEnv[]): RuntimeEnv {
  const result: RuntimeEnv = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) result[key] = value;
  }
  return result;
}

// Parse a dotenv-style file: comments (#), blank lines, optional `export `
// prefix, and quoted values with escapes. Every value carries the file's
// secret tag. Mirrors Go's parseFileWithSecretFlag.
function parseEnvFile(path: string, isSecret: boolean): RuntimeEnv {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (err) {
    throw new UsageError(`failed to open environment file ${path}: ${(err as Error).message}`);
  }

  const result: RuntimeEnv = {};
  const lines = contents.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);
    if (parsed === null) continue; // comment or blank
    if (parsed instanceof Error) {
      throw new UsageError(`${path}:${i + 1}: ${parsed.message}`);
    }
    result[parsed.key] = { value: parsed.value, isSecret };
  }
  return result;
}

// Parse repeated `KEY=VALUE` flag values. Unlike file parsing, a comment/blank
// flag value is an error (the user explicitly passed it). Mirrors Go's
// parseFlagsWithSecretFlag.
function parseEnvFlags(vars: readonly string[], isSecret: boolean): RuntimeEnv {
  const result: RuntimeEnv = {};
  for (const raw of vars) {
    const parsed = parseLine(raw);
    if (parsed === null) {
      throw new UsageError(`invalid environment variable "${raw}": empty or comment`);
    }
    if (parsed instanceof Error) {
      throw new UsageError(`invalid environment variable "${raw}": ${parsed.message}`);
    }
    result[parsed.key] = { value: parsed.value, isSecret };
  }
  return result;
}

interface ParsedEntry {
  readonly key: string;
  readonly value: string;
}

// Parse one `KEY=VALUE` line. Returns null for comments/blanks, an Error for a
// malformed entry, or the parsed pair. Mirrors Go's ParseLine.
function parseLine(line: string): ParsedEntry | Error | null {
  let trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;

  if (trimmed.startsWith("export ")) trimmed = trimmed.slice("export ".length);

  const eq = trimmed.indexOf("=");
  if (eq === -1) return new Error("invalid format: missing '=' separator");

  const key = trimmed.slice(0, eq).trim();
  if (key === "") return new Error("empty key");
  if (!isValidEnvKey(key)) {
    return new Error(`invalid key "${key}": must contain only letters, numbers, and underscores`);
  }

  return { key, value: parseValue(trimmed.slice(eq + 1)) };
}

// First char a letter or underscore, rest alphanumeric/underscore. Mirrors Go's
// isValidEnvKey (notably: a leading digit is rejected).
function isValidEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

// Trim, then strip matching single/double quotes and unescape. Mirrors Go's
// parseValue + unescapeValue.
function parseValue(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return unescapeValue(value.slice(1, -1));
    }
  }
  return value;
}

// Escape map for the single-pass scan below.
const ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  '"': '"',
  "'": "'",
  n: "\n",
  t: "\t",
  r: "\r",
};

// Single-pass unescape, matching Go's strings.NewReplacer semantics: each `\x`
// is consumed at most once (a chained string-replace would double-process, e.g.
// turning a literal "\\n" into a newline). An unrecognized `\x` is left verbatim.
function unescapeValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      const mapped = ESCAPES[next];
      if (mapped !== undefined) {
        out += mapped;
        i++;
        continue;
      }
    }
    out += value[i];
  }
  return out;
}
