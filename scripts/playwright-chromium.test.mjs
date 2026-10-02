// Tests for scripts/playwright-chromium.mjs: how CI gets Playwright's Chromium.
// Run via `node --test scripts/playwright-chromium.test.mjs` (wired into root `npm test`).
//
// What these pin, in two halves.
//
// The installer: it installs Chromium and then proves the browser launches,
// under one deadline, and fails with one named message per cause. A fake
// `playwright` CLI stands in for the real one (no network): a small Node
// script written to a temporary directory, told by an environment variable
// how to behave, recording the arguments it was called with. The deadline
// cases give it a grandchild that would outlive a plain kill, so they prove
// the whole process group goes, the way Playwright's own out-of-process
// downloader would have to. The missing-library case feeds it the exact text
// Playwright 1.60's launcher printed on a bare ubuntu:24.04 host, so the
// probe is held to what a real image change looks like.
//
// The guard: no workflow and no composite action installs Playwright's
// browsers except through .github/actions/playwright-chromium (#1663). The
// real files are read as they are, and fixtures pin each form an install can
// take, including one split across a continuation or a multi-line block, and
// the exemption's two rules: it covers only its own file, and it fails once
// that file installs nothing, so it cannot outlive its reason.

import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Writable } from "node:stream";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import {
  ACTION,
  EXEMPT,
  installChromium,
  installFindings,
  makeInstallTargets,
  playwrightCli,
  readSources,
  verdictMessage,
  workspaceRoot,
} from "./playwright-chromium.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Playwright 1.60's launcher on a bare ubuntu:24.04 (arm64) host: the probe's stderr, verbatim.
const MISSING_LIBRARIES = `Error: command.parse: 
╔══════════════════════════════════════════════════════╗
║ Host system is missing dependencies to run browsers. ║
║ Missing libraries:                                   ║
║     libglib-2.0.so.0                                 ║
║     libgobject-2.0.so.0                              ║
║     libnspr4.so                                      ║
║     libnss3.so                                       ║
║     libnssutil3.so                                   ║
║     libgio-2.0.so.0                                  ║
║     libatk-1.0.so.0                                  ║
║     libdbus-1.so.3                                   ║
║     libX11.so.6                                      ║
║     libXcomposite.so.1                               ║
║     libXdamage.so.1                                  ║
║     libXext.so.6                                     ║
║     libXfixes.so.3                                   ║
║     libXrandr.so.2                                   ║
║     libgbm.so.1                                      ║
║     libexpat.so.1                                    ║
║     libxcb.so.1                                      ║
║     libxkbcommon.so.0                                ║
║     libasound.so.2                                   ║
║     libatspi.so.0                                    ║
╚══════════════════════════════════════════════════════╝
`;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// The fake CLI. FAKE_PLAYWRIGHT picks the behaviour, FAKE_PLAYWRIGHT_LOG
// collects one line of arguments per call, FAKE_PLAYWRIGHT_PIDS receives the
// pids of a hanging call and its grandchild, FAKE_PLAYWRIGHT_STDERR is what a
// failed launch prints.
const FAKE_CLI = `#!/usr/bin/env node
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const [command, ...rest] = process.argv.slice(2);
const mode = process.env.FAKE_PLAYWRIGHT || "ok";
fs.appendFileSync(process.env.FAKE_PLAYWRIGHT_LOG, process.argv.slice(2).join(" ") + "\\n");
const hang = () => {
  const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  fs.writeFileSync(process.env.FAKE_PLAYWRIGHT_PIDS, process.pid + " " + grandchild.pid);
  setInterval(() => {}, 1000);
};
if (command === "install") {
  if (mode === "install-killed") {
    process.kill(process.pid, "SIGTERM");
  } else if (mode === "install-fails") {
    console.error("Error: Failed to download Chrome Headless Shell");
    process.exit(3);
  } else if (mode === "install-hangs") {
    hang();
  } else {
    console.log("Chrome Headless Shell 148.0.7778.96 (playwright chromium-headless-shell v1223) downloaded");
  }
} else if (command === "screenshot") {
  const file = rest[rest.length - 1];
  if (mode === "probe-fails") {
    process.stderr.write(process.env.FAKE_PLAYWRIGHT_STDERR);
    process.exit(1);
  } else if (mode === "probe-hangs") {
    hang();
  } else if (mode === "no-png") {
    process.exit(0);
  } else if (mode === "not-png") {
    fs.writeFileSync(file, "not an image");
  } else {
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
  }
} else {
  console.error("fake playwright: unexpected command " + command);
  process.exit(64);
}
`;

const scratch = mkdtempSync(join(tmpdir(), "playwright-chromium-test-"));
let fixtureCount = 0;

// Every pid file a hanging fake wrote. A deadline that failed to fire would
// leave the fake and its grandchild running, and they would hold this file's
// process open: each case kills what its fakes started, so a broken deadline
// fails its case and the run still ends.
const pidFiles = [];

function stopFakes() {
  for (const file of pidFiles.splice(0)) {
    let pids = [];
    try {
      pids = readFileSync(file, "utf8").trim().split(" ").map(Number);
    } catch {
      continue;
    }
    // Only real pids: a 0 here would signal this runner's own process group.
    if (
      pids.length !== 2 ||
      !pids.every((pid) => Number.isInteger(pid) && pid > 1)
    )
      continue;
    for (const target of [-pids[0], ...pids]) {
      try {
        process.kill(target, "SIGKILL");
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

/** A fresh fake CLI in its own directory, with its call log, pid file and probe path. */
function fakeCli(mode, extraEnv = {}) {
  const dir = join(scratch, String(++fixtureCount));
  const bin = join(dir, "node_modules", ".bin");
  const cli = join(bin, "playwright");
  const log = join(dir, "calls.log");
  const pids = join(dir, "pids");
  mkdirSync(bin, { recursive: true });
  writeFileSync(cli, FAKE_CLI);
  chmodSync(cli, 0o755);
  writeFileSync(log, "");
  pidFiles.push(pids);
  const env = {
    FAKE_PLAYWRIGHT: mode,
    FAKE_PLAYWRIGHT_LOG: log,
    FAKE_PLAYWRIGHT_PIDS: pids,
    ...extraEnv,
  };
  return {
    dir,
    cli,
    probeFile: join(dir, "probe.png"),
    env,
    calls: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
    pids: () => readFileSync(pids, "utf8").trim().split(" ").map(Number),
  };
}

/** A writable that keeps what it is given, to stand in for the job log. */
function sink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  stream.text = () => Buffer.concat(chunks).toString("utf8");
  return stream;
}

/** Runs the installer against a fake CLI, with the fake's environment and a captured log. */
async function run(fake, { deadlineMs = 20_000 } = {}) {
  const out = sink();
  const err = sink();
  const started = Date.now();
  const verdict = await installChromium({
    cli: fake.cli,
    probeFile: fake.probeFile,
    deadlineMs,
    env: { ...process.env, ...fake.env },
    out,
    err,
  });
  return {
    verdict,
    out: out.text(),
    err: err.text(),
    elapsedMs: Date.now() - started,
  };
}

/** Whether a pid still names a live process. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits up to `ms` for every pid to be gone; the kernel reaps a killed orphan asynchronously. */
async function gone(pids, ms = 3_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pids.every((pid) => !alive(pid))) return true;
    await new Promise((settle) => setTimeout(settle, 50));
  }
  return pids.every((pid) => !alive(pid));
}

// ---------------------------------------------------------------------------
// The installer
// ---------------------------------------------------------------------------

test("a clean install, then a launch, pass in that order and report the time", async () => {
  const fake = fakeCli("ok");
  const { verdict, out } = await run(fake);
  assert.equal(verdict.ok, true);
  assert.deepEqual(fake.calls(), [
    "install chromium",
    `screenshot --browser chromium about:blank ${fake.probeFile}`,
  ]);
  assert.match(out, /downloaded/, "the CLI's own output reaches the log");
  assert.match(
    verdictMessage(verdict),
    /^playwright-chromium: chromium installed and launched in \d+\.\d s$/,
  );
});

test("a missing CLI fails before anything runs, and names the root npm ci", async () => {
  const fake = fakeCli("ok");
  const verdict = await installChromium({
    cli: join(fake.dir, "absent", "playwright"),
    probeFile: fake.probeFile,
    deadlineMs: 20_000,
    env: { ...process.env, ...fake.env },
    out: sink(),
    err: sink(),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.phase, "setup");
  assert.deepEqual(fake.calls(), []);
  assert.match(
    verdictMessage(verdict),
    /does not exist; run the root `npm ci` before this action/,
  );
});

test("a failed install fails with its exit code, and the probe never runs", async () => {
  const fake = fakeCli("install-fails");
  const { verdict, err } = await run(fake);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.phase, "install");
  assert.equal(verdict.code, 3);
  assert.deepEqual(fake.calls(), ["install chromium"]);
  assert.match(
    err,
    /Failed to download/,
    "the CLI's own error reaches the log",
  );
  assert.match(
    verdictMessage(verdict),
    /`playwright install chromium` exited with code 3/,
  );
});

test("an install killed by a signal fails and names the signal", async () => {
  const fake = fakeCli("install-killed");
  const { verdict } = await run(fake);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.phase, "install");
  assert.equal(verdict.signal, "SIGTERM");
  assert.match(
    verdictMessage(verdict),
    /`playwright install chromium` was killed by SIGTERM/,
  );
});

test("a CLI that exists but cannot be run fails with the reason", async () => {
  const fake = fakeCli("ok");
  chmodSync(fake.cli, 0o644);
  const { verdict } = await run(fake);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.phase, "install");
  assert.match(
    verdictMessage(verdict),
    /could not run .*playwright: spawn .*EACCES/,
  );
});

test("a browser that cannot launch fails, with Playwright's own missing-library list and what it means", async () => {
  const fake = fakeCli("probe-fails", {
    FAKE_PLAYWRIGHT_STDERR: MISSING_LIBRARIES,
  });
  const { verdict, err } = await run(fake);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.phase, "probe");
  assert.equal(verdict.code, 1);
  assert.ok(
    err.includes(MISSING_LIBRARIES),
    "Playwright's text reaches the log unchanged",
  );
  const message = verdictMessage(verdict);
  assert.match(message, /did not launch/);
  assert.match(message, /runner image no longer ships what Chromium needs/);
  assert.match(
    message,
    /install the packages that provide those libraries in \.\/\.github\/actions\/playwright-chromium, not to bring back `--with-deps` \(#1663\)/,
  );
});

test("a launch that exits 0 but writes no screenshot fails", async () => {
  const fake = fakeCli("no-png");
  const { verdict } = await run(fake);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.phase, "probe");
  assert.match(verdictMessage(verdict), /wrote no PNG/);
});

test("a launch that writes something other than a PNG fails", async () => {
  const fake = fakeCli("not-png");
  const { verdict } = await run(fake);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.phase, "probe");
  assert.match(verdictMessage(verdict), /wrote no PNG/);
});

// A broken deadline would hang here, so the case has its own bound: it fails, never hangs.
test(
  "an install past the deadline is stopped with its whole process group, and names the download",
  { timeout: 15_000 },
  async () => {
    const fake = fakeCli("install-hangs");
    const { verdict, elapsedMs } = await run(fake, { deadlineMs: 1_500 });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.phase, "install");
    assert.equal(verdict.timedOut, true);
    assert.ok(
      elapsedMs < 1_500 + 5_000,
      `stopped promptly after the deadline (took ${elapsedMs} ms)`,
    );
    assert.deepEqual(
      fake.calls(),
      ["install chromium"],
      "the probe never runs after a timed-out install",
    );
    assert.ok(
      await gone(fake.pids()),
      "neither the CLI nor its grandchild is left running",
    );
    assert.match(
      verdictMessage(verdict),
      /the install did not finish within 1\.5 s and was stopped; Chromium downloads from cdn\.playwright\.dev/,
    );
  },
);

// A broken deadline would hang here, so the case has its own bound: it fails, never hangs.
test(
  "the deadline covers the launch too, not only the install",
  { timeout: 15_000 },
  async () => {
    const fake = fakeCli("probe-hangs");
    const { verdict, elapsedMs } = await run(fake, { deadlineMs: 1_500 });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.phase, "probe");
    assert.equal(verdict.timedOut, true);
    assert.ok(
      elapsedMs < 1_500 + 5_000,
      `stopped promptly after the deadline (took ${elapsedMs} ms)`,
    );
    assert.ok(
      await gone(fake.pids()),
      "neither the CLI nor its grandchild is left running",
    );
    assert.match(
      verdictMessage(verdict),
      /the launch did not finish within 1\.5 s and was stopped/,
    );
  },
);

test("a checkout with no npm ci at all still gets the named message, not a module error", () => {
  // The action runs the script before anything proves node_modules exists, so
  // the installer half may import only Node's built-ins.
  // The real path: the script starts main only when argv names it as Node resolves it.
  const checkout = join(realpathSync(scratch), "no-npm-ci");
  mkdirSync(join(checkout, "scripts"), { recursive: true });
  const script = join(checkout, "scripts", "playwright-chromium.mjs");
  writeFileSync(
    script,
    readFileSync(join(root, "scripts", "playwright-chromium.mjs")),
  );
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, GITHUB_WORKSPACE: checkout },
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.match(
    result.stderr,
    /node_modules\/\.bin\/playwright does not exist; run the root `npm ci` before this action/,
  );
});

test("the workspace is GITHUB_WORKSPACE on a runner, and this repository otherwise", () => {
  assert.equal(workspaceRoot({ GITHUB_WORKSPACE: "/w" }), "/w");
  assert.equal(workspaceRoot({}), root);
  assert.equal(
    playwrightCli("/w"),
    join("/w", "node_modules", ".bin", "playwright"),
  );
});

test("the action runs this script and takes no inputs", () => {
  const action = parse(
    readFileSync(join(root, ACTION.replace(/^\.\//, ""), "action.yml"), "utf8"),
  );
  assert.equal(action.runs.using, "composite");
  assert.equal(
    action.inputs,
    undefined,
    "an input nobody varies is untested surface",
  );
  assert.equal(action.runs.steps.length, 1);
  assert.equal(
    action.runs.steps[0].run,
    'node "$GITHUB_WORKSPACE/scripts/playwright-chromium.mjs"',
  );
});

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/** One workflow whose one job runs the given commands, one step each. */
const workflow = (file, ...runs) => ({
  file,
  doc: {
    jobs: {
      suite: { steps: runs.map((run, i) => ({ name: `step ${i + 1}`, run })) },
    },
  },
});

test("no workflow or composite action installs Playwright's browsers except through the action", () => {
  const sources = readSources(root);
  assert.ok(
    sources.some((s) => s.file === ".github/workflows/ci.e2e-interactive.yaml"),
    "the workflows are read",
  );
  assert.ok(
    sources.some(
      (s) => s.file === ".github/actions/tauri-linux-deps/action.yml",
    ),
    "the composite actions are read",
  );
  const targets = makeInstallTargets(
    readFileSync(join(root, "Makefile"), "utf8"),
  );
  assert.ok(
    targets.has("test-e2e"),
    "the Makefile's installing targets are found",
  );
  assert.deepEqual(installFindings(sources, EXEMPT, targets), []);
});

const MAKEFILE = [
  ".PHONY: test-e2e check-e2e build-server lint",
  "test-e2e: ## the functional suite",
  "\tnpm ci",
  "\tcd test/e2e && npx playwright install --with-deps chromium && \\",
  "\t  npx playwright test --project=functional",
  "check-e2e: build-server",
  "\t$(MAKE) lint",
  "\t$(MAKE) test-e2e",
  "build-server:",
  "\tnpm run build -w server",
  "lint:",
  "\tnpx eslint .",
  "",
].join("\n");

test("the Makefile targets that install Playwright's browsers are found, through $(MAKE) too", () => {
  assert.deepEqual([...makeInstallTargets(MAKEFILE)].sort(), [
    "check-e2e",
    "test-e2e",
  ]);
});

test("a workflow that runs an installing make target is refused, and other targets are not", () => {
  const targets = makeInstallTargets(MAKEFILE);
  const refused = [
    "make test-e2e",
    "make -j4 check-e2e",
    "cd x && make build-server test-e2e",
    "CI=1 make test-e2e",
  ];
  for (const run of refused) {
    const findings = installFindings(
      [workflow(".github/workflows/ci.fixture.yaml", run)],
      new Map(),
      targets,
    );
    assert.equal(findings.length, 1, `refused: ${run}`);
    assert.match(
      findings[0],
      /runs `make`, and its target `(test|check)-e2e` installs Playwright's browsers in the Makefile/,
    );
  }
  const allowed = [
    "make build-server",
    "make lint build-server",
    "make -C site test-e2e",
    "echo make test-e2e later",
  ];
  for (const run of allowed) {
    const findings = installFindings(
      [workflow(".github/workflows/ci.fixture.yaml", run)],
      new Map(),
      targets,
    );
    assert.deepEqual(findings, [], `allowed: ${run}`);
  }
});

test("every form an install can take is refused", () => {
  const forms = [
    "npx playwright install --with-deps chromium",
    "npx playwright install chromium",
    "npx -y playwright@1.60.0 install chromium",
    "npm exec --workspace @stigmer/demos -- playwright install --with-deps chromium",
    "npx playwright install-deps chromium",
    "node node_modules/.bin/playwright install",
    "cd test/e2e && npx playwright install chromium",
    "npx @playwright/test install chromium",
    "npx playwright-core install --with-deps chromium",
    "npx playwright-core@1.60.0 install-deps",
    "npx @playwright/test@1.60.0 install --with-deps chromium",
    'bash -c "npx playwright install --with-deps chromium"',
    "sh -c 'npx playwright install'",
  ];
  for (const form of forms) {
    const findings = installFindings(
      [workflow(".github/workflows/ci.fixture.yaml", form)],
      new Map(),
    );
    assert.equal(findings.length, 1, `refused: ${form}`);
    assert.match(findings[0], /ci\.fixture\.yaml: job "suite", step "step 1"/);
    assert.match(findings[0], /use \.\/\.github\/actions\/playwright-chromium/);
  }
});

test("an install split across a continuation or inside a multi-line block is refused", () => {
  const split = "npx playwright \\\n  install --with-deps \\\n  chromium";
  const block = "echo before\nnpx playwright install chromium\necho after";
  for (const run of [split, block]) {
    const findings = installFindings(
      [workflow(".github/workflows/ci.fixture.yaml", run)],
      new Map(),
    );
    assert.equal(findings.length, 1, `refused: ${JSON.stringify(run)}`);
  }
});

test("running tests, other subcommands and prose are not installs", () => {
  const findings = installFindings(
    [
      workflow(
        ".github/workflows/ci.fixture.yaml",
        "npx playwright test --project=smoke --shard=${{ matrix.shard }}/2",
        "npx playwright show-report",
        'echo "playwright installs come from the action"',
      ),
    ],
    new Map(),
  );
  assert.deepEqual(findings, []);
});

test("a composite action's steps are read too", () => {
  const action = {
    file: ".github/actions/fixture/action.yml",
    doc: {
      runs: {
        using: "composite",
        steps: [
          {
            name: "browsers",
            run: "npx playwright install --with-deps chromium",
          },
        ],
      },
    },
  };
  const findings = installFindings([action], new Map());
  assert.equal(findings.length, 1);
  assert.match(findings[0], /fixture\/action\.yml: step "browsers"/);
});

test("the exemption covers its own file only, and states its reason", () => {
  assert.deepEqual(
    [...EXEMPT.keys()],
    [".github/workflows/release.website.yaml"],
  );
  for (const reason of EXEMPT.values())
    assert.match(reason, /two Playwright versions/);
  const install = "npx playwright install --with-deps chromium";
  assert.deepEqual(
    installFindings([
      workflow(".github/workflows/release.website.yaml", install),
    ]),
    [],
  );
  const elsewhere = installFindings([
    workflow(".github/workflows/release.website.yaml", install),
    workflow(".github/workflows/release.web.yaml", install),
  ]);
  assert.equal(elsewhere.length, 1);
  assert.match(elsewhere[0], /^\.github\/workflows\/release\.web\.yaml:/);
});

test("an exemption whose file no longer installs anything fails, so it cannot outlive its reason", () => {
  const stale = installFindings([
    workflow(".github/workflows/release.website.yaml", "npm run build"),
  ]);
  assert.equal(stale.length, 1);
  assert.match(
    stale[0],
    /release\.website\.yaml is exempt .* but installs no Playwright browser; remove its exemption/,
  );
  const missing = installFindings([]);
  assert.equal(missing.length, 1, "an exempt file that is gone is stale too");
});
