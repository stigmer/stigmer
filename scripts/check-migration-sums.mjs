#!/usr/bin/env node

/**
 * Refuses a change to a merged schema step.
 *
 * Every schema chain commits a `migrations.sum` beside it: one line per
 * step, its version and the SHA-256 of its statements (the store's
 * schema-checksum.ts writes and reads it). A step that has merged may already
 * have run somewhere: a merge to a hosted edition's `main` deploys at once,
 * and a team's own servers upgrade from any release. So a branch may add
 * lines after the base branch's, and may not change, reorder or remove one,
 * nor delete a sum file the base holds. The runner's boot check catches a
 * database that ran a changed step; this catches the change before it
 * merges. It is `buf breaking` for schemas.
 *
 * Usage: node scripts/check-migration-sums.mjs [--base <git ref>]
 * The base defaults to origin/main. Every `migrations.sum` tracked at the
 * base or present in the working tree is compared.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The lines of a sum file that name a step, as `<version> <hex>`. */
export function sumLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * What a branch's sum file does to the base's: a list of refusals, empty
 * when every base line is still there, unchanged and in place.
 */
export function compareSums(path, baseText, headText) {
  if (headText === undefined) {
    return [
      `${path}: removed, but its steps have merged; a merged step never goes`,
    ];
  }
  const base = sumLines(baseText);
  const head = sumLines(headText);
  const refusals = [];
  base.forEach((line, index) => {
    const now = head[index];
    if (now === undefined) {
      refusals.push(`${path}: the merged line "${line}" was removed`);
    } else if (now !== line) {
      refusals.push(
        `${path}: the merged line "${line}" now reads "${now}"; a merged step never changes, so add a new step instead`,
      );
    }
  });
  return refusals;
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Compares every sum file between `base` and the working tree at `root`. */
export function checkMigrationSums(root, base) {
  const atBase = git(root, ["ls-tree", "-r", "--name-only", base])
    .split("\n")
    .filter(
      (path) => path.endsWith("/migrations.sum") || path === "migrations.sum",
    );
  const refusals = [];
  for (const path of atBase) {
    const baseText = git(root, ["show", `${base}:${path}`]);
    const file = join(root, path);
    const headText = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    refusals.push(...compareSums(path, baseText, headText));
  }
  return { checked: atBase, refusals };
}

function main(argv) {
  const at = argv.indexOf("--base");
  const base = at >= 0 ? argv[at + 1] : "origin/main";
  if (base === undefined || base === "") {
    console.error("usage: check-migration-sums.mjs [--base <git ref>]");
    return 2;
  }
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const { checked, refusals } = checkMigrationSums(root, base);
  for (const refusal of refusals) {
    console.error(refusal);
  }
  if (refusals.length > 0) {
    return 1;
  }
  console.log(
    `migration sums: ${checked.length} file(s) keep every line ${base} holds`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
