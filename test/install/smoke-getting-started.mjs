#!/usr/bin/env node

/**
 * Getting Started, run from the pages themselves: the quickstart
 * (docs/getting-started/quickstart.mdx), the same job from code
 * (call-from-your-app.mdx) and making the Agent yours (make-it-yours.mdx),
 * every file written and every command run as the page shows it, in one
 * fresh folder, on the "On your machine" tab, in that order. The pages are
 * read by test/install/lib/doc-steps.mjs; there is no copy of them here to
 * keep in step, so a page edit that breaks a step breaks this smoke.
 *
 * What it proves: a reader who installs the CLI and runs the quickstart gets
 * `stigmer up`, an applied Agent, a run that takes the ledger with
 * `--attach`, and the Agent's report in `out/` through `--download`; a
 * reader who then writes the page's TypeScript gets it to typecheck (strict)
 * against the SDK as npm installs it, and to save the same report by
 * uploading the ledger, `sendAndWait` and the turn's Files; and a reader who
 * then makes the Agent theirs sees its changed definition listed as a second
 * version, runs it on a ledger of their own, pushes the page's Skill and
 * gives it to the Agent, and the run after that records the Skill among what
 * it loaded (`RunStatus.loaded_versions`, read back with `stigmer get run`)
 * and hands back the CSV the Skill asks for beside the report.
 *
 * The pages' lines run through `bash -c`, off a terminal. The quickstart's
 * `stigmer run` line runs once more on a pseudo-terminal
 * (test/install/lib/pty-run.py), as a person types it: the live view draws,
 * and the line must return by itself, exit 0, with the report saved in
 * `out/` (stigmer#2595: before `--until turn` it sat at the reply box, and
 * `--download` saved nothing until the person left).
 *
 * The harness performs the lines the page names as the install's
 * (doc-steps.mjs HARNESS_LINES): the CLI is the build under test, installed
 * in an isolated home by test/install/lib/install-cli.mjs (the boot the CLI
 * smoke shares); `npm install @stigmer/client` installs the SDK the same
 * build packs; the model key is the fake model's, handed to the shell `stigmer
 * up` starts from. Everything else, `stigmer up` included, runs as written,
 * through a `stigmer` on PATH that is that install.
 *
 * The model is test/support's fake, scripted per job (each `stigmer run`
 * line, and the code page's `npx tsx` line): the conversation's title, then
 * a `write_file` of the report into the outputs folder, then a closing line;
 * a job run after the page pushed its Skill also writes the CSV. A
 * conversation a run starts is titled by a model call the runner makes
 * beside the turn, in no fixed order, so the title's answer goes only to the
 * call whose system prompt is the title generator's, and the turn's answers
 * only to the others. The report the pages must hand back is the text that
 * script saves. The fake proves the pages run and the Skill reaches the run;
 * whether a model follows the Skill is what `--live-model` shows.
 *
 * `stigmer up` serves on port 7234, so the smoke refuses before anything
 * starts when that port is taken: another stack is running.
 *
 * Usage:
 *   node test/install/smoke-getting-started.mjs
 *       The CLI from source and the SDK packed from this checkout by
 *       scripts/publish-libs.mjs (the gate's mode; `make
 *       smoke-getting-started` builds what the source CLI needs).
 *   node test/install/smoke-getting-started.mjs --published --version=X.Y.Z
 *       The published CLI through site/public/install.sh, and
 *       @stigmer/client@X.Y.Z from npm: what a reader installs (the
 *       release runs this after it publishes).
 *   --sdk-tarballs=<dir>   source mode: install the SDK from tarballs
 *       already packed there (publish-libs.mjs --pack-dir) instead of
 *       packing them.
 *   --docs=<dir>   read the pages from <dir> instead of
 *       docs/getting-started (a scratch copy with a step broken is how the
 *       smoke is shown red).
 *   --live-model   (`make smoke-getting-started-live`, in no lane) the
 *       pages run on a real model with the shell's ANTHROPIC_API_KEY (a
 *       missing key fails, never skips; it spends money), each `stigmer run`
 *       line pinned with `--model` to the cheapest Stigmer-harness model, as
 *       smoke-examples.mjs pins it. It asserts structure only, never a
 *       model's words: each report names every account of the ledger it was
 *       given, and the run after the Skill hands back a non-empty
 *       `variance-report.csv` that opens with a header row.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { configuredRegistry, installGap, waitForRegistry } from "../../scripts/publish-standalone.mjs";
import { anthropicText, anthropicToolUse } from "../support/src/llm-wire.ts";
import { docSteps } from "./lib/doc-steps.mjs";
import { LIVE_MODEL, fakeModelEnv, isTitleCall, liveModelEnv, startFakeModel } from "./lib/fake-model.mjs";
import { CLI_SERVER_PORT, createCliInstall, spawnCommand } from "./lib/install-cli.mjs";
import { assertPortFree } from "./lib/stigmer-smoke.mjs";
import { typeChecker } from "./lib/type-checker.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SDK_PACKAGE = "@stigmer/client";
/** The version the source mode stamps on the packed SDK: never a published one. */
const SOURCE_SDK_VERSION = "0.0.0-getting-started";
// `stigmer up` may download the Temporal CLI and the runtimes; npm installs fetch from the registry.
const COMMAND_TIMEOUT_MS = 300_000;
const PTY_RUN = join(repoRoot, "test", "install", "lib", "pty-run.py");

/** What the scripted Agent saves: the report both pages must hand back, byte for byte. */
const REPORT = `# Q3 variance report

Marketing and cost of goods sold ran over budget; travel ran under.

| Account | Budget | Actual | Variance |
| --- | --- | --- | --- |
| Marketing | 9,000 | 14,100 | +56.7% |
| Travel | 3,000 | 1,200 | -60.0% |
`;
const REPORT_PATH = "out/variance-report.md";

/** What the scripted Agent saves once it has the Skill: the report's table as the Skill's CSV. */
const CSV = `account,budget,actual,variance,variance_pct
Marketing,9000,14100,5100,56.7
Travel,3000,1200,-1800,-60.0
`;
const CSV_PATH = "out/variance-report.csv";

/** The Skill make-it-yours.mdx writes and pushes, by the name its frontmatter gives it. */
const SKILL = "spreadsheet-export";

/** Every account in each ledger the pages hand over (the sample and make-it-yours.mdx's own): a live report names them all. */
const ACCOUNTS = ["Revenue", "Cost of goods sold", "Salaries", "Marketing", "Software", "Travel"];

/** The pages, in the order a reader takes them, in one folder. */
const PAGES = ["quickstart", "call-from-your-app", "make-it-yours"];

function log(step) {
  console.log(`smoke-getting-started: ${step}`);
}

function usage(message) {
  console.error(`smoke-getting-started: ${message}`);
  process.exit(1);
}

function parseArgs() {
  const parsed = { published: false, version: "", sdkTarballs: "", docs: join(repoRoot, "docs", "getting-started"), live: false };
  for (const arg of process.argv.slice(2)) {
    let m;
    if (arg === "--published") parsed.published = true;
    else if (arg === "--live-model") parsed.live = true;
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) parsed.version = m[1].replace(/^v/, "");
    else if ((m = arg.match(/^--sdk-tarballs=(.+)$/)) !== null) parsed.sdkTarballs = resolve(m[1]);
    else if ((m = arg.match(/^--docs=(.+)$/)) !== null) parsed.docs = resolve(m[1]);
    else
      usage(
        `unknown argument: ${arg} (usage: node test/install/smoke-getting-started.mjs [--published --version=X.Y.Z] [--sdk-tarballs=<dir>] [--docs=<dir>] [--live-model])`,
      );
  }
  if (parsed.published && parsed.version === "") usage("--published requires --version=X.Y.Z (the published CLI and SDK)");
  if (!parsed.published && parsed.version !== "") usage("--version applies only with --published");
  if (parsed.published && parsed.sdkTarballs !== "") usage("--sdk-tarballs applies only to the source mode");
  return parsed;
}

// The job, as the fake model answers it: the conversation's title, the
// report saved in the outputs folder, the Skill's CSV beside it once the
// Agent has the Skill, a closing line.
function scriptTheJob(fake, { csv }) {
  fake.enqueue({ kind: "anthropic", body: anthropicText("Q3 ledger variance review"), matches: isTitleCall });
  const turn = (request) => !isTitleCall(request);
  fake.enqueue({
    kind: "anthropic",
    matches: turn,
    body: anthropicToolUse("toolu_variance_report", "write_file", {
      file_path: "/.stigmer/outputs/variance-report.md",
      content: REPORT,
    }),
  });
  if (csv) {
    fake.enqueue({
      kind: "anthropic",
      matches: turn,
      body: anthropicToolUse("toolu_variance_csv", "write_file", {
        file_path: "/.stigmer/outputs/variance-report.csv",
        content: CSV,
      }),
    });
  }
  fake.enqueue({ kind: "anthropic", body: anthropicText("The variance report is saved as variance-report.md."), matches: turn });
}

/** Whether a page's command starts a job the model answers: a run from the terminal, or the code page's program. */
function startsJob(line) {
  return line.startsWith("stigmer run ") || line.startsWith("npx tsx ");
}

// The SDK a reader's `npm install @stigmer/client` gets: this build's
// package and its @stigmer/* closure as the tarballs a release would upload,
// or the published version.
function sdkInstallArgs(args, scratch) {
  if (args.published) return [`${SDK_PACKAGE}@${args.version}`];
  let dir = args.sdkTarballs;
  if (dir === "") {
    dir = join(scratch, "sdk-tarballs");
    log(`packing ${SDK_PACKAGE} and its @stigmer/* closure into ${dir}`);
    // Inherited stdio: packing builds every library, and its progress is the log a failure needs.
    const packed = spawnSync(
      process.execPath,
      [join(repoRoot, "scripts", "publish-libs.mjs"), "--version", SOURCE_SDK_VERSION, "--pack-dir", dir, "--only", SDK_PACKAGE],
      { cwd: repoRoot, stdio: "inherit" },
    );
    if (packed.status !== 0) throw new Error(`publish-libs.mjs --pack-dir exited ${packed.status ?? packed.signal}`);
  }
  const tarballs = readdirSync(dir)
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => join(dir, name));
  if (tarballs.length === 0) throw new Error(`no SDK tarballs in ${dir}`);
  return tarballs;
}

const args = parseArgs();
const release = args.published ? { kind: "published", version: args.version } : { kind: "build" };

// Every page must parse before anything starts: a page the harness cannot run fails here.
const pages = PAGES.map((name) => {
  const path = join(args.docs, `${name}.mdx`);
  return { name, steps: docSteps(readFileSync(path, "utf8")) };
});

try {
  await assertPortFree(CLI_SERVER_PORT);
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
}

let liveModel;
try {
  liveModel = args.live ? liveModelEnv(process.env) : undefined;
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
}
const fake = args.live ? undefined : await startFakeModel();
const stack = createCliInstall({ model: liveModel ?? fakeModelEnv(fake), log });
log(`mode=${args.live ? `live (${LIVE_MODEL})` : "offline (fake model)"}`);
const scratch = mkdtempSync(join(tmpdir(), "stigmer-getting-started-"));
const work = join(scratch, "reader");
mkdirSync(work, { recursive: true });
log(`reader's folder=${work}`);
let failed = false;

try {
  // Packed before anything starts: publish-libs.mjs cleans and rebuilds every
  // library, which must not happen under a running stack.
  const sdkTargets = sdkInstallArgs(args, scratch);
  await stack.install(release);

  // The reader's shell: the install's environment, `stigmer` on PATH as that
  // install, npm's cache shared with this machine's (the isolated home would
  // otherwise download every dependency afresh), and npx answering its own
  // install prompt as a reader would.
  const bin = join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  const [stigmerBin, ...stigmerPrefix] = stack.command();
  writeFileSync(
    join(bin, "stigmer"),
    `#!/bin/sh\nexec ${[stigmerBin, ...stigmerPrefix].map(shellQuote).join(" ")} "$@"\n`,
    { mode: 0o755 },
  );
  const shell = {
    ...stack.env,
    PATH: `${bin}:${stack.env.PATH ?? ""}`,
    npm_config_cache: process.env.npm_config_cache ?? join(homedir(), ".npm"),
    npm_config_yes: "true",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
  if (args.published) {
    const registry = configuredRegistry();
    await waitForRegistry([SDK_PACKAGE], args.version, { gapOf: (name, version) => installGap(name, version, { registry }), log });
  }

  const run = async (line, cwd = work) => {
    log(`$ ${line}`);
    const result = await spawnCommand(["bash", "-c", 'cd "$0" || exit 1; eval "$1"'], [cwd, line], shell, COMMAND_TIMEOUT_MS).done;
    if (result.error !== undefined || result.status !== 0) {
      throw new Error(
        `the page's command failed: ${line} (${result.error?.message ?? `exit ${result.status}`})\n` +
          `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    return result;
  };

  const performs = {
    cli: async () => log("CLI install: the build under test is installed in the isolated home"),
    "model-key": async () => log("model key: the fake model's key and address are in the shell"),
    sdk: async () => run(`npm install ${sdkTargets.map(shellQuote).join(" ")}`),
  };

  const outputs = new Map();
  const typeScriptFiles = [];
  // Set once a page pushes the Skill: the jobs after it hand back its CSV.
  let skillPushed = false;
  for (const page of pages) {
    log(`page ${page.name}: ${page.steps.length} steps`);
    rmSync(join(work, "out"), { recursive: true, force: true });
    for (const step of page.steps) {
      if (step.kind === "file") {
        log(`write ${step.path}`);
        const path = join(work, step.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, step.content);
        if (step.path.endsWith(".ts")) typeScriptFiles.push(path);
      } else if (step.kind === "harness") {
        await performs[step.performs]();
      } else {
        if (step.line.startsWith("npx tsx ")) await typecheck(typeScriptFiles, run);
        if (fake !== undefined && startsJob(step.line)) scriptTheJob(fake, { csv: skillPushed });
        outputs.set(step.line, (await run(livePinned(step.line))).stdout);
        if (step.line.startsWith(`stigmer push skill `)) skillPushed = true;
      }
    }
    assertReport(page.name);
    if (page.name === "make-it-yours") await assertMadeYours(page);
  }
  await runOnTerminal(pages[0]);
  if (!(outputs.get(`cat ${REPORT_PATH}`) ?? "").includes(args.live ? ACCOUNTS[0] : REPORT.split("\n")[0])) {
    throw new Error(`\`cat ${REPORT_PATH}\` did not print the report`);
  }
  if (!outputs.get("npx tsx variance-report.ts")?.includes(`Saved ${REPORT_PATH}`)) {
    throw new Error(`variance-report.ts did not print that it saved ${REPORT_PATH}`);
  }
  log(`PASS (${fake !== undefined ? `${fake.requests()} model calls` : `live, ${LIVE_MODEL}`})`);

  // A page's `stigmer run` line as it runs: as written, or, live, pinned to
  // the cheapest model (the line is the page's; only the model is the smoke's).
  function livePinned(line) {
    return args.live && line.startsWith("stigmer run ") ? `${line} --model ${LIVE_MODEL}` : line;
  }

  // Make it yours, past its report: the changed Agent is a second version,
  // the run after the Skill was given records the Skill among what it
  // loaded, and the Skill's CSV came back beside the report.
  async function assertMadeYours(page) {
    const history = page.steps.find((step) => step.kind === "command" && step.line.includes("--version-history"))?.line;
    if (history === undefined) throw new Error(`${page.name}: no \`--version-history\` line`);
    if (!outputs.get(history)?.includes("Version History (2)")) {
      throw new Error(`${page.name}: \`${history}\` did not list two versions:\n${outputs.get(history)}`);
    }
    log(`${page.name}: the changed Agent is listed as its second version`);

    // The newest run is the page's last, the one after the Skill was given.
    const runs = JSON.parse((await run("stigmer list runs --limit 1 -o json")).stdout);
    const runId = runs.entries?.[0]?.metadata?.id;
    if (typeof runId !== "string" || runId === "") throw new Error(`${page.name}: \`stigmer list runs\` named no run`);
    const ran = JSON.parse((await run(`stigmer get run ${shellQuote(runId)} -o json`)).stdout);
    const skill = JSON.parse((await run(`stigmer get skill ${SKILL} -o json`)).stdout);
    const skillId = skill.metadata?.id;
    const loaded = ran.status?.loaded_versions?.skills ?? [];
    if (typeof skillId !== "string" || !loaded.some((entry) => entry.id === skillId)) {
      throw new Error(`${page.name}: run ${runId} does not record ${SKILL} (${skillId}) among the skills it loaded: ${JSON.stringify(loaded)}`);
    }
    log(`${page.name}: run ${runId} loaded ${SKILL}`);

    const csvPath = join(work, CSV_PATH);
    if (!existsSync(csvPath)) throw new Error(`${page.name}: the run after the Skill left no ${CSV_PATH}`);
    const csv = readFileSync(csvPath, "utf8");
    if (args.live) {
      const header = csv.split("\n")[0] ?? "";
      if (!header.includes(",") || !/account/i.test(header)) {
        throw new Error(`${page.name}: ${CSV_PATH} does not open with a header row:\n${csv}`);
      }
      console.log(`----- ${CSV_PATH} -----\n${csv}\n-----`);
    } else if (csv !== CSV) {
      throw new Error(`${page.name}: ${CSV_PATH} is not the CSV the Agent saved:\n${csv}`);
    }
    log(`${page.name}: ${CSV_PATH} came back beside the report`);
  }

  // The quickstart's run line on a pseudo-terminal, as a person types it: it
  // returns by itself once the turn ends, exit 0, with the report saved.
  async function runOnTerminal(page) {
    const line = page.steps.find((step) => step.kind === "command" && step.line.startsWith("stigmer run "))?.line;
    if (line === undefined) throw new Error(`${page.name}: no \`stigmer run\` line to run on a terminal`);
    rmSync(join(work, "out"), { recursive: true, force: true });
    if (fake !== undefined) scriptTheJob(fake, { csv: false });
    const env = { ...shell, TERM: "xterm-256color" };
    delete env.CI;
    delete env.CONTINUOUS_INTEGRATION;
    log(`$ ${line}   (on a terminal)`);
    const result = await spawnCommand(
      ["python3", PTY_RUN, "--timeout", "240", "--cols", "100", "--"],
      ["bash", "-c", 'cd "$0" || exit 1; eval "$1"', work, livePinned(line)],
      env,
      COMMAND_TIMEOUT_MS,
    ).done;
    if (result.status !== 0) {
      throw new Error(`${page.name}: on a terminal, \`${line}\` exited ${result.status ?? result.error?.message}:\n${result.stdout.slice(-4000)}\n${result.stderr}`);
    }
    assertReport(`${page.name} on a terminal`);
    log(`${page.name}: on a terminal the run line returned by itself, exit 0`);
  }

  async function typecheck(files, runIn) {
    // The page's code is checked with the workspace's compiler, or in the
    // published mode the locked one installed beside the reader's folder.
    const { tsc, typeRoots } = await typeChecker({ repoRoot, published: args.published, scratch, run: runIn });
    const tsconfig = join(scratch, "tsconfig.json");
    writeFileSync(
      tsconfig,
      JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: "es2022",
            module: "nodenext",
            moduleResolution: "nodenext",
            // The reader's code is checked whole; the installed packages' own declarations are theirs.
            skipLibCheck: true,
            types: ["node"],
            typeRoots: [typeRoots],
          },
          files,
        },
        null,
        2,
      ),
    );
    await runIn(`${shellQuote(tsc)} -p ${shellQuote(tsconfig)}`);
    log(`typechecked ${files.length} files (strict)`);
  }
} catch (error) {
  failed = true;
  console.error(`smoke-getting-started: ${error instanceof Error ? error.message : String(error)}`);
  console.error(stack.diagnostics());
} finally {
  await stack.stop({ keepHome: failed });
  await fake?.close();
  if (failed) log(`reader's folder kept for debugging: ${work}`);
  else rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

function assertReport(page) {
  const path = join(work, REPORT_PATH);
  if (!existsSync(path)) throw new Error(`${page}: the page's steps left no ${REPORT_PATH}`);
  const saved = readFileSync(path, "utf8");
  if (args.live) {
    // A model's words differ run to run: the report must name every account.
    const unnamed = ACCOUNTS.filter((account) => !saved.includes(account));
    if (unnamed.length > 0) throw new Error(`${page}: ${REPORT_PATH} does not name ${unnamed.join(", ")}:\n${saved}`);
    console.log(`----- ${page}: ${REPORT_PATH} -----\n${saved}\n-----`);
    log(`${page}: ${REPORT_PATH} names every account`);
    return;
  }
  if (saved !== REPORT) throw new Error(`${page}: ${REPORT_PATH} is not the report the Agent saved:\n${saved}`);
  log(`${page}: ${REPORT_PATH} is the Agent's report`);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}
