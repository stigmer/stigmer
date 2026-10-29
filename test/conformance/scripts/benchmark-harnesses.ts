// Measures the native and Claude harnesses against REAL providers and writes
// the report the harness work is judged on
// (`make benchmark-harnesses`; `npm run benchmark:harnesses -- <flags>`).
// Domain: conformance benchmark (the live instrument's entrypoint).
//
// THIS IS AN EXPERIMENT, NOT A TEST. It makes live model calls and spends
// real money: at the defaults, twelve scenarios on each of two harnesses, one warm-up
// plus five samples each, three turns per sample on the four three-turn
// scenarios (the bare turn-2 cell and the working agent's read-edit,
// cross-turn and long-log cells) — 120 executions a harness — plus the quality arm: one
// eval run of the working agent's eleven cases, three tries per case on each
// harness, the AI-graded checks judged by three votes each. It is in no vitest
// config and `npm test` cannot reach it. Its numbers are a new baseline for the
// machine, the model versions and the runner they were taken on, compared only
// across arms of one instrument commit, machine and day, as `benchmark-compare`
// enforces (`npm run benchmark:compare`); an arm is a model on one version of
// the code. They are internal: the benchmark's numbers never
// appear on the docs site (`.agents/skills/docs-writing/SKILL.md` carries the
// rule under "What to refuse").
//
// Needs: the `temporal` CLI on PATH (the dev server backs the stack);
// ANTHROPIC_API_KEY for the judge, a Claude native model and the Claude cells
// (the runner's own key, in this direct mode); OPENAI_API_KEY for
// an OpenAI-provider native model (`--stigmer-model openai:<name>`, or a `gpt*`
// catalog id), with OPENAI_BASE_URL when that model is served on another
// OpenAI-compatible address (Google's, a router's); the `stigmer` CLI on
// PATH for every timing cell on the working agent (its memory spawns
// `stigmer mcp-server`; `make install-cli-shim`); `go` on PATH for the quality cases that run `go test`
// and the background cells (whose Go test cache the run clears before each
// attempt); `lsof` and `ps` on PATH, with which every working-agent attempt
// finds the processes it left running and stops them; the network. A missing key or CLI refuses the cells that need it BY NAME in
// the report and the run goes on with the rest. The working agent's
// workspace is seeded outside the repository (the OS temp directory); nothing
// is written into the tree. Thin over src/benchmark/ (the lib/script split of
// check-inventory.ts): flags and the environment here, the driver there.
//
// Flags:
//   --reps N                 warm samples per cell (default 5; odd keeps the median an observed sample)
//   --quality-reps N         tries per quality case per harness (default 3)
//   --cells <glob>           run only cells whose id matches (`report-parity-*`, `*/claude`)
//   --only stigmer|claude    one harness
//   --stigmer-model <id>     the native arm's model instead of the parity pin: a catalog id, or the own-endpoint
//                            form openai:<name> / anthropic:<name>; the native default cells are refused, and the
//                            report records the host, API and cost basis it ran on. Not with --only claude.
//   --stack <checkout>       boot that stigmer checkout's server and runner (built there first: `npm ci`,
//                            `make build-runner build-server`) instead of this tree's; this tree stays the
//                            instrument, so its clients and readers measure both alike. The report records
//                            the checkout's HEAD as `git.code_sha`. Refused when the path is no checkout.
//   --shell-background on|off  whether the runner lets the native agent start commands in the background (default
//                            on; off sets the runner's STIGMER_SHELL_BACKGROUND_ENABLED=false): the arm, recorded on
//                            the report, which benchmark-compare reads as an arm of its own
//   --pr N                   the pull request the measuring checkout belongs to, recorded on the report
//   --thinking enabled       every execution asks for thinking (the judge's does not); the cells on a
//                            harness's default model are refused, since the server refuses thinking on Auto
//   --out <dir>              where the report lands (default: .test-output/benchmark-harnesses)
//   --judge-tries N          with --cells judge/*, tries per judge example (default 3)
//   --judge-concurrency N    with --cells judge/*, judge runs in flight at once (default 4)
//   --judge-budget-usd N     with --cells judge/*, the most the calibration may spend (default 25);
//                            it stops launching tries before passing it, and says so
//   --write-calibration      with --cells judge/*, write the counts to src/benchmark/judge/calibration.ts
//
// The judge cell (`--cells judge/*`) grades the AI judge's example set on the
// platform's default model through the judge's real path, prints each rubric's
// counts, the misses and any shortfall against the bar, and writes its own
// report (`judge-<stamp>.json`, misses included) beside the benchmark's. It
// runs only when `--cells` names it.
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { nativeApi, nativeEndpoint, planCells, type PlanFlags } from "../src/benchmark/cells";
import { runJudgeCalibration } from "../src/benchmark/judge/calibrate";
import { renderCalibrationModule, shortfallsOf } from "../src/benchmark/judge/calibration-tally";
import { JUDGE_EXAMPLES } from "../src/benchmark/judge/examples";
import { bootBenchmarkStack, renderSummary, resolveStackRoot, runBenchmark, writeReport } from "../src/benchmark/run";
import { HARNESSES, type BenchmarkReport, type ShellBackground } from "../src/benchmark/report";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const DEFAULT_OUT = resolve(PACKAGE_ROOT, ".test-output", "benchmark-harnesses");
const DEFAULT_REPS = 5;
const DEFAULT_QUALITY_REPS = 3;
const DEFAULT_JUDGE_TRIES = 3;
const DEFAULT_JUDGE_CONCURRENCY = 4;
const DEFAULT_JUDGE_BUDGET_USD = 25;
const CALIBRATION_MODULE = resolve(PACKAGE_ROOT, "src", "benchmark", "judge", "calibration.ts");

interface Flags extends PlanFlags {
  reps: number;
  qualityReps: number;
  out: string;
  pr: number | undefined;
  /** `--stack`: the checkout whose server and runner are measured, as given. */
  stack: string | undefined;
  judgeTries: number;
  judgeConcurrency: number;
  judgeBudgetUsd: number;
  writeCalibration: boolean;
  shellBackground: ShellBackground;
}

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = {
    reps: DEFAULT_REPS,
    qualityReps: DEFAULT_QUALITY_REPS,
    out: DEFAULT_OUT,
    pr: undefined,
    stack: undefined,
    judgeTries: DEFAULT_JUDGE_TRIES,
    judgeConcurrency: DEFAULT_JUDGE_CONCURRENCY,
    judgeBudgetUsd: DEFAULT_JUDGE_BUDGET_USD,
    writeCalibration: false,
    shellBackground: "on",
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      i++;
      return next;
    };
    switch (flag) {
      case "--reps": {
        const reps = Number(value());
        if (!Number.isInteger(reps) || reps < 1) throw new Error("--reps needs a positive integer");
        flags.reps = reps;
        break;
      }
      case "--quality-reps": {
        const qualityReps = Number(value());
        if (!Number.isInteger(qualityReps) || qualityReps < 1) throw new Error("--quality-reps needs a positive integer");
        flags.qualityReps = qualityReps;
        break;
      }
      case "--cells":
        flags.cells = value();
        break;
      case "--only": {
        const only = value();
        const harness = HARNESSES.find((candidate) => candidate === only);
        if (harness === undefined) throw new Error(`--only needs ${HARNESSES.join(", ")}`);
        flags.only = harness;
        break;
      }
      case "--stigmer-model": {
        const model = value().trim();
        if (model === "") throw new Error("--stigmer-model needs a model id");
        flags.nativeModel = model;
        break;
      }
      case "--thinking": {
        const mode = value();
        if (mode !== "enabled") throw new Error("--thinking needs enabled");
        flags.thinking = mode;
        break;
      }
      case "--shell-background": {
        const arm = value();
        if (arm !== "on" && arm !== "off") throw new Error("--shell-background needs on or off");
        flags.shellBackground = arm;
        break;
      }
      case "--pr": {
        const pr = Number(value());
        if (!Number.isInteger(pr) || pr < 1) throw new Error("--pr needs a positive integer");
        flags.pr = pr;
        break;
      }
      case "--out":
        flags.out = resolve(value());
        break;
      case "--stack":
        flags.stack = value();
        break;
      case "--judge-tries": {
        const tries = Number(value());
        if (!Number.isInteger(tries) || tries < 1) throw new Error("--judge-tries needs a positive integer");
        flags.judgeTries = tries;
        break;
      }
      case "--judge-concurrency": {
        const concurrency = Number(value());
        if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("--judge-concurrency needs a positive integer");
        flags.judgeConcurrency = concurrency;
        break;
      }
      case "--judge-budget-usd": {
        const budget = Number(value());
        if (!Number.isFinite(budget) || budget <= 0) throw new Error("--judge-budget-usd needs a positive number");
        flags.judgeBudgetUsd = budget;
        break;
      }
      case "--write-calibration":
        flags.writeCalibration = true;
        break;
      default:
        throw new Error(`unknown flag ${String(flag)}`);
    }
  }
  if (flags.nativeModel !== undefined && flags.only !== undefined && flags.only !== "stigmer") {
    throw new Error(`--stigmer-model names the native arm's model, and --only ${flags.only} runs no native cell`);
  }
  return flags;
}

/** Whether an executable named `name` is on PATH, found the way a shell would find it. */
function onPath(name: string): boolean {
  return (process.env["PATH"] ?? "").split(delimiter).some((dir) => {
    if (dir === "") return false;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** The instrument's facts from this tree, and the measured code's HEAD from `stackRoot`'s. */
async function gitFacts(pr: number | undefined, stackRoot: string): Promise<BenchmarkReport["git"]> {
  const git = async (cwd: string, ...args: string[]): Promise<string> => (await execFileAsync("git", args, { cwd })).stdout.trim();
  const headOf = async (cwd: string): Promise<string> => {
    const head = await git(cwd, "rev-parse", "HEAD");
    const dirty = (await git(cwd, "status", "--porcelain")) !== "";
    return dirty ? `${head}-dirty` : head;
  };
  const head = await headOf(REPOSITORY_ROOT);
  let mainSha: string;
  try {
    mainSha = await git(REPOSITORY_ROOT, "merge-base", "HEAD", "origin/main");
  } catch {
    mainSha = head.replace(/-dirty$/, "");
  }
  const codeSha = stackRoot === REPOSITORY_ROOT ? head : await headOf(stackRoot);
  return { head_sha: head, main_sha: mainSha, code_sha: codeSha, ...(pr !== undefined ? { pr } : {}) };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const stackRoot = resolveStackRoot(flags.stack, REPOSITORY_ROOT);
  const env = {
    anthropicKey: Boolean(process.env["ANTHROPIC_API_KEY"]),
    openaiKey: Boolean(process.env["OPENAI_API_KEY"]),
    stigmerCli: onPath("stigmer"),
  };
  const plan = planCells(env, flags);

  for (const refusal of plan.refused) console.error(`refused ${refusal.cell}: ${refusal.reason}`);
  if (plan.cells.length === 0 && plan.quality.length === 0 && !plan.judge) {
    console.error(
      "every cell was refused; nothing to run (set ANTHROPIC_API_KEY and/or OPENAI_API_KEY, or widen --only/--cells)",
    );
    process.exit(2);
  }
  if (flags.writeCalibration && !plan.judge) {
    console.error("--write-calibration needs the judge cell: add --cells judge/*");
    process.exit(2);
  }
  const executions = plan.cells.reduce((sum, cell) => sum + (flags.reps + 1) * cell.scenario.prompts.length, 0);
  console.error(
    `benchmark: ${plan.cells.length} cells (${executions} executions) and the quality eval on ${plan.quality.length} ` +
      `target(s), ${flags.qualityReps} tries per case, on real providers; this spends money`,
  );
  const endpoint = nativeEndpoint(plan.nativeModel, process.env);
  console.error(
    `native arm: ${plan.nativeModel} at ${endpoint}, ${nativeApi(plan.nativeModel) ?? "unknown"} API, background commands ${flags.shellBackground}`,
  );
  if (plan.judge) {
    console.error(
      `judge: ${JUDGE_EXAMPLES.length} examples, ${flags.judgeTries} tries each, at most $${flags.judgeBudgetUsd}; this spends money`,
    );
  }

  const git = await gitFacts(flags.pr, stackRoot);
  if (stackRoot !== REPOSITORY_ROOT) console.error(`stack: the server and runner of ${stackRoot} at ${git.code_sha}`);
  const runDir = resolve(flags.out, `run-${Date.now()}`);
  const stack = await bootBenchmarkStack(runDir, stackRoot === REPOSITORY_ROOT ? undefined : stackRoot, { shellBackground: flags.shellBackground });
  const stop = (): void => {
    void stack.stop().finally(() => process.exit(130));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (plan.cells.length > 0 || plan.quality.length > 0) {
      const report = await runBenchmark(stack, plan, {
        reps: flags.reps,
        qualityReps: flags.qualityReps,
        git,
        titlingSuppressed: true,
        nativeEndpoint: endpoint,
        shellBackground: flags.shellBackground,
        ...(flags.thinking !== undefined ? { thinking: flags.thinking } : {}),
      }, {
        now: Date.now,
        log: (line) => console.error(line),
      });
      const path = await writeReport(flags.out, report);
      console.log(renderSummary(report));
      console.log("");
      console.log(`report: ${path}`);
    }
    if (plan.judge) {
      await calibrateJudge(stack.clients, flags, git);
    }
    console.error(`runner log: ${stack.runnerLogFile}`);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await stack.stop();
  }
}

/** The judge cell: grade the example set, print the counts and misses, write its report and, when asked, the module. */
async function calibrateJudge(
  clients: Parameters<typeof runJudgeCalibration>[0],
  flags: Flags,
  git: BenchmarkReport["git"],
): Promise<void> {
  const run = await runJudgeCalibration(
    clients,
    { examples: JUDGE_EXAMPLES, tries: flags.judgeTries, concurrency: flags.judgeConcurrency, budgetUsd: flags.judgeBudgetUsd },
    { now: Date.now, log: (line) => console.error(line) },
  );
  const { calibration, misses } = run;
  const shortfalls = shortfallsOf(calibration);
  const percent = (n: number, of: number): string => (of === 0 ? "n/a" : `${n}/${of} (${Math.round((n / of) * 100)}%)`);
  console.log("");
  console.log(`judge ${calibration.evaluatorVersion.slice(0, 12)} on ${calibration.model || "the default model"}: ${calibration.grades} grades, ${calibration.unreadable} unreadable, $${calibration.costPerGradeUsd.mean} a grade (max $${calibration.costPerGradeUsd.max})`);
  console.log("| rubric | fails caught | passes kept | not applicable matched |");
  console.log("|---|---|---|---|");
  for (const rubric of calibration.rubrics) {
    console.log(
      `| ${rubric.name} | ${percent(rubric.failsCaught.n, rubric.failsCaught.of)} | ${percent(rubric.passesKept.n, rubric.passesKept.of)} | ${percent(rubric.notApplicableMatched.n, rubric.notApplicableMatched.of)} |`,
    );
  }
  if (misses.length > 0) {
    console.log("");
    console.log("Misses:");
    for (const miss of misses) console.log(`- ${miss.exampleId}: ${miss.rubric} expected ${miss.expected}, got ${miss.got}`);
  }
  console.log("");
  console.log(shortfalls.length === 0 ? "The judge meets the bar." : `Below the bar:\n${shortfalls.map((line) => `- ${line}`).join("\n")}`);
  if (run.stoppedAtBudget) console.log("The run stopped at its budget before every try ran.");

  await mkdir(flags.out, { recursive: true });
  const reportPath = join(flags.out, `judge-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(reportPath, `${JSON.stringify({ git, calibration, misses, shortfalls, stopped_at_budget: run.stoppedAtBudget }, null, 2)}\n`);
  console.log(`judge report: ${reportPath}`);
  if (flags.writeCalibration && run.stoppedAtBudget) {
    console.log("calibration not written: the run stopped at its budget before every try ran");
  } else if (flags.writeCalibration) {
    await writeFile(CALIBRATION_MODULE, renderCalibrationModule(calibration));
    console.log(`calibration written: ${CALIBRATION_MODULE}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
