// The Environments concept page publishes the hosts "Also allow package
// registries and code hosts" opens, and the server's one constant owns them.
// Run via `node --test scripts/environment-hosts-docs.test.mjs` (wired into root `npm run test:root`).
//
// A person ticking that switch reads the page's table to know what the
// sandbox may reach; the gateway reads `PACKAGE_MANAGER_HOSTS`. Nothing else
// holds the two equal, so a host added to the constant (or a registry that
// moves) would leave the page promising less, or more, than the sandbox
// gets. This test fails naming every host one side has and the other lacks,
// and every host whose plain-HTTP (port 80) lane differs.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The server source that owns the list. */
export const HOSTS_MODULE = "backend/services/stigmer-server/src/domain/environment/package-manager-hosts.ts";

/** The page that publishes it. */
export const HOSTS_PAGE = "docs/concepts/environments.mdx";

/** The heading of the page section that holds the table. */
export const HOSTS_HEADING = "## The package registries and code hosts";

const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** Every host the constant lists, mapped to whether it is reached over plain HTTP too. */
export function hostsInSource(source) {
  const hosts = new Map();
  for (const [, kind, host] of source.matchAll(/\b(https|archive)\("([^"]+)"\)/g)) {
    hosts.set(host, kind === "archive");
  }
  return hosts;
}

/**
 * Every host the page's table lists, mapped to whether its row says it is
 * reached over plain HTTP too. The table sits under `HOSTS_HEADING`; each row
 * is `| Ecosystem | hosts in backticks | Yes or No |`.
 */
export function hostsInPage(text) {
  const start = text.indexOf(`\n${HOSTS_HEADING}\n`);
  if (start < 0) return new Map();
  const rest = text.slice(start + HOSTS_HEADING.length + 2);
  const end = rest.search(/\n## /);
  const section = end < 0 ? rest : rest.slice(0, end);
  const hosts = new Map();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5 || cells[0] !== "") continue;
    const [, , hostCell, cleartextCell] = cells;
    for (const [, host] of hostCell.matchAll(/`([a-z0-9.-]+\.[a-z]+)`/g)) {
      hosts.set(host, /^yes\b/i.test(cleartextCell));
    }
  }
  return hosts;
}

const source = hostsInSource(read(HOSTS_MODULE));
const page = hostsInPage(read(HOSTS_PAGE));

test("the constant lists the hosts", () => {
  assert.ok(source.size > 0, `${HOSTS_MODULE} lists its hosts as https("…") and archive("…")`);
});

test(`${HOSTS_PAGE} lists every host the server opens, and no other`, () => {
  const missing = [...source.keys()].filter((host) => !page.has(host));
  const extra = [...page.keys()].filter((host) => !source.has(host));
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `the table under "${HOSTS_HEADING}" must equal ${HOSTS_MODULE}`,
  );
});

test(`${HOSTS_PAGE} marks the plain-HTTP hosts the server marks`, () => {
  const differ = [...source]
    .filter(([host, cleartext]) => page.has(host) && page.get(host) !== cleartext)
    .map(([host, cleartext]) => `${host}: the server says ${cleartext ? "Yes" : "No"}`);
  assert.deepEqual(differ, []);
});

test("the readers find what each side writes", () => {
  assert.deepEqual(
    [...hostsInSource('  https("pypi.org"),\n  archive("deb.debian.org"),')],
    [
      ["pypi.org", false],
      ["deb.debian.org", true],
    ],
  );
  const table = [
    "intro",
    "",
    HOSTS_HEADING,
    "",
    "| Ecosystem | Hosts | Plain HTTP too |",
    "| --- | --- | --- |",
    "| Python | `pypi.org`, `files.pythonhosted.org` | No |",
    "| apt | `deb.debian.org` | Yes, port 80 |",
    "",
    "## Next",
    "| Other | `example.com` | No |",
  ].join("\n");
  assert.deepEqual(
    [...hostsInPage(table)],
    [
      ["pypi.org", false],
      ["files.pythonhosted.org", false],
      ["deb.debian.org", true],
    ],
  );
});
