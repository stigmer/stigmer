/**
 * How CI gets Playwright's Chromium: the browser alone, proven to launch, under one deadline.
 *
 * Every gate job that drives a browser (the interactive, approval,
 * console-login and functional e2e jobs, and the browser-mode suite) needs
 * Playwright's headless Chromium. They used to run
 * `npx playwright install --with-deps chromium`, and `--with-deps` runs
 * `apt-get update` and `apt-get install` against Ubuntu's mirror. On
 * ubuntu-latest that fetched about 32 MB no test reads: the fonts
 * Playwright's own dependency table files under "tools", not under
 * "chromium", and upgrades of four mesa packages the image already carries.
 * Every library Chromium loads is already on the image. The mirror is
 * sometimes slow without failing: one install in twenty took 3 to 11 minutes
 * at 50 to 90 kB/s, the shape #1529 recorded for the Tauri packages. Once it
 * stopped answering inside `apt-get update` for 27 minutes, until the job was
 * cancelled and a change that broke nothing was ejected from the merge queue
 * (#1663).
 *
 * So this installs the browser alone, from Playwright's download host (about
 * 10 s), and then proves it: the same CLI's `screenshot` of about:blank is a
 * real headless launch through Playwright's launcher, the binary every gate
 * suite starts.
 *
 * The trade-offs:
 *   - A launch, not the install's warning. Without `--with-deps`, `install`
 *     only prints "Playwright Host validation warning" and exits 0 when a
 *     library is missing. The launcher is what throws, with the missing
 *     libraries in its message. Matching the warning's text would tie the
 *     gate to wording Playwright can change, and would prove less than a page
 *     opening does.
 *   - Nothing imported from Playwright. The repository root declares no
 *     Playwright; the gate's one copy is hoisted from the workspaces that do.
 *     The script runs the hoisted CLI, the one `npx playwright` reached
 *     before, so it does not depend on how npm laid the tree out.
 *   - One deadline over both phases, in the script. A composite action's
 *     steps cannot carry `timeout-minutes`. The same cap on every calling step
 *     would be copies a new caller could forget, with GitHub's generic
 *     message. Playwright retries a stalled socket by itself, but a trickle
 *     never stalls one, so the deadline is the only bound.
 *   - The process group, killed whole. Each phase runs in its own group, and
 *     the group is killed when the phase ends or the deadline passes. That
 *     takes Playwright's out-of-process downloader with it. The browser the
 *     probe launches is not in it: Playwright starts Chromium in a group of
 *     its own and drives it over a pipe, and Chromium exits when that pipe
 *     closes, which killing the CLI does. Measured on Ubuntu 24.04 and macOS
 *     with Playwright 1.60: no browser process was left 1.5 s after a SIGKILL
 *     of the CLI's group during a held-open launch.
 *   - No apt fallback. A missing library means the runner image changed: it
 *     fails here, named, once, and is fixed by installing the package that
 *     provides it in .github/actions/playwright-chromium, not by bringing
 *     back `--with-deps`.
 *
 * The guard half: installFindings reads every workflow and every composite
 * action and refuses a `run:` that installs Playwright's browsers any other
 * way, so the gate cannot drift back to the mirror. EXEMPT names the one file
 * that keeps its own install, with the reason, and an exemption whose file no
 * longer installs anything is refused too.
 *
 * .github/actions/playwright-chromium runs this file after the root `npm ci`.
 * scripts/playwright-chromium.test.mjs pins both halves: the installer
 * against a fake CLI, and the guard over the real files and over fixtures.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The whole step's bound: about 25 times the install and launch together on a hosted runner. */
export const DEADLINE_MS = 5 * 60 * 1000;

/** The action every job calls instead of installing Playwright's browsers itself. */
export const ACTION = "./.github/actions/playwright-chromium";

/** Files that may install Playwright's browsers their own way, each with its reason. */
export const EXEMPT = new Map([
  [
    ".github/workflows/release.website.yaml",
    "it provisions two Playwright versions on purpose, the root's and demos', each with its own Chromium " +
      "build (its comment above the two steps says why); it is a release lane, not a gate lane; and the stills " +
      "it renders ship, so the fonts it installs are its own decision",
  ],
]);

const PREFIX = "playwright-chromium:";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// `playwright install` or `install-deps`, however it is reached: npx or npm
// exec of `playwright`, `playwright-core` or `@playwright/test`, any of them
// pinned to a version, the bin by its path, or inside a quoted `bash -c "..."`.
const INSTALLS =
  /(?:^|[\s/"'])(?:@playwright\/test|playwright(?:-core)?)(?:@[^\s"']+)?\s+install(?:-deps)?(?=$|[\s;&|"'])/;

/** The checkout this runs in: GITHUB_WORKSPACE on a runner, and otherwise this repository. */
export function workspaceRoot(env = process.env) {
  return (
    env.GITHUB_WORKSPACE ||
    resolve(dirname(fileURLToPath(import.meta.url)), "..")
  );
}

/** The workspace's hoisted Playwright CLI, the one every gate suite resolves. */
export function playwrightCli(root) {
  return join(root, "node_modules", ".bin", "playwright");
}

/**
 * Installs Chromium, then proves it launches, all before the deadline.
 *
 * The CLI's output streams to `out` and `err` as it comes, so the job log
 * shows Playwright's own progress and errors. Returns a verdict:
 * `{ ok: true, seconds }`, or `{ ok: false, phase, ... }`, where the phase
 * is `setup`, `install` or `probe`. verdictMessage turns either into the
 * line the step ends on.
 */
export async function installChromium({
  cli,
  probeFile,
  deadlineMs = DEADLINE_MS,
  env = process.env,
  out = process.stdout,
  err = process.stderr,
}) {
  const started = Date.now();
  const deadline = started + deadlineMs;
  if (!existsSync(cli)) return { ok: false, phase: "setup", cli };

  const install = await runPhase(cli, ["install", "chromium"], deadline, {
    env,
    out,
    err,
  });
  if (!install.ok)
    return { ok: false, phase: "install", cli, deadlineMs, ...install };

  rmSync(probeFile, { force: true });
  const probe = await runPhase(
    cli,
    ["screenshot", "--browser", "chromium", "about:blank", probeFile],
    deadline,
    {
      env,
      out,
      err,
    },
  );
  if (!probe.ok)
    return { ok: false, phase: "probe", cli, deadlineMs, ...probe };
  if (!isPng(probeFile))
    return { ok: false, phase: "probe", cli, noPng: true, probeFile };

  return { ok: true, seconds: (Date.now() - started) / 1000 };
}

/**
 * Runs one CLI call in its own process group, streaming its output, and kills
 * the group when the call ends or the deadline passes.
 */
function runPhase(cli, args, deadline, { env, out, err }) {
  return new Promise((settle) => {
    let timedOut = false;
    let exit = { code: null, signal: null };
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(result);
    };

    const child = spawn(cli, args, {
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group is already gone.
      }
    };
    const timer = setTimeout(
      () => {
        timedOut = true;
        killGroup();
      },
      Math.max(0, deadline - Date.now()),
    );

    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(err, { end: false });
    child.on("error", (error) =>
      finish({ ok: false, error: error.message, timedOut }),
    );
    // A member that outlives the call could hold its pipes open: the group goes with the call.
    child.on("exit", (code, signal) => {
      exit = { code, signal };
      killGroup();
    });
    child.on("close", () =>
      finish({ ok: !timedOut && exit.code === 0, ...exit, timedOut }),
    );
  });
}

function isPng(file) {
  try {
    return readFileSync(file)
      .subarray(0, PNG_SIGNATURE.length)
      .equals(PNG_SIGNATURE);
  } catch {
    return false;
  }
}

function duration(ms) {
  return ms >= 60_000 && ms % 60_000 === 0
    ? `${ms / 60_000} minutes`
    : `${(ms / 1000).toFixed(1)} s`;
}

function ended({ code, signal }) {
  return signal ? `was killed by ${signal}` : `exited with code ${code}`;
}

/** The line the step ends on, for either verdict. */
export function verdictMessage(verdict) {
  if (verdict.ok)
    return `${PREFIX} chromium installed and launched in ${verdict.seconds.toFixed(1)} s`;
  const { phase } = verdict;
  if (phase === "setup")
    return `${PREFIX} ${verdict.cli} does not exist; run the root \`npm ci\` before this action`;
  if (verdict.timedOut) {
    const what = phase === "install" ? "install" : "launch";
    const where =
      phase === "install" ? "; Chromium downloads from cdn.playwright.dev" : "";
    return `${PREFIX} the ${what} did not finish within ${duration(verdict.deadlineMs)} and was stopped${where}`;
  }
  if (verdict.error)
    return `${PREFIX} could not run ${verdict.cli}: ${verdict.error}`;
  if (phase === "install")
    return `${PREFIX} \`playwright install chromium\` ${ended(verdict)}; its output is above`;
  if (verdict.noPng) {
    return (
      `${PREFIX} the launch probe exited 0 but wrote no PNG at ${verdict.probeFile}, ` +
      "so the CLI no longer does what this installer expects of it"
    );
  }
  return (
    `${PREFIX} Chromium was installed but did not launch: the screenshot probe ${ended(verdict)}. ` +
    "When Playwright's message above lists missing libraries, the runner image no longer ships what Chromium " +
    `needs; the fix is to install the packages that provide those libraries in ${ACTION}, ` +
    "not to bring back `--with-deps` (#1663)"
  );
}

/** A `run:` block's commands, one per line, with backslash continuations joined. */
function commandLines(run) {
  const lines = [];
  let pending = "";
  for (const line of run.split("\n")) {
    if (line.trimEnd().endsWith("\\")) {
      pending += line.trimEnd().slice(0, -1) + " ";
      continue;
    }
    lines.push(pending + line);
    pending = "";
  }
  if (pending) lines.push(pending);
  return lines;
}

/** Every step of a workflow's jobs or a composite action, with where it sits. */
function* stepsOf({ doc }) {
  const label = (step) => step?.name ?? step?.id ?? "unnamed";
  for (const [job, def] of Object.entries(doc?.jobs ?? {})) {
    for (const step of def?.steps ?? [])
      yield { where: `job "${job}", step "${label(step)}"`, step };
  }
  for (const step of doc?.runs?.steps ?? [])
    yield { where: `step "${label(step)}"`, step };
}

// make's options that take the next word as their argument.
const MAKE_OPTION_ARGS = new Set([
  "-f",
  "--file",
  "--makefile",
  "-I",
  "--include-dir",
  "-j",
  "-l",
  "-o",
  "-W",
]);

/**
 * The `make` targets a shell line runs from the repository's Makefile.
 *
 * `make` counts only as the command word of a command (after any leading
 * `VAR=value`), so `echo make x` runs nothing. `make -C <dir>` runs another
 * directory's Makefile and is left out.
 */
function makeTargetsRun(line) {
  const targets = [];
  for (const command of line.split(/&&|\|\||[;|&]/)) {
    const words = command.trim().split(/\s+/).filter(Boolean);
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))
      words.shift();
    if (words[0] !== "make" && words[0] !== "$(MAKE)") continue;
    if (words.some((word) => word === "-C" || word.startsWith("--directory")))
      continue;
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      if (MAKE_OPTION_ARGS.has(word)) {
        i++;
        continue;
      }
      if (word.startsWith("-") || word.includes("=")) continue;
      targets.push(word);
    }
  }
  return targets;
}

/**
 * The Makefile's targets whose recipes install Playwright's browsers,
 * directly or through a `$(MAKE) <target>` that does: a workflow that runs one
 * of them brings the install back the long way round.
 */
export function makeInstallTargets(makefile) {
  const direct = new Set();
  const calls = new Map();
  let current = [];
  const recipe = [];
  const close = () => {
    for (const line of commandLines(recipe.splice(0).join("\n"))) {
      for (const target of current) {
        if (INSTALLS.test(line)) direct.add(target);
        for (const called of makeTargetsRun(line.trim())) {
          if (!calls.has(target)) calls.set(target, new Set());
          calls.get(target).add(called);
        }
      }
    }
  };
  for (const line of makefile.split("\n")) {
    if (line.startsWith("\t")) {
      recipe.push(line.slice(1));
      continue;
    }
    const rule = /^([A-Za-z0-9][\w.%/ -]*?)\s*::?(?!=)/.exec(line);
    if (!rule) continue;
    close();
    current = rule[1].split(/\s+/).filter((target) => !target.startsWith("."));
  }
  close();
  const installing = new Set(direct);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [target, called] of calls) {
      if (installing.has(target) || ![...called].some((c) => installing.has(c)))
        continue;
      installing.add(target);
      grew = true;
    }
  }
  return installing;
}

/**
 * The guard: one sentence per `run:` line that installs Playwright's browsers
 * outside the action, itself or through one of `makeTargets` (the Makefile
 * targets that do, from makeInstallTargets), and one per exemption whose file
 * no longer installs any. `sources` are `{ file, doc }`, the file relative to
 * the repository root.
 */
export function installFindings(
  sources,
  exempt = EXEMPT,
  makeTargets = new Set(),
) {
  const findings = [];
  const installing = new Set();
  for (const source of sources) {
    for (const { where, step } of stepsOf(source)) {
      if (typeof step?.run !== "string") continue;
      for (const line of commandLines(step.run)) {
        const viaMake = makeTargetsRun(line.trim()).find((target) =>
          makeTargets.has(target),
        );
        if (!INSTALLS.test(line) && viaMake === undefined) continue;
        installing.add(source.file);
        if (exempt.has(source.file)) continue;
        const how =
          viaMake === undefined
            ? "which installs Playwright's browsers itself"
            : `and its target \`${viaMake}\` installs Playwright's browsers in the Makefile`;
        findings.push(
          `${source.file}: ${where} runs ${viaMake === undefined ? `\`${line.trim()}\`, ` : "`make`, "}${how}; ` +
            `use ${ACTION}, which installs Chromium without apt and proves it launches (#1663)`,
        );
      }
    }
  }
  for (const file of exempt.keys()) {
    if (installing.has(file)) continue;
    findings.push(
      `${file} is exempt from the Playwright install rule but installs no Playwright browser; ` +
        "remove its exemption from scripts/playwright-chromium.mjs",
    );
  }
  return findings;
}

/**
 * Every workflow and composite action under `root`'s .github, parsed.
 *
 * The YAML parser is loaded here, not at the top: the action runs this file
 * before anything has proven the root `npm ci` ran, so the installer half
 * imports only Node's built-ins and can say what is missing.
 */
export function readSources(root) {
  const { parse } = createRequire(import.meta.url)("yaml");
  const sources = [];
  const workflows = join(root, ".github", "workflows");
  for (const name of readdirSync(workflows).sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    const file = `.github/workflows/${name}`;
    sources.push({ file, doc: parse(readFileSync(join(root, file), "utf8")) });
  }
  const actions = join(root, ".github", "actions");
  for (const dir of readdirSync(actions, { withFileTypes: true }).filter((d) =>
    d.isDirectory(),
  )) {
    for (const name of ["action.yml", "action.yaml"]) {
      const file = `.github/actions/${dir.name}/${name}`;
      if (existsSync(join(root, file)))
        sources.push({
          file,
          doc: parse(readFileSync(join(root, file), "utf8")),
        });
    }
  }
  return sources;
}

async function main() {
  const cli = playwrightCli(workspaceRoot());
  const dir = mkdtempSync(
    join(process.env.RUNNER_TEMP || tmpdir(), "playwright-chromium-"),
  );
  try {
    const verdict = await installChromium({
      cli,
      probeFile: join(dir, "probe.png"),
    });
    const message = verdictMessage(verdict);
    if (verdict.ok) {
      console.log(message);
    } else {
      console.error(message);
      process.exitCode = 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
