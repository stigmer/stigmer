// Every Stigmer-only session event is listed, with its reason, on the page
// where developers meet the events.
// Run via `node --test scripts/stigmer-events-listed.test.mjs` (wired into root `npm run test:root`).
//
// A session's events are Claude Managed Agents events; what Managed Agents
// has no place for travels as a separate `stigmer.` event, and apis/README.md
// ("Agent output formats") requires each such extension to be listed with the
// reason the specification has none. The contract declares each type once,
// as the `(ai.stigmer.commons.apiresource.event_type)` option on its oneof
// member, and the list is the table in the "Stigmer's own events" section of
// docs/sdk/streaming.mdx. This test fails, naming the type, when a `stigmer.`
// type has no row, a row names a type the contract lacks, or a row gives no
// reason, so an extension cannot be added without saying why it exists.
// Every tracked proto under apis/ is read, so a type that moves files is
// still found; the preview type declared on two frames is one row.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The page that holds the list, and the section heading the table sits under. */
export const LIST_PAGE = "docs/sdk/streaming.mdx";
export const LIST_HEADING = "## Stigmer's own events";

/** The protos that may declare an event type: every tracked one under apis/. */
export const PROTO_PATHSPEC = ":(glob)apis/**/*.proto";

const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** Every `stigmer.` type a proto source declares through the event_type option. */
export function stigmerTypesIn(source) {
  return [...source.matchAll(/\(ai\.stigmer\.commons\.apiresource\.event_type\)\s*=\s*"(stigmer\.[a-z0-9_.]+)"/g)].map(
    (m) => m[1],
  );
}

/**
 * The rows of the table under the heading, up to the next heading of the
 * same or a higher level: each row's type (the first backticked token of its
 * first cell, so a note such as "(preview)" may follow it) and its cells.
 */
export function listedRows(page, heading = LIST_HEADING) {
  const start = page.indexOf(`\n${heading}\n`);
  if (start < 0) return undefined;
  const body = page.slice(start + heading.length + 2);
  const end = body.search(/\n#{1,2} /);
  const section = end < 0 ? body : body.slice(0, end);
  return section
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*(Event\s*\||-)/.test(line))
    .map((line) => {
      const cells = line
        .slice(1, line.endsWith("|") ? -1 : undefined)
        .split("|")
        .map((cell) => cell.trim());
      return { type: cells[0]?.match(/`([^`]+)`/)?.[1], cells };
    });
}

const declared = [
  ...new Set(
    execFileSync("git", ["ls-files", "-z", "--", PROTO_PATHSPEC], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
      .flatMap((path) => stigmerTypesIn(read(path))),
  ),
].sort();
const rows = listedRows(read(LIST_PAGE));

test("the contract declares Stigmer's own event types", () => {
  assert.ok(declared.length > 0, `a proto under apis/ declares a stigmer. event_type`);
});

test(`${LIST_PAGE} has the "${LIST_HEADING.slice(3)}" table`, () => {
  assert.ok(rows && rows.length > 0, `${LIST_PAGE} has a table under "${LIST_HEADING}"`);
});

for (const type of declared) {
  test(`${type} has exactly one row in ${LIST_PAGE}`, () => {
    const matching = (rows ?? []).filter((row) => row.type === type);
    assert.equal(matching.length, 1, `${LIST_PAGE} lists ${type} once, with its reason`);
  });
}

test(`every row of ${LIST_PAGE} names a type the contract declares, with a reason`, () => {
  for (const row of rows ?? []) {
    assert.ok(row.type, `a row's first cell names its type in backticks: ${row.cells.join(" | ")}`);
    assert.ok(declared.includes(row.type), `${row.type} is listed but no proto declares it`);
    assert.equal(row.cells.length, 4, `${row.type}'s row has its four cells`);
    for (const cell of row.cells) assert.notEqual(cell, "", `${row.type}'s row has no empty cell`);
  }
});

test("the readers find what a proto and a table write", () => {
  const proto =
    'Foo foo = 100 [(ai.stigmer.commons.apiresource.event_type) = "stigmer.foo.bar"];\n' +
    'Bar bar = 1 [(ai.stigmer.commons.apiresource.event_type) = "agent.message"];';
  assert.deepEqual(stigmerTypesIn(proto), ["stigmer.foo.bar"]);
  const page = [
    "# Page",
    "",
    LIST_HEADING,
    "",
    "| Event | What it says | Why Managed Agents has none | Written by |",
    "| --- | --- | --- | --- |",
    "| `stigmer.foo.bar` | It says foo. | They have no foo. | Runner |",
    "| `stigmer.foo.delta` (preview) | A piece. |  | Runner |",
    "",
    "## Next",
    "",
    "| `stigmer.not.listed` | x | y | z |",
  ].join("\n");
  const found = listedRows(page);
  assert.deepEqual(
    found.map((row) => row.type),
    ["stigmer.foo.bar", "stigmer.foo.delta"],
  );
  assert.equal(found[1].cells[2], "");
  assert.equal(listedRows("# Page\n\n## Another\n"), undefined);
});
