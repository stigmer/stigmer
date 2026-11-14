// `stigmer load-test --agents <n>`: start n agents at the same moment on the
// connected server and report how many started, how long each waited for a
// sandbox, and which were refused and why. A top-level verb in "Run agents".
//
// Thin handler: check the flags, resolve the server and the organization,
// say the budget before spending it, run the burst (burst.ts), print the
// report (report.ts). The CLI's laws hold: the report is data on stdout
// (`-o table|json|yaml`), the budget, the progress and the cleanup are on
// stderr, and there is no prompt (it destroys nothing of the person's;
// `stigmer run` spends without one).
//
// The budget is the whole burst's (`--max-usd`, $1 by default), split evenly
// into each run's `max_cost_usd`; a run stops once its estimate reaches its
// share, and one model call can go past it. There is no cap on n: the budget
// is the guard, and a number the tool refused would be a fleet size of its
// own.
//
// Exit codes are the CLI's table: 0 when the burst ran and was reported,
// whatever it found (the report is the verdict); a refusal before the burst
// (the key, the organization, the agent's create) exits with its own code;
// 1 when the cleanup left something, listed on stderr; 130 after Ctrl-C,
// once the cleanup ran.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../../config/index.js";
import { CliExitError, ExitCode, UsageError } from "../../errors/index.js";
import type { OutputFlags } from "../../output/index.js";
import { dialedServerAddress } from "../../runtime.js";
import { globalOrg, readFormat } from "../shared.js";
import type { BurstProgress } from "./burst.js";

interface LoadTestFlags extends OutputFlags {
  agents?: string;
  model?: string;
  message?: string;
  maxUsd?: string;
  waitMinutes?: string;
}

/** What each agent is asked when `--message` is not given. */
export const DEFAULT_MESSAGE = "Say hello in one word.";

const DEFAULT_MAX_USD = 1;
const DEFAULT_WAIT_MINUTES = 20;

export function registerLoadTest(program: Command): void {
  program
    .command("load-test")
    .description("start many agents at once and report how many started, how long each waited, and which were refused")
    .option("--agents <n>", "how many agents to start at the same moment (required)")
    .option("--model <id>", "the model each run uses; the agent's default when unset")
    .option("--message <text>", `what each agent is asked (default "${DEFAULT_MESSAGE}")`)
    .option("--max-usd <total>", `the whole burst's budget in US dollars, split evenly across the runs (default ${DEFAULT_MAX_USD})`)
    .option("--wait-minutes <m>", `how long to watch for runs to start before calling them still waiting (default ${DEFAULT_WAIT_MINUTES})`)
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((options: LoadTestFlags, command: Command) => runLoadTest(options, command));
}

/** The flags, checked: a count of at least one, a positive budget and watch. */
export function parseFlags(options: LoadTestFlags): { agents: number; maxUsd: number; waitMinutes: number } {
  const agents = Number(options.agents ?? "");
  if (!Number.isInteger(agents) || agents < 1) {
    throw new UsageError("--agents takes a whole number of at least 1");
  }
  const maxUsd = options.maxUsd === undefined ? DEFAULT_MAX_USD : Number(options.maxUsd);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new UsageError("--max-usd takes an amount above 0, in US dollars");
  }
  const waitMinutes = options.waitMinutes === undefined ? DEFAULT_WAIT_MINUTES : Number(options.waitMinutes);
  if (!Number.isFinite(waitMinutes) || waitMinutes <= 0) {
    throw new UsageError("--wait-minutes takes a number of minutes above 0");
  }
  return { agents, maxUsd, waitMinutes };
}

async function runLoadTest(options: LoadTestFlags, command: Command): Promise<void> {
  const { agents, maxUsd, waitMinutes } = parseFlags(options);
  const format = readFormat(options);
  const [{ connectBackend }, { runBurst }, report, { formatElapsed }] = await Promise.all([
    import("../../backend.js"),
    import("./burst.js"),
    import("./report.js"),
    import("@stigmer/client"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const server = dialedServerAddress()?.address ?? "";
  const shareUsd = maxUsd / agents;

  const where = [org === "" ? "" : ` in ${org}`, server === "" ? "" : ` on ${server}`].join("");
  process.stderr.write(
    `Starting ${agents} agent${agents === 1 ? "" : "s"} at once${where}.\n` +
      `Budget ${report.usd(maxUsd)}, split across the runs: each stops once it has spent ${report.usd(shareUsd)}. One model call can go past a run's share.\n`,
  );

  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const progress = progressPrinter(process.stderr, formatElapsed);
  try {
    const result = await runBurst(client.stigmer, {
      org,
      agents,
      model: options.model ?? "",
      message: options.message ?? DEFAULT_MESSAGE,
      shareUsd,
      waitMs: waitMinutes * 60_000,
      signal: controller.signal,
      onProgress: progress.update,
    });
    progress.stop();
    process.stderr.write(cleanupLine(result.sightings.filter((s) => s.sessionId !== "").length, result.leftBehind));
    const built = report.buildReport(
      { server, org, agent: result.agent, requested: agents, budgetUsd: maxUsd, shareUsd },
      result.sightings,
      result.leftBehind,
    );
    process.stdout.write(report.renderReport(built, format));
    if (result.interrupted) throw new CliExitError("", ExitCode.Interrupted);
    if (result.leftBehind.length > 0) throw new CliExitError("", ExitCode.General);
  } finally {
    progress.stop();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

/** The cleanup's line: what was deleted, or what is left to remove by hand. */
export function cleanupLine(conversations: number, leftBehind: readonly string[]): string {
  if (leftBehind.length > 0) return `Could not delete, remove by hand: ${leftBehind.join(", ")}\n`;
  const deleted = conversations === 0 ? "the agent" : `${conversations} conversation${conversations === 1 ? "" : "s"} and the agent`;
  return `Cleaned up: deleted ${deleted}.\n`;
}

/** The stream the progress line is written to. */
export interface ProgressStream {
  readonly isTTY?: boolean;
  write(text: string): boolean;
}

/**
 * The progress line, "6 sent · 3 started · 2 waiting · 1 refused · 42s": on
 * a terminal one line rewritten in place, its time ticking each second; off
 * one, a line per change. `stop` ends the line; calling it again does nothing.
 */
export function progressPrinter(
  stream: ProgressStream,
  elapsed: (ms: number) => string,
  now: () => number = Date.now,
): { update: (progress: BurstProgress) => void; stop: () => void } {
  const begin = now();
  let last: BurstProgress | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const text = (p: BurstProgress): string => {
    const parts = [`${p.sent} sent`, `${p.started} started`, `${p.waiting} waiting`];
    if (p.refused > 0) parts.push(`${p.refused} refused`);
    parts.push(elapsed(now() - begin));
    return parts.join(" · ");
  };
  const draw = (): void => {
    if (last !== undefined) stream.write(`\r\u001b[2K${text(last)}`);
  };
  return {
    update(progress) {
      last = progress;
      if (stream.isTTY !== true) {
        stream.write(`${text(progress)}\n`);
        return;
      }
      draw();
      ticker ??= setInterval(draw, 1000);
      ticker.unref();
    },
    stop() {
      if (ticker === undefined) return;
      clearInterval(ticker);
      ticker = undefined;
      stream.write("\n");
    },
  };
}
