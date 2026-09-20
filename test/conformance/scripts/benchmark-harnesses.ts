// Measures the native and Cursor harnesses against REAL providers and writes
// the report the harness work is judged on
// (`make benchmark-harnesses`; `npm run benchmark:harnesses -- <flags>`).
// Domain: conformance benchmark (the live instrument's entrypoint).
//
// THIS IS AN EXPERIMENT, NOT A TEST. It makes live model calls and spends
// real money: at the defaults, seven scenarios on two harnesses, one warm-up
// plus five samples each, three turns per sample on the turn-2 scenario —
// 108 executions — plus any quality tasks. It is in no vitest config and
// `npm test` cannot reach it. Its numbers are a new baseline for the machine,
// the model versions and the runner they were taken on, never a comparison
// with an earlier run. They are internal: the benchmark's numbers never
// appear on the docs site (`.agents/skills/docs-writing/SKILL.md` carries the
// rule under "What to refuse").
//
// Needs: the `temporal` CLI on PATH (the dev server backs the stack);
// ANTHROPIC_API_KEY for the native cells and the judge; CURSOR_API_KEY for
// the Cursor cells; the network. A missing key refuses the cells that need
// it BY NAME in the report and the run goes on with the rest; nothing is
// written into the tree. Thin over src/benchmark/ (the lib/script split of
// check-inventory.ts): flags and the environment here, the driver there.
//
// Flags:
//   --reps N                 warm samples per cell (default 5; odd keeps the median an observed sample)
//   --cells <glob>           run only cells whose id matches (`report-parity-*`, `*/cursor`)
//   --only native|cursor     one harness
//   --tasks <path>           the quality tasks file (default: scripts/benchmark-harnesses/quality-tasks.yaml)
//   --include-placeholders   run the tasks marked placeholder
//   --pr N                   the pull request the measuring checkout belongs to, recorded on the report
//   --out <dir>              where the report lands (default: .test-output/benchmark-harnesses)
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { planCells, type PlanFlags, type QualityTask } from "../src/benchmark/cells";
import { bootBenchmarkStack, renderSummary, runBenchmark, writeReport } from "../src/benchmark/run";
import type { BenchmarkHarness, BenchmarkReport } from "../src/benchmark/report";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const DEFAULT_TASKS = resolve(PACKAGE_ROOT, "scripts", "benchmark-harnesses", "quality-tasks.yaml");
const DEFAULT_OUT = resolve(PACKAGE_ROOT, ".test-output", "benchmark-harnesses");
const DEFAULT_REPS = 5;

interface Flags extends PlanFlags {
  reps: number;
  tasks: string;
  out: string;
  pr: number | undefined;
}

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = { reps: DEFAULT_REPS, tasks: DEFAULT_TASKS, out: DEFAULT_OUT, pr: undefined, includePlaceholders: false };
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
      case "--cells":
        flags.cells = value();
        break;
      case "--only": {
        const only = value();
        if (only !== "native" && only !== "cursor") throw new Error("--only needs native or cursor");
        flags.only = (only === "native" ? "deep-agent" : "cursor") satisfies BenchmarkHarness;
        break;
      }
      case "--tasks":
        flags.tasks = resolve(value());
        break;
      case "--include-placeholders":
        flags.includePlaceholders = true;
        break;
      case "--pr": {
        const pr = Number(value());
        if (!Number.isInteger(pr) || pr < 1) throw new Error("--pr needs a positive integer");
        flags.pr = pr;
        break;
      }
      case "--out":
        flags.out = resolve(value());
        break;
      default:
        throw new Error(`unknown flag ${String(flag)}`);
    }
  }
  return flags;
}

async function readTasks(path: string): Promise<QualityTask[]> {
  const parsed = yaml.load(await readFile(path, "utf8")) as { tasks?: unknown } | undefined;
  if (parsed === undefined || !Array.isArray(parsed.tasks)) {
    throw new Error(`${path}: expected a top-level "tasks" list`);
  }
  return parsed.tasks.map((entry, index): QualityTask => {
    const task = entry as Record<string, unknown>;
    for (const key of ["id", "prompt", "rubric"] as const) {
      if (typeof task[key] !== "string" || task[key] === "") throw new Error(`${path}: tasks[${index}].${key} must be a non-empty string`);
    }
    return {
      id: task["id"] as string,
      prompt: task["prompt"] as string,
      rubric: task["rubric"] as string,
      placeholder: task["placeholder"] === true,
    };
  });
}

async function gitFacts(pr: number | undefined): Promise<BenchmarkReport["git"]> {
  const git = async (...args: string[]): Promise<string> =>
    (await execFileAsync("git", args, { cwd: REPOSITORY_ROOT })).stdout.trim();
  const head = await git("rev-parse", "HEAD");
  const dirty = (await git("status", "--porcelain")) !== "";
  let mainSha: string;
  try {
    mainSha = await git("merge-base", "HEAD", "origin/main");
  } catch {
    mainSha = head;
  }
  return { head_sha: dirty ? `${head}-dirty` : head, main_sha: mainSha, ...(pr !== undefined ? { pr } : {}) };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const tasks = await readTasks(flags.tasks);
  const env = { anthropicKey: Boolean(process.env["ANTHROPIC_API_KEY"]), cursorKey: Boolean(process.env["CURSOR_API_KEY"]) };
  const plan = planCells(tasks, env, flags);

  for (const refusal of plan.refused) console.error(`refused ${refusal.cell}: ${refusal.reason}`);
  if (plan.cells.length === 0 && plan.quality.length === 0) {
    console.error("every cell was refused; nothing to run (set ANTHROPIC_API_KEY and/or CURSOR_API_KEY, or widen --only/--cells)");
    process.exit(2);
  }
  const executions = plan.cells.reduce((sum, cell) => sum + (flags.reps + 1) * cell.scenario.prompts.length, 0);
  console.error(
    `benchmark: ${plan.cells.length} cells (${executions} executions) and ${plan.quality.length} quality cells on real providers; this spends money`,
  );

  const git = await gitFacts(flags.pr);
  const runDir = resolve(flags.out, `run-${Date.now()}`);
  const stack = await bootBenchmarkStack(runDir);
  const stop = (): void => {
    void stack.stop().finally(() => process.exit(130));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const report = await runBenchmark(stack, plan, { reps: flags.reps, git, titlingSuppressed: true }, {
      now: Date.now,
      log: (line) => console.error(line),
    });
    const path = await writeReport(flags.out, report);
    console.log(renderSummary(report));
    console.log("");
    console.log(`report: ${path}`);
    console.error(`runner log: ${stack.runnerLogFile}`);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await stack.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
