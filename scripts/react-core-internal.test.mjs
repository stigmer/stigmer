// `@stigmer/react-core/internal` has one consumer, the React kit.
// Run via `node --test scripts/react-core-internal.test.mjs` (wired into root
// `npm run test:root`).
//
// The conversation core (sdk/react-core) publishes the plumbing the React kit
// shares with it (the data-fetch hook and cache, the error mapper, the paging
// walks) through one extra entry, `./internal`, with no compatibility promise:
// a name there may change or leave in any release. That is safe only for a
// consumer that ships in lockstep with the core at one exact version, which
// @stigmer/react-sdk does (scripts/publish-libs.mjs pins every @stigmer/*
// dependency to the release's version). So no tracked source outside
// sdk/react and sdk/react-core may import the entry: the terminal kit, the
// apps, the examples and the docs' code import the public entry.
//
// The rule is a pure function over a file list and a reader, run here over the
// tracked tree and over fixtures of each refusal, so a rule that stopped
// refusing would fail its fixture rather than pass on nothing.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENTRY = "@stigmer/react-core/internal";
/** The one consumer, and the package that defines the entry. */
const ALLOWED = ["sdk/react/", "sdk/react-core/"];
/** This file: its fixtures spell out the imports it refuses. */
const SELF = "scripts/react-core-internal.test.mjs";

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx|mdx)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'`])([^"'`\n]+)\1/g;

/** Returns one sentence per import of the internal entry outside its consumer. */
export function importsInternalEntry(files, read) {
  const problems = [];
  for (const file of files) {
    if (file === SELF || ALLOWED.some((prefix) => file.startsWith(prefix)) || !SOURCE.test(file)) continue;
    for (const [, , spec] of read(file).matchAll(SPECIFIER)) {
      if (spec === ENTRY || spec.startsWith(`${ENTRY}/`)) {
        problems.push(`${file} imports ${spec}: only @stigmer/react-sdk may import the core's internal entry; use @stigmer/react-core`);
      }
    }
  }
  return problems;
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const read = (file) => readFileSync(join(root, file), "utf8");

test("nothing outside the React kit imports the conversation core's internal entry", () => {
  assert.deepEqual(importsInternalEntry(tracked, read), []);
});

test("the guard still finds the entry and its consumer", () => {
  const kit = tracked.filter((file) => file.startsWith("sdk/react/src/") && SOURCE.test(file));
  assert.ok(kit.some((file) => read(file).includes(`"${ENTRY}"`)), "the React kit imports the internal entry");
  assert.ok(tracked.includes("sdk/react-core/src/internal.ts"), "the entry's module is tracked");
});

test("the rule refuses the entry from any other package, in every import form", () => {
  const fixtures = new Map([
    ["sdk/ink/src/a.tsx", `import { toError } from "${ENTRY}";`],
    ["client-apps/web/src/b.ts", `const m = await import("${ENTRY}");`],
    ["docs/sdk/c.mdx", `export { useFetch } from "${ENTRY}";`],
    ["sdk/react/src/d.ts", `import { toError } from "${ENTRY}";`],
    ["sdk/ink/src/e.ts", `import { useStigmer } from "@stigmer/react-core";`],
  ]);
  assert.deepEqual(importsInternalEntry([...fixtures.keys()], (file) => fixtures.get(file)), [
    `sdk/ink/src/a.tsx imports ${ENTRY}: only @stigmer/react-sdk may import the core's internal entry; use @stigmer/react-core`,
    `client-apps/web/src/b.ts imports ${ENTRY}: only @stigmer/react-sdk may import the core's internal entry; use @stigmer/react-core`,
    `docs/sdk/c.mdx imports ${ENTRY}: only @stigmer/react-sdk may import the core's internal entry; use @stigmer/react-core`,
  ]);
});
