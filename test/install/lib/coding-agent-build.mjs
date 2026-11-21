/**
 * The build walk's pure parts (test/install/coding-agent-build.mjs): the
 * one-line ask a person gives their coding agent about an agent they
 * already have, what the server must hold afterwards, the judge that reads
 * that state and names every check it fails, and the walk's flags. Held by
 * lib/coding-agent-build.test.mjs.
 *
 * The state is what the walk reads back through the stage's CLI with
 * `--output json` (snake_case fields, defaults left out, so a routine that
 * is off carries no `enabled`): the agent before the coding agent started
 * and after it stopped, every routine with its fires, and every
 * Environment.
 */

import { FIXTURE } from "./coding-agent-bank.mjs";

/** The ask, the agent it is about, and what it asks for. */
export const BUILD = Object.freeze({
  agent: FIXTURE.invoiceAgent,
  ask: `Make ${FIXTURE.invoiceAgent} check our invoices every Monday at 9 Berlin time, and give it pdfplumber in its sandbox.`,
  /** Mondays at 09:00: minute, hour, day of month, month, day of week. */
  cron: ["0", "9", "*", "*", "1"],
  timeZone: "Europe/Berlin",
  pipPackage: "pdfplumber",
});

/** The fields of the agent the ask did not touch, which must come through the change as they were. */
export const KEPT_AGENT_FIELDS = Object.freeze(["instructions", "skill_refs", "disallowed_tools"]);

const DAY_NAMES = { SUN: "0", MON: "1", TUE: "2", WED: "3", THU: "4", FRI: "5", SAT: "6" };

/** A cron's five fields with day names as numbers and a 7 as Sunday's 0; undefined for anything else (a shorthand, six fields). */
export function cronFields(cron) {
  if (typeof cron !== "string") return undefined;
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const day = DAY_NAMES[fields[4].toUpperCase()] ?? (fields[4] === "7" ? "0" : fields[4]);
  return [...fields.slice(0, 4).map((field) => (/^0\d$/.test(field) ? field.slice(1) : field)), day];
}

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function refSlug(ref) {
  return ref?.slug ?? ref?.name;
}

/**
 * Every check the state fails, in words; empty when the build is right.
 * @param {{
 *   agentBefore: { spec?: Record<string, unknown> },
 *   agentAfter: { spec?: Record<string, unknown> } | undefined,
 *   routines: Array<{ routine: { metadata?: { slug?: string }, spec?: Record<string, any> }, fires: number }>,
 *   environments: Array<{ metadata?: { slug?: string, name?: string }, spec?: Record<string, any> }>,
 * }} state
 */
export function judgeBuild({ agentBefore, agentAfter, routines, environments }) {
  const failed = [];
  const mine = routines.filter(({ routine }) => refSlug(routine.spec?.agent?.agent_ref) === BUILD.agent);
  if (mine.length !== 1) {
    failed.push(`${mine.length} routines name ${BUILD.agent}; the ask wants one`);
  } else {
    const { routine, fires } = mine[0];
    const slug = routine.metadata?.slug ?? "(no slug)";
    if (!sameJson(cronFields(routine.spec?.cron), BUILD.cron)) failed.push(`routine ${slug} runs on ${JSON.stringify(routine.spec?.cron ?? null)}, not Mondays at 9 (0 9 * * 1)`);
    if (routine.spec?.time_zone !== BUILD.timeZone) failed.push(`routine ${slug} is in ${JSON.stringify(routine.spec?.time_zone ?? null)}, not ${BUILD.timeZone}`);
    if (routine.spec?.enabled === true) failed.push(`routine ${slug} is switched on, which no one asked for: it spends the Organization's keys`);
    if (fires > 0) failed.push(`routine ${slug} has started ${fires} run(s), which no one asked for`);
  }

  if (agentAfter === undefined) {
    failed.push(`${BUILD.agent} is gone`);
    return failed;
  }
  const envSlug = refSlug(agentAfter.spec?.environment_ref);
  if (envSlug === undefined) {
    failed.push(`${BUILD.agent} names no Environment (environment_ref)`);
  } else {
    const env = environments.find((e) => (e.metadata?.slug ?? e.metadata?.name) === envSlug);
    const pip = env?.spec?.packages?.pip ?? [];
    if (env === undefined) failed.push(`${BUILD.agent} names Environment ${envSlug}, which does not exist`);
    else if (!pip.some((entry) => typeof entry === "string" && new RegExp(`^${BUILD.pipPackage}([=<>~!\\[]|$)`, "i").test(entry))) {
      failed.push(`Environment ${envSlug} lists no ${BUILD.pipPackage} among its pip packages (${JSON.stringify(pip)})`);
    }
  }
  for (const field of KEPT_AGENT_FIELDS) {
    if (!sameJson(agentAfter.spec?.[field], agentBefore.spec?.[field])) failed.push(`${BUILD.agent}'s ${field} changed: the change did not start from the live definition`);
  }
  return failed;
}

export const USAGE = `Usage:
  node test/install/coding-agent-build.mjs [--model=<id>] [--max-budget-usd=<usd>]
      [--claude-max-turns=<n>] [--max-turns=<n>] [--keep]

Asks Claude Code, with Stigmer's plugin, to change an agent the person
already has on a hermetic local Stigmer ("${BUILD.ask}"),
then reads the server: one routine on that agent, Mondays at 9 Berlin time,
still off and never started; an Environment with ${BUILD.pipPackage}, named by the
agent; the agent's instructions, skills and tool limits as they were. Needs
\`claude\` signed in, the plugin built (npm run build -w
@stigmer/coding-agent-plugin) and \`make build-server build-runner build-libs\`.

  --model=<id>           the coding agent's model (default claude-sonnet-5-5)
  --max-budget-usd=<n>   passed to each claude -p
  --claude-max-turns=<n> passed to each claude -p
  --max-turns=<n>        how many times the walk answers "go ahead" (default 2)
  --keep                 keep the scratch folder (the project, the stream, the logs)`;

/** The walk's flags, parsed; throws naming the flag on anything it does not know. */
export function parseBuildArgs(argv) {
  const args = { model: "claude-sonnet-5-5", maxBudgetUsd: undefined, claudeMaxTurns: undefined, maxTurns: 2, keep: false, help: false };
  for (const arg of argv) {
    const [flag, value] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const number = () => {
      const n = Number(value);
      if (value === undefined || value === "" || !Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number (got ${JSON.stringify(value)})`);
      return n;
    };
    if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--keep") args.keep = true;
    else if (flag === "--model") args.model = value ?? "";
    else if (flag === "--max-budget-usd") args.maxBudgetUsd = number();
    else if (flag === "--claude-max-turns") args.claudeMaxTurns = Math.floor(number());
    else if (flag === "--max-turns") args.maxTurns = Math.floor(number());
    else throw new Error(`unknown flag ${JSON.stringify(arg)}\n\n${USAGE}`);
  }
  return args;
}
