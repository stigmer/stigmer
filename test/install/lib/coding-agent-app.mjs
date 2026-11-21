/**
 * The app walk's pure parts (test/install/coding-agent-app.mjs): the two
 * apps it walks, each with the agent seeded for it, the one-line ask a
 * person gives their coding agent, and what the agent's runs answer; the
 * fake model's script for those runs; and the walk's flags. Held by
 * lib/coding-agent-app.test.mjs.
 */

import { carriesToolResult } from "./coding-agent-bank.mjs";

/** Where the walk puts the agent's report, and what it says: the fake model writes it on every run. */
const REPORT_FILE = "report.md";

/**
 * The apps, by the name `--app` takes. `mark` is a phrase only that agent's
 * instructions carry, so the fake model knows a run is the agent's.
 */
export const APPS = Object.freeze({
  "ledgerly-nextjs": Object.freeze({
    agent: "invoice-checker",
    mark: "supplier invoices against their purchase orders",
    instructions:
      "You check a month's supplier invoices against their purchase orders and save what needs a look as report.md in your outputs folder.",
    ask: "Let our signed-in customers chat with our invoice-checker agent on the invoices page.",
    report: "2 of 14 invoices need a look: INV-1042 is billed twice and INV-1077 is over its purchase order.\n",
    reply: "I checked this month's invoices: 2 of 14 need a look, INV-1042 and INV-1077.",
  }),
  "statements-fastapi": Object.freeze({
    agent: "statement-checker",
    mark: "bank statement for entries that need a look",
    instructions:
      "You check a customer's bank statement for entries that need a look and save your findings as report.md in your outputs folder.",
    ask: "When a signed-in customer uploads a statement, run our statement-checker agent on it as that customer and show them the report it makes.",
    report: "3 entries need a look: two card charges on 2026-11-03 for the same amount, and a transfer with no reference.\n",
    reply: "Saved report.md in your outputs folder: 3 entries need a look.",
  }),
});

/** The first line of an app's report: what the person must be shown. */
export function reportLine(app) {
  return APPS[app].report.split("\n")[0];
}

/** The agent's manifest, as `stigmer apply -f` reads it. */
export function agentManifest(app) {
  const { agent, instructions } = APPS[app];
  return `apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: ${agent}\nspec:\n  description: ${instructions.split(" and ")[0]}.\n  instructions: |\n    ${instructions}\n`;
}

function requestText(request) {
  return JSON.stringify(request.body ?? "");
}

/**
 * The fake model's script for the app's agent, every run alike: a title
 * call answers a title; the agent's first step saves the report as
 * `report.md` in its outputs folder, its next answers `reply`. Each entry
 * repeats, so the coding agent's own trial runs and the walk's checks meet
 * the same agent.
 */
export function appScript(app, { isTitleCall, anthropicText, anthropicToolUse }) {
  const { mark, report, reply } = APPS[app];
  const isAgent = (request) => !isTitleCall(request) && requestText(request).includes(mark);
  return [
    { kind: "anthropic", body: anthropicText("Statement check"), matches: isTitleCall, repeat: true },
    {
      kind: "anthropic",
      body: anthropicToolUse("toolu_app_report", "write_file", { file_path: `/.stigmer/outputs/${REPORT_FILE}`, content: report }),
      matches: (request) => isAgent(request) && !carriesToolResult(request),
      repeat: true,
    },
    { kind: "anthropic", body: anthropicText(reply), matches: (request) => isAgent(request) && carriesToolResult(request), repeat: true },
  ];
}

export const USAGE = `Usage:
  node test/install/coding-agent-app.mjs --app=<${Object.keys(APPS).join("|")}>
      [--model=<id>] [--max-budget-usd=<usd>] [--claude-max-turns=<n>]
      [--max-turns=<n>] [--keep]

Puts a Stigmer agent in a scratch app with Claude Code and Stigmer's plugin,
from a one-line ask, on a hermetic local Stigmer, then checks the app works
for one of its signed-in customers, as that customer. Needs \`claude\` signed
in, the plugin built (npm run build -w @stigmer/coding-agent-plugin) and
\`make build-server build-runner build-libs\`.

  --app=<name>          the app to walk (required)
  --model=<id>          the coding agent's model (default claude-sonnet-5-5)
  --max-budget-usd=<n>  passed to each claude -p
  --claude-max-turns=<n> passed to each claude -p
  --max-turns=<n>       how many times the walk answers "go ahead" (default 2)
  --keep                keep the scratch folder (the app, the stream, the logs)`;

/** The walk's flags, parsed; throws naming the flag on anything it does not know. */
export function parseAppArgs(argv) {
  const args = { app: undefined, model: "claude-sonnet-5-5", maxBudgetUsd: undefined, claudeMaxTurns: undefined, maxTurns: 2, keep: false, help: false };
  for (const arg of argv) {
    const [flag, value] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const number = () => {
      const n = Number(value);
      if (value === undefined || value === "" || !Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number (got ${JSON.stringify(value)})`);
      return n;
    };
    if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--keep") args.keep = true;
    else if (flag === "--app") args.app = value;
    else if (flag === "--model") args.model = value ?? "";
    else if (flag === "--max-budget-usd") args.maxBudgetUsd = number();
    else if (flag === "--claude-max-turns") args.claudeMaxTurns = Math.floor(number());
    else if (flag === "--max-turns") args.maxTurns = Math.floor(number());
    else throw new Error(`unknown flag ${JSON.stringify(arg)}\n\n${USAGE}`);
  }
  if (!args.help && (args.app === undefined || !(args.app in APPS))) {
    throw new Error(`--app must be one of ${Object.keys(APPS).join(", ")} (got ${JSON.stringify(args.app)})`);
  }
  return args;
}

/**
 * The files of an app that git would take (tracked, or untracked and not
 * ignored) whose text holds `key`: a key belongs in the git-ignored env file
 * alone.
 */
export function filesHoldingKey(listed, readText, key) {
  return listed.filter((path) => {
    const text = readText(path);
    return text !== undefined && text.includes(key);
  });
}
