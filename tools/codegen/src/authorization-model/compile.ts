// Compiles the modular authorization model (an `fga.mod` and the `.fga`
// files it lists) into OpenFGA's JSON with OpenFGA's own parser, the one
// the console and the VS Code extension use, so the JSON the server
// evaluates and the engine tests is the JSON OpenFGA itself would build.
//
// The parser validates as it transforms: an undefined relation, a bad
// userset, a tupleset that is not direct, a syntax error, a duplicate
// module, all throw with their file and zero-based line. Each one is
// reported here as `<file>:<line>:<column>: <message>`, one per line, so a
// model author reads the error at its source. There is no separate
// validation pass to forget.
//
// The compiler also refuses a `.fga` file under the model directory that
// `fga.mod` does not list: the parser only reads the listed files, so an
// unlisted type would otherwise be left out of the model without a word.
//
// The parser's result is typed `any` under `skipLibCheck`; it is returned
// as `unknown` and only canonical.ts reads it.

import * as fs from "node:fs";
import * as path from "node:path";

import { errors, transformer } from "@openfga/syntax-transformer";

/** A model that does not compile, with every problem the parser reported. */
export class ModelCompileError extends Error {
  readonly problems: ReadonlyArray<string>;

  constructor(problems: ReadonlyArray<string>) {
    super(`the authorization model does not compile:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    this.name = "ModelCompileError";
    this.problems = problems;
  }
}

/**
 * Compiles a model given its `fga.mod` text and a reader for the files it
 * lists (paths relative to the model directory, as `fga.mod` spells them).
 * Returns the parser's model, unvalidated beyond what the parser proves.
 */
export function compileModules(modFile: string, readModule: (name: string) => string): unknown {
  const mod = parse(() => transformer.transformModFileToJSON(modFile), "fga.mod");
  const files = mod.contents.value.map((entry) => ({
    name: entry.value,
    contents: readModule(entry.value),
  }));
  return parse(
    () => transformer.transformModuleFilesToModel(files, mod.schema.value),
    undefined,
  );
}

/** Compiles the model under `modelDir` from disk, refusing a `.fga` file `fga.mod` does not list. */
export function compileModelDir(modelDir: string): unknown {
  const modFile = fs.readFileSync(path.join(modelDir, "fga.mod"), "utf8");
  const read: string[] = [];
  const model = compileModules(modFile, (name) => {
    read.push(name);
    return fs.readFileSync(path.join(modelDir, name), "utf8");
  });
  const listed = new Set(read);
  const unlisted = fgaFilesUnder(modelDir).filter((file) => !listed.has(file));
  if (unlisted.length > 0) {
    throw new ModelCompileError(
      unlisted.map((file) => `${file}: not listed in fga.mod, so the parser would leave it out`),
    );
  }
  return model;
}

/** Runs one parser step, turning its structured errors into located problem lines. */
function parse<T>(step: () => T, fallbackFile: string | undefined): T {
  try {
    return step();
  } catch (error) {
    if (
      error instanceof errors.FGAModFileValidationError ||
      error instanceof errors.ModuleTransformationError
    ) {
      throw new ModelCompileError(error.errors.map((single) => located(single, fallbackFile)));
    }
    throw error;
  }
}

/**
 * One parser error as `<file>:<line>:<column>: <message>`, one-based. The
 * parser is not uniform about where it puts them: a validation error
 * carries its file in `properties` and its position on the error, and a
 * syntax error has its file set on the error itself (0.2.2's
 * modules-to-model), so both places are read.
 */
function located(single: errors.BaseError, fallbackFile: string | undefined): string {
  const ownFile = "file" in single && typeof single.file === "string" ? single.file : undefined;
  const file = single.properties.file ?? ownFile ?? fallbackFile ?? "fga.mod";
  const line = (single.line ?? single.properties.line)?.start;
  const column = (single.column ?? single.properties.column)?.start;
  const where =
    line === undefined ? file : `${file}:${line + 1}${column === undefined ? "" : `:${column + 1}`}`;
  return `${where}: ${single.properties.msg}`;
}

/** Every `.fga` file under `root`, relative to it, in lexical order. */
function fgaFilesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.name.endsWith(".fga")) {
        out.push(path.relative(root, child).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return out;
}
