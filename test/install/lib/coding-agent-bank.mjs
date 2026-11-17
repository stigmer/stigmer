/**
 * The coding-agent question bank's pure parts (test/install/coding-agent-bank.mjs):
 * its flags, which cases a run selects, the `claude plugin eval` command it
 * runs, the fixture's model script, and the per-job summary read from Claude
 * Code's result file. Split out so they are tested without a stack or a
 * model (coding-agent-bank.test.mjs).
 *
 * The bank is coding-agents/evals/<job>/<case>/: each case tagged with its
 * job (one of JOBS), and `acts` when it acts on the fixture. A case passes
 * only when every try passed every scored grader (`--threshold 1.0`, the
 * runner's default); a job's score is the cases passed out of the cases, per
 * arm. The `skill-fired` grader (with-only) is the plugin-fired indicator,
 * outside the score.
 *
 * Plain node, no dependencies, like its neighbours.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The jobs a developer brings to their coding agent, in the order the summary lists them. */
export const JOBS = ["deciding", "setup", "design", "integrate", "run-fix", "quality", "reach", "own-server", "admin", "stuck"];

/** The tag an acting case carries beside its job. */
export const ACTS_TAG = "acts";

/** The model the coding agent and the judge run on unless `--model`/`--judge-model` say otherwise: one pinned model keeps scores comparable. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** The API-equivalent ceiling a run stops at unless `--max-cost-usd` says otherwise. */
export const DEFAULT_MAX_COST_USD = 60;

/** The tries per case per arm unless `--runs` says otherwise. */
export const DEFAULT_RUNS = 3;

/** The plugin's MCP server's tools, as `claude plugin eval` names them: mcp__plugin_<plugin>_<server>__<tool>. */
export const PLUGIN_TOOLS_GRANT = "mcp__plugin_stigmer_stigmer__*";

/**
 * The operator's grants: the shell, the web, the plugin's tools, and the
 * fixture's loopback address, without which the sandbox's proxy refuses the
 * CLI's calls to the local Stigmer.
 */
export const TOOL_GRANTS = ["Bash", "WebFetch", "WebSearch", "WebFetch(domain:127.0.0.1)", PLUGIN_TOOLS_GRANT];

export const USAGE = `Usage:
  node test/install/coding-agent-bank.mjs [--tag=<job>]... [--case=<glob>]
      [--runs=<n>] [--model=<id>] [--judge-model=<id>] [--max-cost-usd=<usd>]
      [--concurrency=<n>] [--with-only] [--compare=<summary.json>] [--out=<dir>]
      [--keep]

Runs the coding-agent question bank (coding-agents/evals/) in Claude Code,
with Stigmer's plugin and without it, against a hermetic local Stigmer that
holds the fixture (coding-agents/evals/_fixture/), and prints the score per
job. Needs \`claude\` signed in and \`make build-libs build-server build-runner\`.

  --tag=<job>          only the cases tagged <job> (repeatable; ${JOBS.join(", ")}, ${ACTS_TAG})
  --case=<glob>        only the cases whose name matches <glob> (* matches anything,
                       {a,b} either name; quote it from a shell)
  --runs=<n>           tries per case per arm (default ${DEFAULT_RUNS})
  --model=<id>         the coding agent's model (default ${DEFAULT_MODEL})
  --judge-model=<id>   the llm graders' model (default: --model's)
  --max-cost-usd=<usd> stop at this API-equivalent cost (default ${DEFAULT_MAX_COST_USD})
  --concurrency=<n>    tries at once (default 1; they share one rate limit)
  --with-only          the with-plugin arm alone (no baseline arm)
  --compare=<file>     an earlier run's summary.json: print each job's spread
                       between its with-plugin reading and this run's
  --out=<dir>          where the result, the report and the summary go
  --keep               keep the stage's folder (logs, the staged plugin)`;

function positiveNumber(flag, raw, integer) {
  const value = Number(raw);
  if (raw === "" || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${flag} must be a positive ${integer ? "whole number" : "number"} (got ${JSON.stringify(raw)})`);
  }
  return value;
}

/** The bank's flags, parsed; throws naming the flag on anything it does not know. */
export function parseBankArgs(argv) {
  const args = {
    tags: [],
    caseGlob: undefined,
    runs: DEFAULT_RUNS,
    model: DEFAULT_MODEL,
    judgeModel: undefined,
    maxCostUsd: DEFAULT_MAX_COST_USD,
    concurrency: 1,
    withOnly: false,
    compare: undefined,
    out: undefined,
    keep: false,
    help: false,
  };
  for (const arg of argv) {
    const [flag, ...rest] = arg.split("=");
    const value = rest.join("=");
    const hasValue = arg.includes("=");
    const needValue = () => {
      if (!hasValue || value === "") throw new Error(`${flag} needs a value (${flag}=<value>)`);
      return value;
    };
    switch (flag) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--tag": {
        const tag = needValue();
        if (!JOBS.includes(tag) && tag !== ACTS_TAG) throw new Error(`--tag must be one of: ${[...JOBS, ACTS_TAG].join(", ")} (got ${JSON.stringify(tag)})`);
        args.tags.push(tag);
        break;
      }
      case "--case":
        args.caseGlob = needValue();
        break;
      case "--runs":
        args.runs = positiveNumber(flag, needValue(), true);
        break;
      case "--model":
        args.model = needValue();
        break;
      case "--judge-model":
        args.judgeModel = needValue();
        break;
      case "--max-cost-usd":
        args.maxCostUsd = positiveNumber(flag, needValue(), false);
        break;
      case "--concurrency":
        args.concurrency = positiveNumber(flag, needValue(), true);
        if (args.concurrency > 8) throw new Error("--concurrency is at most 8 (claude plugin eval's own bound)");
        break;
      case "--with-only":
        args.withOnly = true;
        break;
      case "--compare":
        args.compare = needValue();
        break;
      case "--out":
        args.out = needValue();
        break;
      case "--keep":
        args.keep = true;
        break;
      default:
        throw new Error(`unknown flag ${JSON.stringify(arg)}\n\n${USAGE}`);
    }
  }
  return args;
}

/** The `tags` a case's prompt.md frontmatter declares (the bank writes them as a flow list on one line). */
export function frontmatterTags(promptMarkdown) {
  const front = /^---\n([\s\S]*?)\n---/.exec(promptMarkdown)?.[1] ?? "";
  const line = /^tags:\s*\[(.*)\]\s*$/m.exec(front)?.[1];
  if (line === undefined) return [];
  return line
    .split(",")
    .map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
    .filter((tag) => tag !== "");
}

/**
 * Every case in the bank: `{ name, job, dir, tags }`, `dir` relative to the
 * evals folder (`<job>/<case>`). A folder whose name starts with `_` (the
 * fixture) and `results/` hold no case.
 */
export function readBankCases(evalsDir) {
  const cases = [];
  for (const job of readdirSync(evalsDir).sort()) {
    const jobDir = join(evalsDir, job);
    if (job.startsWith("_") || job.startsWith(".") || job === "results" || !statSync(jobDir).isDirectory()) continue;
    for (const name of readdirSync(jobDir).sort()) {
      const prompt = join(jobDir, name, "prompt.md");
      let text;
      try {
        text = readFileSync(prompt, "utf8");
      } catch {
        continue;
      }
      cases.push({ name, job, dir: `${job}/${name}`, tags: frontmatterTags(text) });
    }
  }
  return cases;
}

/**
 * Whether `name` matches `glob`, where `*` matches any run of characters and
 * `{a,b}` any one of its comma-separated choices (so one run can name several
 * cases); nothing else is special.
 */
export function globMatches(glob, name) {
  const escape = (text) => text.replace(/[.+?^$()|[\]\\]/g, "\\$&");
  const pattern = glob
    .split(/(\{[^{}]*\})/)
    .map((part) =>
      part.startsWith("{") && part.endsWith("}")
        ? `(?:${part.slice(1, -1).split(",").map((choice) => escape(choice).replaceAll("*", ".*")).join("|")})`
        : escape(part).replaceAll("*", ".*"),
    )
    .join("");
  return new RegExp(`^${pattern}$`).test(name);
}

/** The cases a run selects: any of `tags` (all when none), and `caseGlob` when given, as `claude plugin eval` filters them. */
export function selectCases(cases, { tags = [], caseGlob } = {}) {
  return cases.filter((c) => (tags.length === 0 || c.tags.some((tag) => tags.includes(tag))) && (caseGlob === undefined || globMatches(caseGlob, c.name)));
}

/**
 * The `claude plugin eval` argument list for a run over the staged plugin at
 * `pluginDir`. The selection is made by staging only the selected cases
 * (coding-agent-bank.mjs), never by `--tag`/`--case`, so it cannot depend
 * on how a shell or the eval runner reads a glob. `--keep-temp` keeps each
 * try's folder, from which the runner copies the try's trace into the run's
 * output and then removes it.
 */
export function evalArgs(args, { pluginDir, resultPath, outputDir, reportPath }) {
  return [
    "plugin",
    "eval",
    pluginDir,
    "--trust-plugin",
    "--scaffold",
    "--keep-temp",
    "--allow-real-servers",
    "--allow-tools",
    ...TOOL_GRANTS,
    "--model",
    args.model,
    "--judge-model",
    args.judgeModel ?? args.model,
    "--runs",
    String(args.runs),
    "--max-cost-usd",
    String(args.maxCostUsd),
    "--concurrency",
    String(args.concurrency),
    "--ablation",
    args.withOnly ? "none" : "with-without",
    "--json",
    resultPath,
    "--output-dir",
    outputDir,
    "--report",
    reportPath,
    "--no-publish",
  ];
}

/** The fixture's facts: what its agents' runs say, which acting cases grade on. */
export const FIXTURE = Object.freeze({
  invoiceAgent: "invoice-checker",
  /** Text in the invoice agent's instructions, by which the fake model knows its runs. */
  invoiceMark: "supplier invoices against their purchase orders",
  invoiceFile: "invoice-check.md",
  invoiceFirstLine: "Invoice check: 3 of 41 invoices need a look (INV-2291 billed twice, INV-2307 over its PO by $412.50, INV-2318 has no PO).",
  reconcilerAgent: "reconciler",
  /** Text in the reconciler's instructions, by which the fake model knows its runs. */
  reconcilerMark: "reconcile a bank statement against the ledger",
  reconcilerError: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
  skill: "vendor-aliases",
});

/** The invoice agent's saved report: the first line every acting case can read back, then its table. */
export const INVOICE_REPORT = [
  FIXTURE.invoiceFirstLine,
  "",
  "| Invoice | Vendor | What is wrong | At stake |",
  "| --- | --- | --- | --- |",
  "| INV-2307 | Fabrikam | over PO-1110 | $412.50 |",
  "| INV-2291 | Contoso Supplies | billed twice | $880.00 |",
  "| INV-2318 | Northwind Traders | no purchase order | $640.00 |",
  "",
].join("\n");

/** What the invoice agent says when its turn ends. */
export const INVOICE_REPLY = `Saved ${FIXTURE.invoiceFile} in your outputs folder. ${FIXTURE.invoiceFirstLine}`;

/** What every other agent's turn says (one a case makes, say): the fake's default reply. */
export const BANK_REPLY = "Done. I worked through your request; tell me if you want anything changed.";

function requestText(request) {
  return JSON.stringify(request.body ?? "");
}

/** Whether the request already carries a tool's result: the turn is past its first model call. */
export function carriesToolResult(request) {
  return /"type":"tool_result"/.test(requestText(request));
}

/**
 * The fixture's model script, as standing answers (each `repeat`, so every
 * try's run meets the same agent): the invoice agent's first call saves its
 * report and its next ends the turn; every reconciler call is refused by the
 * provider for want of credit; the title call is answered on its own.
 * `isTitleCall` and the wire builders come from the caller (test/support's,
 * loaded by relative path).
 */
export function fixtureScript({ isTitleCall, anthropicText, anthropicToolUse }) {
  const isInvoice = (request) => !isTitleCall(request) && requestText(request).includes(FIXTURE.invoiceMark);
  const isReconciler = (request) => !isTitleCall(request) && requestText(request).includes(FIXTURE.reconcilerMark);
  return [
    { kind: "anthropic", body: anthropicText("Agent run"), matches: isTitleCall, repeat: true },
    {
      kind: "anthropic",
      body: anthropicToolUse("toolu_bank_invoice", "write_file", { file_path: `/.stigmer/outputs/${FIXTURE.invoiceFile}`, content: INVOICE_REPORT }),
      matches: (request) => isInvoice(request) && !carriesToolResult(request),
      repeat: true,
    },
    { kind: "anthropic", body: anthropicText(INVOICE_REPLY), matches: (request) => isInvoice(request) && carriesToolResult(request), repeat: true },
    {
      kind: "error",
      status: 400,
      body: { type: "error", error: { type: "invalid_request_error", message: FIXTURE.reconcilerError } },
      matches: isReconciler,
      repeat: true,
    },
  ];
}

/**
 * Where each try's trace goes in the run's output, and the try's kept
 * folder to remove after: `{ from, to, keptDir }` per try, `to` relative to
 * the output (`traces/<job>/<case>/<arm>-<n>.jsonl`). A try with no trace
 * (one the ceiling skipped) is left out.
 */
export function tracePlan(result) {
  const plan = [];
  for (const caseResult of result.cases ?? []) {
    for (const arm of ["with", "without"]) {
      (caseResult.arms?.[arm] ?? []).forEach((run, i) => {
        if (typeof run.tracePath !== "string" || run.tracePath === "") return;
        const parts = run.tracePath.split("/");
        plan.push({
          from: run.tracePath,
          to: `traces/${jobOf(caseResult)}/${caseResult.name}/${arm}-${i + 1}.jsonl`,
          // <kept>/out/trace.jsonl: the try's folder is two levels up.
          keptDir: parts.slice(0, -2).join("/"),
        });
      });
    }
  }
  return plan;
}

/** The job of a result's case, from its `dir` (`evals/<job>/<case>`, or `<job>/<case>`). */
export function jobOf(caseResult) {
  const parts = String(caseResult.dir ?? "").split("/").filter((part) => part !== "" && part !== "evals");
  return parts.length >= 2 ? parts[0] : "unknown";
}

function armSummary(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return undefined;
  const scored = runs.filter((run) => run.error === null || run.error === undefined);
  const passed = runs.length > 0 && runs.every((run) => run.passed === true);
  const mean = runs.reduce((sum, run) => sum + (typeof run.score === "number" ? run.score : 0), 0) / runs.length;
  const fired = runs.flatMap((run) => (run.graders ?? []).filter((grader) => grader.withOnly === true).map((grader) => grader.passed === true));
  return { tries: runs.length, errored: runs.length - scored.length, passed, mean, fired };
}

/**
 * The per-job summary of a `claude plugin eval --json` result: for each job,
 * the cases, how many passed (every try clean) and the mean score, with the
 * plugin and without it, and how often the plugin's skill fired; and the
 * run's cost and time. Jobs keep JOBS' order; a job with no case in the
 * result is left out.
 */
export function summarizeResult(result) {
  const byJob = new Map();
  for (const caseResult of result.cases ?? []) {
    const job = jobOf(caseResult);
    const row = byJob.get(job) ?? { job, cases: 0, with: { passed: 0, meanSum: 0, n: 0 }, without: { passed: 0, meanSum: 0, n: 0 }, fired: [], errored: 0, failing: [] };
    row.cases += 1;
    for (const arm of ["with", "without"]) {
      const summary = armSummary(caseResult.arms?.[arm]);
      if (summary === undefined) continue;
      row[arm].n += 1;
      row[arm].meanSum += summary.mean;
      if (summary.passed) row[arm].passed += 1;
      row.errored += summary.errored;
      if (arm === "with") {
        row.fired.push(...summary.fired);
        if (!summary.passed) row.failing.push(caseResult.name);
      }
    }
    byJob.set(job, row);
  }
  const order = (job) => (JOBS.includes(job) ? JOBS.indexOf(job) : JOBS.length);
  const jobs = [...byJob.values()]
    .sort((a, b) => order(a.job) - order(b.job) || a.job.localeCompare(b.job))
    .map((row) => ({
      job: row.job,
      cases: row.cases,
      with: row.with.n === 0 ? undefined : { passed: row.with.passed, mean: row.with.meanSum / row.with.n },
      without: row.without.n === 0 ? undefined : { passed: row.without.passed, mean: row.without.meanSum / row.without.n },
      skillFired: row.fired.length === 0 ? undefined : row.fired.filter(Boolean).length / row.fired.length,
      erroredTries: row.errored,
      failingWith: row.failing,
    }));
  return {
    jobs,
    costUsd: result.costUsd,
    durationSeconds: result.durationSeconds,
    partial: result.partial === true,
    claudeVersion: result.claudeVersion,
    model: result.suite?.modelOverride,
  };
}

function cell(arm, cases) {
  return arm === undefined ? "–" : `${arm.passed}/${cases} (${arm.mean.toFixed(2)})`;
}

/** The summary as a Markdown table: one row per job, then the totals. */
export function renderSummary(summary) {
  const lines = ["| Job | Cases | With the plugin | Without | Skill fired |", "| --- | --- | --- | --- | --- |"];
  let cases = 0;
  let withPassed = 0;
  let withoutPassed = 0;
  for (const row of summary.jobs) {
    cases += row.cases;
    withPassed += row.with?.passed ?? 0;
    withoutPassed += row.without?.passed ?? 0;
    const fired = row.skillFired === undefined ? "–" : `${Math.round(row.skillFired * 100)}%`;
    lines.push(`| ${row.job} | ${row.cases} | ${cell(row.with, row.cases)} | ${cell(row.without, row.cases)} | ${fired} |`);
  }
  const anyWithout = summary.jobs.some((row) => row.without !== undefined);
  lines.push(`| **all** | ${cases} | ${withPassed}/${cases} | ${anyWithout ? `${withoutPassed}/${cases}` : "–"} | |`);
  const cost = typeof summary.costUsd === "number" ? `$${summary.costUsd.toFixed(2)} API-equivalent` : "cost unknown";
  const minutes = typeof summary.durationSeconds === "number" ? `${Math.round(summary.durationSeconds / 60)} min` : "time unknown";
  lines.push("", `Passed = every try clean (cases passed / cases, mean score in brackets). ${cost}, ${minutes}${summary.partial ? ", PARTIAL (the cost ceiling stopped it)" : ""}.`);
  return lines.join("\n");
}

/** The spread as a Markdown table; a noisy job is marked. */
export function renderSpread(rows) {
  const lines = ["| Job | Earlier | This run | Spread |", "| --- | --- | --- | --- |"];
  for (const row of rows) {
    lines.push(`| ${row.job} | ${row.first ?? "–"} | ${row.second ?? "–"} | ${row.spread ?? "–"}${row.noisy ? " (noisy)" : ""} |`);
  }
  return lines.join("\n");
}

/**
 * Two with-plugin readings of the same bank, compared per job: the
 * difference in cases passed, and `noisy` when it is more than one case, so
 * a gain smaller than the noise is not read as real.
 */
export function spreadBetween(first, second) {
  const second_ = new Map(second.jobs.map((row) => [row.job, row]));
  return first.jobs.map((row) => {
    const other = second_.get(row.job);
    const a = row.with?.passed;
    const b = other?.with?.passed;
    const spread = a === undefined || b === undefined ? undefined : Math.abs(a - b);
    return { job: row.job, first: a, second: b, spread, noisy: spread !== undefined && spread > 1 };
  });
}
