#!/usr/bin/env node

/**
 * Generates the runner's private turn-row stubs
 * (proto/ai/stigmer/runner/turn/v1) into <out>/turn. Run from the
 * repository root: `make gen-runner-turn-stubs` and its -check call it.
 *
 * The rows import public types from the apis/ tree, which sits outside the
 * runner, so buf runs on a temporary workspace holding both: symlinks to
 * apis/ and to the runner's proto/ directory, with apis/buf.lock for
 * protovalidate. @stigmer/apis maps "./x" to "dist/x.js", so the ".js"
 * the plugin writes on imports of public types is dropped.
 *
 *   node backend/services/runner/scripts/gen-turn-stubs.mjs <out>
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const out = process.argv[2];
if (!out) {
  console.error("usage: gen-turn-stubs.mjs <out>");
  process.exit(2);
}

const root = process.cwd();
const runner = "backend/services/runner";
const ws = mkdtempSync(join(tmpdir(), "runner-turn-"));

const WORKSPACE = `version: v2
deps:
  - buf.build/bufbuild/protovalidate
modules:
  - path: apis
    excludes:
      - apis/stubs
  - path: turn
`;

/** Every *_pb.ts file under dir. */
function stubFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith("_pb.ts"))
    .map((entry) => join(entry.parentPath, entry.name));
}

try {
  symlinkSync(resolve(root, "apis"), join(ws, "apis"));
  symlinkSync(resolve(root, runner, "proto"), join(ws, "turn"));
  copyFileSync(resolve(root, "apis/buf.lock"), join(ws, "buf.lock"));
  writeFileSync(join(ws, "buf.yaml"), WORKSPACE);

  execFileSync("buf", ["generate", join(ws, "turn"), "--template", `${runner}/buf.gen.turn.yaml`, "-o", out], {
    stdio: "inherit",
  });

  for (const file of stubFiles(join(out, "turn"))) {
    const text = readFileSync(file, "utf8");
    writeFileSync(file, text.replace(/(from "@stigmer\/apis\/[^"]*)\.js"/g, '$1"'));
  }
} finally {
  rmSync(ws, { recursive: true, force: true });
}
