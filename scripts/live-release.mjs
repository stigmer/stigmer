#!/usr/bin/env node

/**
 * Decides whether the live workflow (.github/workflows/ci.live.yaml) may run
 * a commit with the provider keys, and which published CLI it installs.
 *
 * Two guards keep the keys with reviewed code. The keys live in an
 * environment that deploys only to `main`, which refuses a run dispatched
 * from any other branch. A release run starts on `main` but checks out the
 * released commit, which the environment cannot see, so this rule guards
 * it: the commit must be one `main` already carries. GitHub's
 * compare of `main...<commit>` reads `identical` for `main`'s tip and `behind`
 * for an older commit of it; `ahead` or `diverged` is a commit `main` does
 * not carry, and it is refused.
 *
 * A release tag is `v<major>.<minor>.<patch>`. A prerelease tag
 * (`v1.2.3-rc.1`) is not a release the live check reads: `skip` says so, and
 * the workflow ends green with nothing run instead of filing a failure.
 *
 * Usage (prints `version=<X.Y.Z>` for the workflow's output, or the reason on
 * stderr):
 *   node scripts/live-release.mjs --tag <tag> --compare <status>
 * Exit 0 to run, 3 to skip, 1 to refuse.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/;
const PRERELEASE_TAG = /^v\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/;
/** The compare statuses of a commit `main` carries. */
const ON_MAIN = new Set(["identical", "behind"]);

/**
 * The decision for one run: `{ action: "run", version }`, `{ action: "skip", reason }`
 * or `{ action: "refuse", reason }`.
 */
export function admitLiveRun({ tag, compareStatus }) {
  if (PRERELEASE_TAG.test(tag)) return { action: "skip", reason: `${tag} is a prerelease; the live check reads releases` };
  const release = RELEASE_TAG.exec(tag);
  if (release === null) return { action: "refuse", reason: `not a release tag: ${JSON.stringify(tag)}` };
  if (!ON_MAIN.has(compareStatus)) {
    return { action: "refuse", reason: `the commit is not on main (${JSON.stringify(compareStatus)} against main); the live check runs only code main carries` };
  }
  return { action: "run", version: release[1] };
}

function parseArgs(argv) {
  const opts = { tag: "", compareStatus: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tag") opts.tag = argv[++i] ?? "";
    else if (argv[i] === "--compare") opts.compareStatus = argv[++i] ?? "";
    else throw new Error(`unknown argument: ${argv[i]} (usage: --tag <tag> --compare <status>)`);
  }
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const decision = admitLiveRun(parseArgs(process.argv.slice(2)));
    if (decision.action === "run") {
      console.log(`version=${decision.version}`);
    } else {
      console.error(`live-release: ${decision.reason}`);
      process.exitCode = decision.action === "skip" ? 3 : 1;
    }
  } catch (error) {
    console.error(`live-release: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
