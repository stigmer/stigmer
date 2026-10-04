// The runner layer's start script refuses a base image it cannot run on, in one message that names the contract.
// Run via `node --test scripts/runner-layer-start.test.mjs` (wired into root `npm test`).
//
// backend/services/runner/layer/start.sh is /runner/bin/start in the image,
// the command every driver launches the runner with. What these pin: a
// refusal lists every problem it found in one line (so a pod's last-state
// message holds all of it), names the guide's section, and exits 78; a
// relative $0 is refused rather than guessed at; the tools the script
// checks are the ones the guide's contract names; and the script passes
// shellcheck.
//
// The script's success path needs root on a glibc Linux, which a
// developer's machine and the gate's runners are not, so the refusal cases
// compute what this machine lacks (the loader, /proc, root) and expect
// exactly that beside the tools a case hides. The success case (the Node
// beside the script exec'd with its arguments unchanged, NODE_OPTIONS and
// NODE_PATH gone) runs only as root on glibc and otherwise skips. The
// runner lane runs this file again as root in Node's Debian image, with
// STIGMER_TEST_AS_ROOT=1, where that skip is a failure; the image itself
// proves the same on every build (release.sandbox-cloud's layer checks, and
// the compose and Helm smokes, whose runner starts through the script).
// shellcheck skips where it is not installed, and in the gate
// (STIGMER_TEST_GATE=1) always runs, so a missing shellcheck fails there.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "backend/services/runner/layer/start.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
const GUIDE = readFileSync(join(ROOT, "docs/guides/self-hosting/runners.mdx"), "utf8");
const GUIDE_URL = "https://stigmer.ai/docs/guides/self-hosting/runners#bring-your-own-base-image";

/** The words of the script's `for tool in ...` line that holds `first`. */
function toolList(first) {
  const line = SOURCE.split("\n").find((l) => new RegExp(`^for tool in ${first}\\b`).test(l));
  assert.ok(line, `start.sh has no tool list starting with ${first}`);
  return line.replace(/^for tool in /, "").replace(/; do$/, "").split(/\s+/);
}
const REQUIRED = toolList("bash");
const OPTIONAL = toolList("python3");

const which = (tool) => {
  const found = spawnSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : undefined;
};

// What this machine lacks whatever PATH says.
const hasLoader = existsSync("/lib64/ld-linux-x86-64.so.2") || existsSync("/lib/ld-linux-aarch64.so.1");
const hasProc = existsSync("/proc/self/status");
const isRoot = process.getuid?.() === 0;

const work = mkdtempSync(join(tmpdir(), "runner-layer-start-"));
after(() => rmSync(work, { recursive: true, force: true }));

/** A directory holding links to the named tools from this machine's PATH. */
function pathWith(tools) {
  const dir = mkdtempSync(join(work, "path-"));
  for (const tool of tools) {
    const real = which(tool);
    assert.ok(real, `this machine has no ${tool} to put on the case's PATH`);
    symlinkSync(real, join(dir, tool));
  }
  return dir;
}

/** The layer's /runner/bin, in miniature: the script as `start`, a `node` that reports what it got. */
function layerBin() {
  const bin = mkdtempSync(join(work, "bin-"));
  copyFileSync(SCRIPT, join(bin, "start"));
  writeFileSync(
    join(bin, "node"),
    '#!/bin/sh\nprintf "args=%s|" "$@"\nprintf "NODE_OPTIONS=%s NODE_PATH=%s\\n" "${NODE_OPTIONS-unset}" "${NODE_PATH-unset}"\n',
    { mode: 0o755 },
  );
  return bin;
}

function start(bin, path, args = [], env = {}) {
  return spawnSync("/bin/sh", [join(bin, "start"), ...args], {
    encoding: "utf8",
    env: { PATH: path, ...env },
  });
}

/** The problems this machine itself causes, in the script's order. */
function machineProblems() {
  const problems = [];
  if (!hasLoader) problems.push("no glibc dynamic loader (/lib64/ld-linux-x86-64.so.2 or /lib/ld-linux-aarch64.so.1)");
  if (!hasProc) problems.push("no /proc (cannot read /proc/self/status)");
  else if (!isRoot) problems.push(`running as uid ${process.getuid()}, not root (on Substrate the base image's USER must be root)`);
  return problems;
}

test("a refusal lists every problem in one line, names the guide, and exits 78", () => {
  const hidden = ["git", "base64"];
  const result = start(layerBin(), pathWith(REQUIRED.filter((t) => !hidden.includes(t))));
  const problems = [...machineProblems(), `missing from PATH: ${hidden.join(", ")}`];
  assert.equal(result.status, 78);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    `stigmer runner: this base image cannot run the runner layer: ${problems.join("; ")}. ` +
      `The base image needs glibc 2.28 or newer, root, bash, git and standard text tools: ${GUIDE_URL}\n`,
  );
});

test("an empty PATH names every required tool", () => {
  const result = start(layerBin(), pathWith([]));
  assert.equal(result.status, 78);
  assert.match(result.stderr, new RegExp(`missing from PATH: ${REQUIRED.join(", ")}\\.`));
  assert.equal(result.stderr.split("\n").length, 2, "one line, then the newline");
});

test("a relative $0 is refused, not resolved", () => {
  const bin = layerBin();
  const result = spawnSync("/bin/sh", ["start"], { cwd: bin, encoding: "utf8", env: { PATH: pathWith(REQUIRED) } });
  assert.equal(result.status, 78);
  assert.equal(result.stderr, "stigmer runner: start it by its absolute path (/runner/bin/start), not as start\n");
});

test(
  "on a base it can run on, it warns per missing optional tool, clears the Node variables and execs the Node beside it",
  (hasLoader && hasProc && isRoot) || process.env.STIGMER_TEST_AS_ROOT === "1"
    ? {}
    : { skip: "needs root on a glibc Linux; the runner lane runs it as root" },
  () => {
    const result = start(layerBin(), pathWith(REQUIRED), ["/runner/dist/main.js", "a b"], {
      NODE_OPTIONS: "--require /nonexistent.js",
      NODE_PATH: "/somewhere",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "args=/runner/dist/main.js|args=a b|NODE_OPTIONS=unset NODE_PATH=unset\n");
    const warnings = result.stderr.trimEnd().split("\n");
    assert.deepEqual(
      warnings.map((line) => line.match(/^stigmer runner: warning: (\S+) is not on PATH/)?.[1]),
      OPTIONAL,
    );
  },
);

test("the guide's contract names every tool the script checks", () => {
  const heading = GUIDE.indexOf("\n### Bring your own base image\n");
  assert.notEqual(heading, -1, "runners.mdx has no '### Bring your own base image' section (the script's link)");
  const rest = GUIDE.slice(heading + 1);
  const next = rest.search(/\n##+ /);
  const section = next === -1 ? rest : rest.slice(0, next);
  for (const tool of [...REQUIRED, ...OPTIONAL]) {
    assert.ok(section.includes(`\`${tool}\``), `the guide's base image contract does not name \`${tool}\``);
  }
});

test(
  "passes shellcheck",
  which("shellcheck") || process.env.STIGMER_TEST_GATE === "1" ? {} : { skip: "shellcheck is not installed; the gate runs it" },
  () => {
    const result = spawnSync("shellcheck", ["--shell=sh", SCRIPT], { encoding: "utf8" });
    assert.equal(result.error, undefined, "shellcheck is not installed");
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);
