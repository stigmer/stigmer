#!/usr/bin/env node

/**
 * Getting Started, run from the pages themselves: the quickstart
 * (docs/getting-started/quickstart.mdx) and the same job from code
 * (call-from-your-app.mdx), every file written and every command run as the
 * page shows it, in a fresh folder, on the "On your machine" tab. The pages
 * are read by test/install/lib/doc-steps.mjs; there is no copy of them here
 * to keep in step, so a page edit that breaks a step breaks this smoke.
 *
 * What it proves: a reader who installs the CLI and runs the quickstart gets
 * `stigmer up`, an applied Agent, a run that takes the ledger with
 * `--attach`, and the Agent's report in `out/` through `--download`; and a
 * reader who then writes the page's TypeScript gets it to typecheck (strict)
 * against the SDK as npm installs it, and to save the same report by
 * uploading the ledger, `sendAndWait` and the turn's Files.
 *
 * The harness performs the lines the page names as the install's
 * (doc-steps.mjs HARNESS_LINES): the CLI is the build under test, installed
 * in an isolated home by test/install/lib/install-cli.mjs (the boot the CLI
 * smoke shares); `npm install @stigmer/client` installs the SDK the same
 * build packs; the model key is the fake model's, handed to the shell `stigmer
 * up` starts from. Everything else, `stigmer up` included, runs as written,
 * through a `stigmer` on PATH that is that install.
 *
 * The model is test/support's fake, scripted per job: a conversation started
 * by a run gets its title first, from a model call of its own, so each job's
 * script is the title, then a `write_file` of the report into the outputs
 * folder, then a closing line. The report the pages must hand back is the
 * text that script saves.
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
 *   --docs=<dir>   read the two pages from <dir> instead of
 *       docs/getting-started (a scratch copy with a step broken is how the
 *       smoke is shown red).
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
import { fakeModelEnv, startFakeModel } from "./lib/fake-model.mjs";
import { CLI_SERVER_PORT, createCliInstall, spawnCommand } from "./lib/install-cli.mjs";
import { assertPortFree } from "./lib/stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SDK_PACKAGE = "@stigmer/client";
/** The version the source mode stamps on the packed SDK: never a published one. */
const SOURCE_SDK_VERSION = "0.0.0-getting-started";
// `stigmer up` may download the Temporal CLI and the runtimes; npm installs fetch from the registry.
const COMMAND_TIMEOUT_MS = 300_000;

/** What the scripted Agent saves: the report both pages must hand back, byte for byte. */
const REPORT = `# Q3 variance report

Marketing and cost of goods sold ran over budget; travel ran under.

| Account | Budget | Actual | Variance |
| --- | --- | --- | --- |
| Marketing | 9,000 | 14,100 | +56.7% |
| Travel | 3,000 | 1,200 | -60.0% |
`;
const REPORT_PATH = "out/variance-report.md";

function log(step) {
  console.log(`smoke-getting-started: ${step}`);
}

function usage(message) {
  console.error(`smoke-getting-started: ${message}`);
  process.exit(1);
}

function parseArgs() {
  const parsed = { published: false, version: "", sdkTarballs: "", docs: join(repoRoot, "docs", "getting-started") };
  for (const arg of process.argv.slice(2)) {
    let m;
    if (arg === "--published") parsed.published = true;
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) parsed.version = m[1].replace(/^v/, "");
    else if ((m = arg.match(/^--sdk-tarballs=(.+)$/)) !== null) parsed.sdkTarballs = resolve(m[1]);
    else if ((m = arg.match(/^--docs=(.+)$/)) !== null) parsed.docs = resolve(m[1]);
    else
      usage(
        `unknown argument: ${arg} (usage: node test/install/smoke-getting-started.mjs [--published --version=X.Y.Z] [--sdk-tarballs=<dir>] [--docs=<dir>])`,
      );
  }
  if (parsed.published && parsed.version === "") usage("--published requires --version=X.Y.Z (the published CLI and SDK)");
  if (!parsed.published && parsed.version !== "") usage("--version applies only with --published");
  if (parsed.published && parsed.sdkTarballs !== "") usage("--sdk-tarballs applies only to the source mode");
  return parsed;
}

// The job, as the fake model answers it: the conversation's title, the
// report saved in the outputs folder, a closing line.
function scriptTheJob(fake) {
  fake.enqueue({ kind: "anthropic", body: anthropicText("Q3 ledger variance review") });
  fake.enqueue({
    kind: "anthropic",
    body: anthropicToolUse("toolu_variance_report", "write_file", {
      file_path: "/.stigmer/outputs/variance-report.md",
      content: REPORT,
    }),
  });
  fake.enqueue({ kind: "anthropic", body: anthropicText("The variance report is saved as variance-report.md.") });
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

// The TypeScript compiler the page's code is checked with: the workspace's,
// or in the published mode (a checkout with no install) the same versions the
// workspace locks, installed beside the reader's folder, never into it.
async function typeChecker(args, scratch, run) {
  if (!args.published) {
    return {
      tsc: join(repoRoot, "node_modules", ".bin", "tsc"),
      typeRoots: join(repoRoot, "node_modules", "@types"),
    };
  }
  const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
  const pinned = (name) => `${name}@${lock.packages[`node_modules/${name}`].version}`;
  const tools = join(scratch, "tools");
  mkdirSync(tools, { recursive: true });
  await run(`npm install --no-save --prefix ${tools} ${pinned("typescript")} ${pinned("@types/node")}`, scratch);
  return { tsc: join(tools, "node_modules", ".bin", "tsc"), typeRoots: join(tools, "node_modules", "@types") };
}

const args = parseArgs();
const release = args.published ? { kind: "published", version: args.version } : { kind: "build" };

// Both pages must parse before anything starts: a page the harness cannot run fails here.
const pages = ["quickstart", "call-from-your-app"].map((name) => {
  const path = join(args.docs, `${name}.mdx`);
  return { name, steps: docSteps(readFileSync(path, "utf8")) };
});

try {
  await assertPortFree(CLI_SERVER_PORT);
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
}

const fake = await startFakeModel();
const stack = createCliInstall({ model: fakeModelEnv(fake), log });
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
  for (const page of pages) {
    log(`page ${page.name}: ${page.steps.length} steps`);
    rmSync(join(work, "out"), { recursive: true, force: true });
    scriptTheJob(fake);
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
        outputs.set(step.line, (await run(step.line)).stdout);
      }
    }
    assertReport(page.name);
  }
  if (!outputs.get(`cat ${REPORT_PATH}`)?.includes(REPORT.split("\n")[0])) {
    throw new Error(`\`cat ${REPORT_PATH}\` did not print the report`);
  }
  if (!outputs.get("npx tsx variance-report.ts")?.includes(`Saved ${REPORT_PATH}`)) {
    throw new Error(`variance-report.ts did not print that it saved ${REPORT_PATH}`);
  }
  log(`PASS (${fake.requests()} model calls)`);

  async function typecheck(files, runIn) {
    const { tsc, typeRoots } = await typeChecker(args, scratch, runIn);
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
  await fake.close();
  if (failed) log(`reader's folder kept for debugging: ${work}`);
  else rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

function assertReport(page) {
  const path = join(work, REPORT_PATH);
  if (!existsSync(path)) throw new Error(`${page}: the page's steps left no ${REPORT_PATH}`);
  const saved = readFileSync(path, "utf8");
  if (saved !== REPORT) throw new Error(`${page}: ${REPORT_PATH} is not the report the Agent saved:\n${saved}`);
  log(`${page}: ${REPORT_PATH} is the Agent's report`);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}
