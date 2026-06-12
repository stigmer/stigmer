// `stigmer validate -f <file|dir>` — offline validation of resource YAML.
//
// Auto-detects each document's kind, checks it supports validation, and parses
// it into its proto schema (structural validation, no server). Supports single
// files, directories, and multi-document YAML.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { Command } from "commander";
import { parseAllDocuments } from "yaml";
import { UsageError } from "../errors/index.js";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { defaultRegistry, Verb } from "../registry/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface ValidateFlags extends OutputFlags {
  file?: string;
}

export function registerValidate(program: Command): void {
  const validate = program
    .command("validate")
    .description("validate resource YAML files offline")
    .requiredOption("-f, --file <path>", "path to a YAML file or directory")
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

  const files = resolveFiles(path);
  if (files.length === 0) {
    throw new UsageError(`no YAML files found in ${path}`);
  }

  const { schemaForValidate, validateDocument } = await import("../resources/validate.js");
  const registry = defaultRegistry();
  const validated: string[] = [];

  for (const file of files) {
    for (const { kind, document } of parseDocuments(file)) {
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

interface DetectedDocument {
  readonly kind: string;
  readonly document: import("@bufbuild/protobuf").JsonValue;
}

function parseDocuments(file: string): DetectedDocument[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${file}: ${(err as Error).message}`);
  }

  const documents: DetectedDocument[] = [];
  for (const doc of parseAllDocuments(text)) {
    const value = doc.toJS() as unknown;
    if (value === null || value === undefined) continue;
    if (typeof value !== "object") {
      throw new UsageError(`invalid YAML document in ${file}`);
    }
    const kind = (value as Record<string, unknown>).kind;
    if (typeof kind !== "string" || kind === "") {
      throw new UsageError(`missing 'kind' field in ${file}`);
    }
    documents.push({ kind, document: value as import("@bufbuild/protobuf").JsonValue });
  }
  return documents;
}

function resolveFiles(path: string): string[] {
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

function isYaml(file: string): boolean {
  const ext = extname(file).toLowerCase();
  return ext === ".yaml" || ext === ".yml";
}
