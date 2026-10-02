// Tests for apt-cache.sh's `resolve`: the index refresh runs under a deadline, and fails named when it passes.
// Run via `node --test .github/actions/tauri-linux-deps/apt-cache.test.mjs` (wired into root `npm test`).
//
// What these pin: `apt-get update` against Ubuntu's mirror is a wait nothing
// else in the action bounds (a composite step cannot carry `timeout-minutes`),
// so `resolve` runs it under coreutils `timeout` and turns a stall into one
// message that says what happened (#1702). Fakes stand in for `sudo` (it runs
// its arguments) and `apt-get` (told by an environment variable to hang, fail
// or answer), first on PATH; `timeout`, `dpkg`, `sha256sum` and
// /etc/os-release are the system's own. The hung fake backgrounds a child,
// so the case proves the deadline takes the whole process group, the way it
// must take apt's fetch methods. The kill-after mapping (exit 137) uses a fake
// `timeout`, which records the arguments it was given, so `--kill-after`
// is pinned, instead of waiting the script's real 15 s: this suite runs in the
// job every other ts-workspace job waits on, so no case may cost more than
// about a second. Coreutils' own TERM-then-KILL is not this suite's subject.
//
// Linux only: off a machine with `timeout`, `dpkg` and /etc/os-release (a
// Mac), the cases skip with that reason; in the gate (STIGMER_TEST_GATE=1)
// they always run, so a missing tool there fails them.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "apt-cache.sh");

const onPath = (tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0;
const linux = onPath("timeout") && onPath("dpkg") && existsSync("/etc/os-release");
const NEEDS_LINUX =
  linux || process.env.STIGMER_TEST_GATE === "1"
    ? {}
    : { skip: "needs coreutils `timeout`, `dpkg` and /etc/os-release (a Linux runner); the gate runs it" };

const SHA = "ab".repeat(32);
const ARCHIVE = "patchelf_0.18.0-1.1build1_amd64.deb";

// Answers `update` as FAKE_APT says, and `install --print-uris` with one archive.
const FAKE_APT = `#!/usr/bin/env bash
if [[ $1 == update ]]; then
  case $FAKE_APT in
    hang) sleep 300 & echo "$$ $!" > "$FAKE_APT_PIDS"; wait ;;
    fail) echo "E: The repository is not signed." >&2; exit 100 ;;
    *) echo "Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease" ;;
  esac
elif [[ " $* " == *" --print-uris "* ]]; then
  echo "'http://archive.ubuntu.com/ubuntu/pool/main/p/patchelf/${ARCHIVE}' ${ARCHIVE} 4096 SHA256:${SHA}"
else
  echo "fake apt-get: unexpected arguments: $*" >&2
  exit 64
fi
`;

const scratch = mkdtempSync(join(tmpdir(), "apt-cache-test-"));
let fixtureCount = 0;
const pidFiles = [];

// A deadline that failed to fire would leave the fake and its child running;
// each case kills what its fake started, so a broken deadline fails its case
// and the run still ends.
function stopFakes() {
  for (const file of pidFiles.splice(0)) {
    let pids = [];
    try {
      pids = readFileSync(file, "utf8").trim().split(" ").map(Number);
    } catch {
      continue;
    }
    // Only real pids: a 0 here would signal this runner's own process group.
    for (const pid of pids.filter((p) => Number.isInteger(p) && p > 1)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone, as it should be.
      }
    }
  }
}

afterEach(stopFakes);
after(() => {
  stopFakes();
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Whether a pid still names a live process. A killed process answers signal 0
 * until its parent reaps it, and an orphan's parent is whatever init the host
 * runs: a container started without one never reaps, so a zombie (state `Z` in
 * /proc/<pid>/stat) counts as gone.
 */
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name sits in parentheses and may hold either; the state follows the last one.
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return true;
  }
}

function executable(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

/** Runs `apt-cache.sh resolve` against fresh fakes; `timeoutExit` swaps in a fake `timeout` that exits with it. */
function resolve(mode, { timeoutExit } = {}) {
  const dir = join(scratch, String(++fixtureCount));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(dir, "tmp"));
  executable(join(bin, "sudo"), '#!/bin/sh\nexec "$@"\n');
  executable(join(bin, "apt-get"), FAKE_APT);
  const timeoutArgs = join(dir, "timeout-args");
  if (timeoutExit !== undefined) {
    executable(join(bin, "timeout"), `#!/bin/sh\nprintf '%s\\n' "$@" > "$FAKE_TIMEOUT_ARGS"\nexit ${timeoutExit}\n`);
  }
  const pids = join(dir, "pids");
  pidFiles.push(pids);
  const output = join(dir, "github-output");
  writeFileSync(output, "");
  const started = Date.now();
  const result = spawnSync("bash", [SCRIPT, "resolve"], {
    encoding: "utf8",
    // The case's own bound: a deadline that never fired fails here instead of hanging the suite.
    timeout: 10_000,
    killSignal: "SIGKILL",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      RUNNER_TEMP: join(dir, "tmp"),
      GITHUB_OUTPUT: output,
      TAURI_APT_UPDATE_DEADLINE_S: "1",
      FAKE_APT: mode,
      FAKE_APT_PIDS: pids,
      FAKE_TIMEOUT_ARGS: timeoutArgs,
    },
  });
  return {
    ...result,
    elapsedMs: Date.now() - started,
    manifest: join(dir, "tmp", "tauri-apt", "manifest"),
    outputs: () => readFileSync(output, "utf8"),
    pids: () => readFileSync(pids, "utf8").trim().split(" ").map(Number),
    timeoutArgs: () => readFileSync(timeoutArgs, "utf8").trim().split("\n"),
  };
}

const STALLED = /resolve: apt-get update did not finish in 1 s: Ubuntu's mirror stalled \(#1702\)\. Nothing was installed; rerun the job\./;

test("a hung index refresh is stopped at the deadline with its whole process group, and says the mirror stalled", NEEDS_LINUX, () => {
  const run = resolve("hang");
  assert.equal(run.error, undefined, `the script itself was stopped by the case's bound after ${run.elapsedMs} ms`);
  assert.equal(run.status, 1);
  assert.match(run.stderr, STALLED);
  assert.ok(run.elapsedMs < 5_000, `stopped promptly after the 1 s deadline (took ${run.elapsedMs} ms)`);
  const [fake, child] = run.pids();
  assert.ok(!alive(fake) && !alive(child), "neither the fake apt-get nor its child is left running");
  assert.equal(existsSync(run.manifest), false, "no manifest is written for an index that never arrived");
  assert.equal(run.outputs(), "", "no cache key is output");
});

test("a refresh KILLed after outliving the TERM (timeout's 137) gets the same message", NEEDS_LINUX, () => {
  const run = resolve("ok", { timeoutExit: 137 });
  // The KILL is what stops a fetch method that ignores TERM, so its flag is pinned here.
  assert.deepEqual(run.timeoutArgs(), ["--kill-after=15", "1", "apt-get", "update"]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, STALLED);
  assert.equal(run.outputs(), "");
});

test("a refresh that fails on its own keeps apt's message and exit code, not the stall's", NEEDS_LINUX, () => {
  const run = resolve("fail");
  assert.equal(run.status, 100);
  assert.match(run.stderr, /E: The repository is not signed\./);
  assert.doesNotMatch(run.stderr, /mirror stalled/);
  assert.equal(run.outputs(), "");
});

test("a healthy refresh goes on to the manifest and the content-addressed cache key", NEEDS_LINUX, () => {
  const run = resolve("ok");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(run.manifest, "utf8"), `${ARCHIVE} 4096 ${SHA}\n`);
  assert.match(run.stdout, /tauri-linux-deps: 1 archives to fetch \(0\.0 MB\); cache key tauri-apt-/);
  const outputs = run.outputs().trim().split("\n");
  assert.equal(outputs.length, 2, run.outputs());
  assert.match(outputs[0], /^key=tauri-apt-ubuntu[^-]+-[a-z0-9]+-[0-9a-f]{64}$/);
  assert.match(outputs[1], /^prefix=tauri-apt-ubuntu[^-]+-[a-z0-9]+-$/);
  assert.ok(outputs[0].startsWith(outputs[1].slice("prefix=".length), "key=".length), "the key extends its prefix");
});
