// stubscrub CLI — removes @internal comment sections from protoc-generated
// stubs (scrub logic and rationale live in ./scrub.ts; marker semantics in
// ../internalcomment).
//
// It runs inside the stub generation paths (apis/scripts/gen-stubs.sh on
// the pre-swap temp tree, and sdk/go's codegen-stubs target), so committed
// stubs and release-built stubs are scrubbed identically. Release CI
// regenerates stubs from scratch, which is why the strip must live here and
// not as a one-off cleanup.
//
// Usage:
//
//	stubscrub DIR...          scrub .go/.ts/.py files under each DIR in place
//	stubscrub -check DIR...   exit 1 listing files that still carry markers
//
// Exit codes and message shapes match the retired Go implementation so
// callers (Makefiles, gen-stubs.sh, CI logs) see no difference.

import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";

import { MARKER } from "../internalcomment/internalcomment.js";
import { scrubberFor } from "./scrub.js";

function usage(): never {
  process.stderr.write("usage: stubscrub [-check] DIR...\n");
  process.exit(2);
}

function main(argv: string[]): void {
  let check = false;
  const roots: string[] = [];
  for (const arg of argv) {
    if (arg === "-check" || arg === "--check") {
      check = true;
    } else {
      roots.push(arg);
    }
  }
  if (roots.length === 0) usage();

  const dirty: string[] = [];
  let scrubbedFiles = 0;

  for (const root of roots) {
    try {
      for (const filePath of walkFiles(root)) {
        const scrub = scrubberFor(filePath);
        if (scrub === null) continue;
        const data = fs.readFileSync(filePath, "utf8");
        if (!data.includes(MARKER)) continue;
        const [out, changed] = scrub(data);
        if (!changed) continue;
        if (check) {
          dirty.push(filePath);
          continue;
        }
        fs.writeFileSync(filePath, out);
        scrubbedFiles++;
      }
    } catch (err) {
      process.stderr.write(`stubscrub: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  }

  if (check) {
    if (dirty.length > 0) {
      process.stderr.write(
        `stubscrub: ${dirty.length} file(s) carry @internal comment sections — regenerate stubs (make protos):\n`,
      );
      for (const f of dirty) {
        process.stderr.write(`  ${f}\n`);
      }
      process.exit(1);
    }
    process.stdout.write("stubscrub: no @internal comment sections found\n");
    return;
  }
  process.stdout.write(`stubscrub: scrubbed ${scrubbedFiles} file(s)\n`);
}

// Depth-first walk yielding file paths in lexical order per directory —
// the traversal order Go's filepath.WalkDir guarantees, which fixes the
// order of the -check failure listing. Node's readdir order is
// filesystem-dependent, so the sort is load-bearing.
function* walkFiles(root: string): Generator<string> {
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    yield root;
    return;
  }
  const entries = fs.readdirSync(root, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(child);
    } else {
      yield child;
    }
  }
}

main(process.argv.slice(2));
