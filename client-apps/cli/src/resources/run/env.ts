// A run's own values: the `--env`/`--secret` flags and `--env-file`/
// `--secret-file` files, parsed into one map the CLI sends as the new
// conversation's own secrets (SessionSpec.secrets). The server keeps them
// sealed for the conversation's life and fills each requirement of the run
// with the same name ahead of every vault; no read ever returns them.
//
// Every per-call value is a secret: a plain setting lives in the agent's or
// tool's definition, so `--env` and `--secret` differ only in what a reader
// of the command line expects, and both are sealed alike.
//
// Precedence is load-order, lowest to highest (the Go CLI's
// LoadAndMergeWithSecrets, kept):
//   env-files (in order) < secret-files (in order) < --env flags < --secret flags
// so a later source overrides an earlier one on key collision.
//
// A conversation's secret needs a value and a conversation keeps at most
// MAX_SESSION_SECRETS (SessionSpec.secrets), so an empty value (`KEY=` in a
// .env file) is left out with a notice naming the key, and more than the
// limit is refused before anything is sent.

import { readFileSync } from "node:fs";
import { UsageError } from "../../errors/index.js";

/** A run's own values: variable name -> value. */
export type SessionSecrets = Record<string, string>;

/** The most secrets a conversation keeps (SessionSpec.secrets max_pairs). */
export const MAX_SESSION_SECRETS = 100;

/** The four raw env sources collected from CLI flags, in precedence groups. */
export interface EnvSources {
  readonly envFlags: readonly string[];
  readonly secretFlags: readonly string[];
  readonly envFiles: readonly string[];
  readonly secretFiles: readonly string[];
}

/**
 * Load and merge every source into one map: files before flags, and within
 * each tier the secret source after the plain one, so the precedence is
 * env-files < secret-files < --env < --secret (later wins). Keys whose
 * merged value is empty are left out, named (never valued) through
 * `notice`; more than {@link MAX_SESSION_SECRETS} is a usage error.
 */
export function loadSessionSecrets(
  sources: EnvSources,
  notice: (line: string) => void = (line) => void process.stderr.write(`${line}\n`),
): SessionSecrets {
  const layers: SessionSecrets[] = [];
  for (const path of sources.envFiles) layers.push(parseEnvFile(path));
  for (const path of sources.secretFiles) layers.push(parseEnvFile(path));
  if (sources.envFlags.length > 0) layers.push(parseEnvFlags("--env", sources.envFlags));
  if (sources.secretFlags.length > 0) layers.push(parseEnvFlags("--secret", sources.secretFlags));
  const merged = mergeEnv(layers);

  const secrets: SessionSecrets = {};
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(merged)) {
    if (value === "") skipped.push(key);
    else secrets[key] = value;
  }
  if (skipped.length > 0) {
    notice(`Skipped ${skipped.length === 1 ? "a variable" : "variables"} with no value: ${skipped.join(", ")}`);
  }
  const count = Object.keys(secrets).length;
  if (count > MAX_SESSION_SECRETS) {
    throw new UsageError(
      `too many variables: ${count} given, a run takes at most ${MAX_SESSION_SECRETS} ` +
        "(save the rest in a vault the run uses)",
    );
  }
  return secrets;
}

// Later layers override earlier ones; mirrors Go's MergeEnvSources.
function mergeEnv(layers: readonly SessionSecrets[]): SessionSecrets {
  const result: SessionSecrets = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) result[key] = value;
  }
  return result;
}

// Parse a dotenv-style file: comments (#), blank lines, optional `export `
// prefix, and quoted values with escapes. Mirrors Go's parseFileWithSecretFlag.
function parseEnvFile(path: string): SessionSecrets {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (err) {
    throw new UsageError(`failed to open environment file ${path}: ${(err as Error).message}`);
  }

  const result: SessionSecrets = {};
  const lines = contents.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);
    if (parsed === null) continue; // comment or blank
    if (parsed instanceof Error) {
      throw new UsageError(`${path}:${i + 1}: ${parsed.message}`);
    }
    result[parsed.key] = parsed.value;
  }
  return result;
}

// Parse repeated `KEY=VALUE` flag values. Unlike file parsing, a comment/blank
// flag value is an error (the user explicitly passed it). Mirrors Go's
// parseFlagsWithSecretFlag. A refusal names the flag and at most the key,
// never the raw text: what follows the '=' (or a whole entry with no '=')
// may be the secret itself, and a usage error reaches the terminal and logs.
function parseEnvFlags(flag: "--env" | "--secret", vars: readonly string[]): SessionSecrets {
  const result: SessionSecrets = {};
  for (const raw of vars) {
    const parsed = parseLine(raw);
    if (parsed === null) {
      throw new UsageError(`invalid ${flag} value: empty or a comment, expected KEY=VALUE`);
    }
    if (parsed instanceof Error) {
      throw new UsageError(`invalid ${flag} value: ${parsed.message}`);
    }
    result[parsed.key] = parsed.value;
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
