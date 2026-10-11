// Measures the native and Cursor harnesses against REAL providers and writes
// the report the harness work is judged on
// (`make benchmark-harnesses`; `npm run benchmark:harnesses -- <flags>`).
// Domain: conformance benchmark (the live instrument's entrypoint).
//
// THIS IS AN EXPERIMENT, NOT A TEST. It makes live model calls and spends
// real money: at the defaults, nine scenarios on two harnesses, one warm-up
// plus five samples each, three turns per sample on the three three-turn
// scenarios (the bare turn-2 cell and the working agent's read-edit and
// cross-turn cells) — 180 executions — plus the quality arm: one plugin eval of
// the working agent's nine cases, three tries per case on each harness, the
// AI-graded checks judged by three votes each. It is in no vitest config and
// `npm test` cannot reach it. Its numbers are a new baseline for the machine,
// the model versions and the runner they were taken on, never a comparison
// with an earlier run. They are internal: the benchmark's numbers never
// appear on the docs site (`.agents/skills/docs-writing/SKILL.md` carries the
// rule under "What to refuse").
//
// Needs: the `temporal` CLI on PATH (the dev server backs the stack);
// ANTHROPIC_API_KEY for the native cells and the judge; CURSOR_API_KEY for
// the Cursor cells; the `stigmer` CLI on PATH for every timing cell on the
// working agent (its memory spawns `stigmer mcp-server`; `make
// install-cli-shim`); `go` on PATH for the quality cases that run `go test`;
// the network. A missing key or CLI refuses the cells that need it BY NAME in
// the report and the run goes on with the rest. The working agent's
// workspace is seeded outside the repository (the OS temp directory); nothing
// is written into the tree. Thin over src/benchmark/ (the lib/script split of
// check-inventory.ts): flags and the environment here, the driver there.
//
// Flags:
//   --reps N                 warm samples per cell (default 5; odd keeps the median an observed sample)
//   --quality-reps N         tries per quality case per harness (default 3)
//   --cells <glob>           run only cells whose id matches (`report-parity-*`, `*/cursor`)
//   --only native|cursor     one harness
//   --pr N                   the pull request the measuring checkout belongs to, recorded on the report
//   --thinking enabled       every execution asks for thinking (the judge's does not); the cells on a
//                            harness's default model are refused, since the server refuses thinking on Auto
//   --out <dir>              where the report lands (default: .test-output/benchmark-harnesses)
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { planCells, type PlanFlags } from "../src/benchmark/cells";
import { bootBenchmarkStack, renderSummary, runBenchmark, writeReport } from "../src/benchmark/run";
import type { BenchmarkHarness, BenchmarkReport } from "../src/benchmark/report";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const DEFAULT_OUT = resolve(PACKAGE_ROOT, ".test-output", "benchmark-harnesses");
const DEFAULT_REPS = 5;
const DEFAULT_QUALITY_REPS = 3;

interface Flags extends PlanFlags {
  reps: number;
  qualityReps: number;
  out: string;
  pr: number | undefined;
}

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = {
    reps: DEFAULT_REPS,
    qualityReps: DEFAULT_QUALITY_REPS,
    out: DEFAULT_OUT,
    pr: undefined,
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
        if (only !== "native" && only !== "cursor") throw new Error("--only needs native or cursor");
        flags.only = (only === "native" ? "deep-agent" : "cursor") satisfies BenchmarkHarness;
        break;
      }
      case "--thinking": {
        const mode = value();
        if (mode !== "enabled") throw new Error("--thinking needs enabled");
        flags.thinking = mode;
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
      default:
        throw new Error(`unknown flag ${String(flag)}`);
    }
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
  const env = {
    anthropicKey: Boolean(process.env["ANTHROPIC_API_KEY"]),
    cursorKey: Boolean(process.env["CURSOR_API_KEY"]),
    stigmerCli: onPath("stigmer"),
  };
  const plan = planCells(env, flags);

  for (const refusal of plan.refused) console.error(`refused ${refusal.cell}: ${refusal.reason}`);
  if (plan.cells.length === 0 && plan.quality.length === 0) {
    console.error("every cell was refused; nothing to run (set ANTHROPIC_API_KEY and/or CURSOR_API_KEY, or widen --only/--cells)");
    process.exit(2);
  }
  const executions = plan.cells.reduce((sum, cell) => sum + (flags.reps + 1) * cell.scenario.prompts.length, 0);
  console.error(
    `benchmark: ${plan.cells.length} cells (${executions} executions) and the quality eval on ${plan.quality.length} ` +
      `target(s), ${flags.qualityReps} tries per case, on real providers; this spends money`,
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
    const report = await runBenchmark(stack, plan, {
      reps: flags.reps,
      qualityReps: flags.qualityReps,
      git,
      titlingSuppressed: true,
      ...(flags.thinking !== undefined ? { thinking: flags.thinking } : {}),
    }, {
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
