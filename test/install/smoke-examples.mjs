#!/usr/bin/env node

/**
 * Every example agent under examples/, run from its folder as a developer
 * would: on `stigmer up` from source, each example's manifest is applied
 * with `stigmer apply -f`, its agent is run with its samples attached and
 * its first message (examples/catalogue.json), and the file its
 * instructions promise is downloaded into `out/`.
 *
 * Two modes, one script:
 *
 * - Offline (the gate's, `make smoke-examples`): the model is
 *   test/support's fake, scripted per example to save the promised file in
 *   the outputs folder. It proves the manifests apply, the samples attach,
 *   the run starts and the file comes back, on every change to an example.
 * - `--live-model` (`make smoke-examples-live`, in no lane): the agents run
 *   on a real model, pinned to the cheapest Stigmer-harness model with
 *   `stigmer run --model`, with the shell's ANTHROPIC_API_KEY; a missing key
 *   fails, never skips. It proves what a fake cannot: that each example's
 *   instructions, on its sample, make the file they promise. It asserts
 *   structure only (the file exists, is not empty, and names every item its
 *   sample holds), never a model's words.
 *
 * The catalogue is read as a file (the install layer imports only node:*,
 * its own files, test/support and scripts/), and each example's folder is
 * copied to a scratch folder so the run's `out/` lands there.
 *
 * `stigmer up` serves on port 7234, so the smoke refuses before anything
 * starts when that port is taken: another stack is running.
 *
 * Usage:
 *   node test/install/smoke-examples.mjs                 # offline, the fake model
 *   node test/install/smoke-examples.mjs --live-model    # a real model; spends money
 *   --only=<id>   run one example (its folder name)
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { anthropicText, anthropicToolUse } from "../support/src/llm-wire.ts";
import { LIVE_MODEL, fakeModelEnv, isTitleCall, liveModelEnv, startFakeModel } from "./lib/fake-model.mjs";
import { CLI_SERVER_PORT, createCliInstall, spawnCommand } from "./lib/install-cli.mjs";
import { assertPortFree } from "./lib/stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const examplesDir = join(repoRoot, "examples");
// `stigmer up` may download the Temporal CLI and the runtimes; a live turn takes a model's time.
const COMMAND_TIMEOUT_MS = 300_000;

/**
 * What each example's file must hold, by structure: every item its sample
 * holds is named (each account, each ticket, each mismatched line), or, for
 * the contract, a section per risky clause. Keyed by the example's id; an
 * example without an entry fails, so a new example brings its own.
 */
export const STRUCTURE = {
  "variance-report": (text) => missing(text, ["Revenue", "Cost of goods sold", "Salaries", "Marketing", "Software", "Travel"]),
  "ticket-replies": (text) => missing(text, ["T-1042", "T-1043", "T-1044", "T-1045", "T-1046", "T-1047", "T-1048", "T-1049"]),
  "contract-check": (text) => {
    const sections = text.split("\n").filter((line) => /^#{2,4}\s/.test(line)).length;
    return sections >= 4 ? [] : [`${sections} sections, fewer than the 4 risky clauses the sample holds at least`];
  },
  "invoice-match": (text) => missing(text, ["DSK-121", "CHR-310", "SRV-01"]),
};

/** The items `text` does not name. */
function missing(text, items) {
  return items.filter((item) => !text.includes(item)).map((item) => `does not name ${item}`);
}

/** What the fake model saves for an example in the offline mode: a file that keeps its structure. */
export function scriptedOutput(example) {
  const items = {
    "variance-report": ["Revenue", "Cost of goods sold", "Salaries", "Marketing", "Software", "Travel"],
    "ticket-replies": ["T-1042", "T-1043", "T-1044", "T-1045", "T-1046", "T-1047", "T-1048", "T-1049"],
    "contract-check": ["## 7. Liability", "## 8. Termination", "## 5. Ownership of work", "## 4. Term and renewal"],
    "invoice-match": ["DSK-121", "CHR-310", "SRV-01"],
  }[example.id];
  if (items === undefined) throw new Error(`${example.id}: no scripted output; add one beside STRUCTURE`);
  return [`# ${example.name}`, "", ...items.map((item) => (item.startsWith("#") ? `${item}\n` : `- ${item}`)), ""].join("\n");
}

function log(step) {
  console.log(`smoke-examples: ${step}`);
}

function usage(message) {
  console.error(`smoke-examples: ${message}`);
  process.exit(1);
}

function parseArgs() {
  const parsed = { live: false, only: "" };
  for (const arg of process.argv.slice(2)) {
    let m;
    if (arg === "--live-model") parsed.live = true;
    else if ((m = arg.match(/^--only=(.+)$/)) !== null) parsed.only = m[1];
    else usage(`unknown argument: ${arg} (usage: node test/install/smoke-examples.mjs [--live-model] [--only=<id>])`);
  }
  return parsed;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

// The example's job, as the fake model answers it: the conversation's
// title, the promised file saved in the outputs folder, a closing line.
function scriptTheJob(fake, example) {
  fake.enqueue({ kind: "anthropic", body: anthropicText(example.name), matches: isTitleCall });
  const turn = (request) => !isTitleCall(request);
  fake.enqueue({
    kind: "anthropic",
    matches: turn,
    body: anthropicToolUse(`toolu_${example.id.replaceAll("-", "_")}`, "write_file", {
      file_path: `/.stigmer/outputs/${example.output}`,
      content: scriptedOutput(example),
    }),
  });
  fake.enqueue({ kind: "anthropic", body: anthropicText(`Saved ${example.output}.`), matches: turn });
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) await main();

async function main() {
  const args = parseArgs();
  const catalogue = JSON.parse(readFileSync(join(examplesDir, "catalogue.json"), "utf8"));
  const examples = catalogue.examples.filter((example) => args.only === "" || example.id === args.only);
  if (examples.length === 0) usage(`no example ${JSON.stringify(args.only)} in examples/catalogue.json`);
  for (const example of examples) {
    if (STRUCTURE[example.id] === undefined) usage(`${example.id}: no structure check in STRUCTURE; a new example brings its own`);
  }

  let model;
  try {
    model = args.live ? liveModelEnv(process.env) : undefined;
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }
  try {
    await assertPortFree(CLI_SERVER_PORT);
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }

  const fake = args.live ? undefined : await startFakeModel();
  const stack = createCliInstall({ model: model ?? fakeModelEnv(fake), log });
  const scratch = mkdtempSync(join(tmpdir(), "stigmer-examples-"));
  log(`mode=${args.live ? `live (${LIVE_MODEL})` : "offline (fake model)"} scratch=${scratch}`);
  let failed = false;
  const report = [];

  try {
    await stack.install({ kind: "build" });
    const [stigmerBin, ...stigmerPrefix] = stack.command();
    const stigmer = [stigmerBin, ...stigmerPrefix].map(shellQuote).join(" ");
    const run = async (line, cwd) => {
      log(`$ ${line}`);
      const result = await spawnCommand(["bash", "-c", 'cd "$0" || exit 1; eval "$1"'], [cwd, line], stack.env, COMMAND_TIMEOUT_MS).done;
      if (result.error !== undefined || result.status !== 0) {
        throw new Error(`${line} failed (${result.error?.message ?? `exit ${result.status}`})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      }
      return result;
    };
    await run(`${stigmer} up`, scratch);

    for (const example of examples) {
      const folder = join(scratch, example.id);
      cpSync(join(examplesDir, example.id), folder, { recursive: true });
      const slug = /^\s*name:\s*(\S+)/m.exec(readFileSync(join(folder, example.manifest), "utf8"))?.[1];
      if (slug === undefined) throw new Error(`${example.id}: ${example.manifest} names no agent`);
      if (fake !== undefined) scriptTheJob(fake, example);
      await run(`${stigmer} apply -f ${shellQuote(example.manifest)}`, folder);
      const attach = example.samples.map((sample) => `--attach ${shellQuote(sample)}`).join(" ");
      const pin = args.live ? ` --model ${LIVE_MODEL}` : "";
      const started = Date.now();
      await run(`${stigmer} run ${slug} ${attach} --download ./out --until turn${pin} -m ${shellQuote(example.message)}`, folder);
      const path = join(folder, "out", example.output);
      if (!existsSync(path)) throw new Error(`${example.id}: the run left no out/${example.output}`);
      const text = readFileSync(path, "utf8");
      if (text.trim() === "") throw new Error(`${example.id}: out/${example.output} is empty`);
      if (fake !== undefined && text !== scriptedOutput(example)) {
        throw new Error(`${example.id}: out/${example.output} is not the file the agent saved:\n${text}`);
      }
      const problems = STRUCTURE[example.id](text);
      if (problems.length > 0) throw new Error(`${example.id}: out/${example.output} ${problems.join("; ")}:\n${text}`);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      report.push(`${example.id}: out/${example.output}, ${text.length} bytes, ${seconds} s`);
      log(`${example.id}: out/${example.output} came back (${text.length} bytes, ${seconds} s)`);
      if (args.live) console.log(`----- ${example.id}/out/${example.output} -----\n${text}\n-----`);
      rmSync(join(folder, "out"), { recursive: true, force: true });
    }
    log(`PASS: ${report.length} examples${fake !== undefined ? ` (${fake.requests()} model calls)` : ""}\n  ${report.join("\n  ")}`);
  } catch (error) {
    failed = true;
    console.error(`smoke-examples: ${error instanceof Error ? error.message : String(error)}`);
    console.error(stack.diagnostics());
  } finally {
    await stack.stop({ keepHome: failed });
    await fake?.close();
    if (failed) log(`scratch kept for debugging: ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}
