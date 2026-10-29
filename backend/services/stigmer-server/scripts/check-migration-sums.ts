/**
 * Refuses a change to a merged schema step: every `migrations.sum` the base
 * branch tracks (the store's two chains and Enterprise's) is compared with
 * the working tree through `compareSums` (src/store/schema-checksum.ts says
 * why a merged line is frozen). A branch may add lines after the base's and
 * may not change, reorder or remove one, nor delete a sum file. It is
 * `buf breaking` for schemas; the Enterprise lane runs it, since its paths
 * hold every chain.
 *
 * Usage: npm run schema:check-sums -- [--base <git ref>]   (default origin/main)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { compareSums } from "../src/store/schema-checksum.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

const at = process.argv.indexOf("--base");
const base = at >= 0 ? process.argv[at + 1] : "origin/main";
if (base === undefined || base === "") {
  console.error("usage: npm run schema:check-sums -- [--base <git ref>]");
  process.exit(2);
}

const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const sums = git(root, ["ls-tree", "-r", "--name-only", base])
  .split("\n")
  .filter((file) => file.endsWith("/migrations.sum"));
const refusals = sums.flatMap((file) => {
  const head = path.join(root, file);
  return compareSums(
    file,
    git(root, ["show", `${base}:${file}`]),
    existsSync(head) ? readFileSync(head, "utf8") : undefined,
  );
});
for (const refusal of refusals) {
  console.error(refusal);
}
if (refusals.length > 0) {
  process.exit(1);
}
console.log(
  `migration sums: ${sums.length} file(s) keep every line ${base} holds`,
);
