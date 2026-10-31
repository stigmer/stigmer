/**
 * The agent's half of moving git objects between its clone and the runner's
 * repository (`runner-git.ts`, #2095): the commands the agent host runs in
 * the clone, as the agent, none of them holding a token.
 *
 * A bundle crosses as a file in the clone's own git directory (asked of the
 * host, since a clone's `.git` can be a file pointing elsewhere), named
 * `stigmer-incoming-*` or `stigmer-outgoing-*`: on the clone's filesystem,
 * outside the working tree and its status, and removed by the host when the
 * step ends, whatever its outcome. The runner writes and reads it only
 * through the agent's operations; the agent never reads a path of the
 * runner's.
 */

import { randomBytes } from "node:crypto";

import type { RunnerRepository } from "./runner-git.js";

/** Runs one command in the clone, as the agent host does, and returns its output. */
export type CloneExec = (command: string) => Promise<string>;

/** An object name as git prints one. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The clone's git directory, as the clone's own git answers. */
async function gitDir(exec: CloneExec): Promise<string> {
  const dir = (await exec("git rev-parse --absolute-git-dir")).trim();
  if (!dir.startsWith("/")) throw new Error(`The clone's git directory is not an absolute path: ${JSON.stringify(dir)}`);
  return dir;
}

/** A handoff file's path in the clone's git directory. */
function handoffPath(dir: string, direction: "incoming" | "outgoing", extension: string): string {
  return `${dir}/stigmer-${direction}-${randomBytes(8).toString("hex")}.${extension}`;
}

/** The commits the clone's remote-tracking refs and tags name: what the runner may leave out of a bundle for it. */
export async function cloneHaves(exec: CloneExec): Promise<string[]> {
  const out = await exec("git for-each-ref --format='%(objectname)' refs/remotes/origin refs/tags");
  return out.split("\n").map((line) => line.trim()).filter((line) => OBJECT_ID.test(line));
}

/**
 * Brings `revisions` of the runner's repository into the clone: the runner
 * bundles them without what `haves` reach, and the clone fetches the bundle
 * with `refspecs`. `false` when the clone already has everything, and
 * nothing crossed.
 */
export async function fetchFromRunner(
  repository: RunnerRepository,
  exec: CloneExec,
  transfer: { readonly revisions: readonly string[]; readonly haves: readonly string[]; readonly refspecs: readonly string[] },
): Promise<boolean> {
  const bundle = handoffPath(await gitDir(exec), "incoming", "bundle");
  try {
    if (!(await repository.sendBundle(transfer.revisions, transfer.haves, bundle))) return false;
    await exec(`git fetch --quiet ${shellQuote(bundle)} ${transfer.refspecs.map(shellQuote).join(" ")}`);
    return true;
  } finally {
    await exec(`rm -f -- ${shellQuote(bundle)}`).catch(() => "");
  }
}

/**
 * Pushes the clone's `refs/heads/<branch>` to GitHub through the runner:
 * the clone bundles the branch without what the runner's own heads reach
 * (`exclude`, which the runner named, so every prerequisite is the
 * runner's), and the runner admits and pushes it. Returns the commit
 * pushed.
 */
export async function pushThroughRunner(
  repository: RunnerRepository,
  exec: CloneExec,
  writeFile: (path: string, content: string) => Promise<void>,
  branch: string,
): Promise<string> {
  const dir = await gitDir(exec);
  const revisions = handoffPath(dir, "outgoing", "revs");
  const bundle = handoffPath(dir, "outgoing", "bundle");
  try {
    const exclude = (await repository.heads()).map((sha) => `^${sha}\n`).join("");
    await writeFile(revisions, `refs/heads/${branch}\n${exclude}`);
    await exec(`git bundle create --quiet ${shellQuote(bundle)} --ignore-missing --stdin < ${shellQuote(revisions)}`);
    return await repository.pushBundle(bundle, branch);
  } finally {
    await exec(`rm -f -- ${shellQuote(bundle)} ${shellQuote(revisions)}`).catch(() => "");
  }
}

/** Quotes one value for a POSIX shell, so it reaches the command as one argument. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
