// gen-authorization-model CLI: compiles the authorization model's `.fga`
// source into the OpenFGA JSON the server evaluates, the engine suites
// test and every edition applies (compile.ts, canonical.ts say how).
//
// Usage:
//
//	main.ts --model-dir DIR --out FILE           write FILE in canonical form
//	main.ts --model-dir DIR --out FILE --check   exit 1 when FILE differs
//
// The check compiles in memory and compares with the committed bytes, so
// it needs no scratch output and no `git diff`: a hand edit of the JSON, a
// `.fga` edit without regeneration, and a missing file all fail it. The
// Makefile's gen-authorization-model and gen-authorization-model-check are
// the entry points; CI runs the check.

import * as fs from "node:fs";
import * as process from "node:process";

import { formatCanonical } from "./canonical.js";
import { ModelCompileError, compileModelDir } from "./compile.js";

interface Args {
  readonly modelDir: string;
  readonly out: string;
  readonly check: boolean;
}

function usage(): never {
  process.stderr.write("usage: gen-authorization-model --model-dir DIR --out FILE [--check]\n");
  process.exit(2);
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  let modelDir: string | undefined;
  let out: string | undefined;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") {
      check = true;
    } else if (arg === "--model-dir") {
      modelDir = argv[++i];
    } else if (arg === "--out") {
      out = argv[++i];
    } else {
      usage();
    }
  }
  if (modelDir === undefined || out === undefined) usage();
  return { modelDir, out, check };
}

function main(argv: ReadonlyArray<string>): void {
  const args = parseArgs(argv);
  let rendered: string;
  try {
    rendered = formatCanonical(compileModelDir(args.modelDir));
  } catch (error) {
    if (error instanceof ModelCompileError) {
      process.stderr.write(`error: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  if (args.check) {
    const committed = fs.existsSync(args.out) ? fs.readFileSync(args.out, "utf8") : undefined;
    if (committed !== rendered) {
      process.stderr.write(
        `error: ${args.out} is ${committed === undefined ? "missing" : "stale"} — run 'make gen-authorization-model'\n`,
      );
      process.exit(1);
    }
    process.stdout.write("✓ Authorization model JSON is up to date\n");
    return;
  }
  fs.writeFileSync(args.out, rendered);
  process.stdout.write(`✓ Wrote ${args.out}\n`);
}

main(process.argv.slice(2));
