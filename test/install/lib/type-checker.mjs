/**
 * The TypeScript compiler an install smoke checks a consumer's code with, so
 * the smokes that typecheck what a reader writes against an installed package
 * (smoke-getting-started.mjs, smoke-libs.mjs) share one rule for where the
 * compiler comes from.
 *
 * From a checkout with its install (the gate's mode), the workspace's own
 * `tsc` and `@types`. From a checkout with no install (a published-mode run
 * straight after a clone), the same versions the root lockfile locks,
 * installed into a tools folder beside the reader's folder, never into it:
 * the reader's project must hold only what the reader installed. Plain Node,
 * importing only `node:*`, as the install layer requires (test/README.md).
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `name@version` as the root lockfile pins it (`packages["node_modules/<name>"]`),
 * so a tool or type package a smoke installs beside a reader's project is the
 * version the workspace builds with. Throws when the lockfile pins no such
 * package: a smoke must not fall back to whatever the registry has today.
 */
export function lockedSpec(repoRoot, name) {
  const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
  const version = lock.packages?.[`node_modules/${name}`]?.version;
  if (typeof version !== "string" || version === "") {
    throw new Error(`package-lock.json pins no ${name}; the smoke installs only locked versions`);
  }
  return `${name}@${version}`;
}

/**
 * Where `tsc` and the `@types` root are. `run(command, cwd)` runs a shell
 * command and rejects when it fails; it is called only in the published
 * mode, to install the locked compiler into `<scratch>/tools`.
 */
export async function typeChecker({ repoRoot, published, scratch, run }) {
  if (!published) {
    return {
      tsc: join(repoRoot, "node_modules", ".bin", "tsc"),
      typeRoots: join(repoRoot, "node_modules", "@types"),
    };
  }
  const tools = join(scratch, "tools");
  mkdirSync(tools, { recursive: true });
  await run(`npm install --no-save --prefix ${tools} ${lockedSpec(repoRoot, "typescript")} ${lockedSpec(repoRoot, "@types/node")}`, scratch);
  return { tsc: join(tools, "node_modules", ".bin", "tsc"), typeRoots: join(tools, "node_modules", "@types") };
}
