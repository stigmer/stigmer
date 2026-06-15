// Shared YAML document loading for the file-based verbs (validate, diff, apply).
//
// One loader, two strictness modes (the S-strict decision):
//   - lenient (default) — tolerates malformed YAML the same way Wave-1 validate
//     did; `toJS()` best-effort, no error surfacing.
//   - strict — rejects any document with YAML parse errors. Used by `apply`,
//     where silently applying a half-parsed document would be dangerous.
//
// Each loaded document carries its parsed JSON value (for kind detection and
// schema work) and its raw text (for `diff`, which compares the user's authored
// bytes against the rendered remote state).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { JsonValue } from "@bufbuild/protobuf";
import { parseAllDocuments } from "yaml";
import { UsageError } from "../errors/index.js";

export interface LoadedDocument {
  readonly kind: string;
  readonly document: JsonValue;
  /** Raw YAML text of this document (whole file when single-document). */
  readonly raw: string;
}

export interface LoadOptions {
  /** Reject documents with YAML parse errors (apply); off mirrors Wave-1 validate. */
  readonly strict?: boolean;
}

/** Expand a path into the YAML files it covers (single file, or dir walk). */
export function resolveYamlFiles(path: string): string[] {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (err) {
    // A path the user typed that doesn't exist is a bad argument, not an
    // unexpected I/O failure — surface it as a usage error.
    throw new UsageError(`cannot access ${path}: ${(err as Error).message}`);
  }
  if (!stat.isDirectory()) return [path];

  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (isYaml(full)) {
        files.push(full);
      }
    }
  };
  walk(path);
  return files;
}

/** Parse a file's YAML documents, detecting each document's `kind`. */
export function loadDocuments(file: string, options: LoadOptions = {}): LoadedDocument[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${file}: ${(err as Error).message}`);
  }

  const docs = parseAllDocuments(text);
  const singleDocument = docs.length === 1;
  const results: LoadedDocument[] = [];

  for (const doc of docs) {
    if (options.strict === true && doc.errors.length > 0) {
      throw new UsageError(`invalid YAML in ${file}: ${doc.errors[0].message}`);
    }
    const value = doc.toJS() as unknown;
    if (value === null || value === undefined) continue;
    if (typeof value !== "object") {
      throw new UsageError(`invalid YAML document in ${file}`);
    }
    const kind = (value as Record<string, unknown>).kind;
    if (typeof kind !== "string" || kind === "") {
      throw new UsageError(`missing 'kind' field in ${file}`);
    }
    results.push({ kind, document: value as JsonValue, raw: rawText(text, doc, singleDocument) });
  }
  return results;
}

// The `yaml` Document exposes a [valueStart, valueEnd, nodeEnd] range into the
// source. For multi-document files we slice per document; a single document is
// just the whole file (matching Go's RawContent for the common case).
function rawText(source: string, doc: { range?: readonly [number, number, number] | null }, single: boolean): string {
  if (single) return source;
  const range = doc.range;
  if (range === undefined || range === null) return source;
  return source.slice(range[0], range[2]);
}

function isYaml(file: string): boolean {
  const ext = extname(file).toLowerCase();
  return ext === ".yaml" || ext === ".yml";
}
