/**
 * The coding-agent question bank's fixture (coding-agents/evals/_fixture/),
 * seeded on the hermetic stage and put back between tries.
 *
 * `seedFixture` runs once per bank run, in the runner
 * (test/install/coding-agent-bank.mjs): it signs the stage's CLI in, pushes
 * the vendor-aliases skill, applies the two agents and runs each once:
 * invoice-checker finishes and saves its report, reconciler fails on the
 * provider's credit refusal (the fake model answers both the same way every
 * time: coding-agent-bank.mjs, fixtureScript).
 *
 * `restoreFixture` runs before every try of a case that acts: a coding
 * agent that fails a case may delete or change what the next try reads (in
 * the pilot, the with-plugin arm deleted both agents when asked to, and the
 * no-plugin arm then met an empty organization). The runner puts
 * `stigmer-bank-fixture` on PATH, and each acting case's scaffold script,
 * which `claude plugin eval` runs before every try, outside its sandbox,
 * calls it. It applies the agents again (which puts back changed
 * instructions and is a no-op otherwise), pushes the skill if it is gone,
 * runs again any agent that had to be made anew, so its run is there to
 * read, and deletes every service account, of which the fixture has none
 * (a try that made one, `ci-runner` say, would otherwise make the next try
 * meet a name already taken). When nothing is missing it costs a few reads.
 *
 * `writeProjectManifests` then gives the try's folder what a person who set
 * up holds: each fixture agent's manifest at `stigmer/<agent>.yaml`, as the
 * setup guide's step 2 leaves it. Without it a prompt that never says
 * "Stigmer" ("run invoice-checker on samples/march.csv") meets a folder
 * holding only the sample, and an agent cannot tell it is a Stigmer project.
 *
 * Every call goes through the stage's `stigmer` shim, asynchronously: in the
 * runner, the issuer and the fake model live in the same process.
 */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { FIXTURE } from "./coding-agent-bank.mjs";

/** The fixture's folder in this checkout. */
export const FIXTURE_DIR = fileURLToPath(new URL("../../../coding-agents/evals/_fixture", import.meta.url));

/** The command each acting case's scaffold calls to put the fixture back. */
export const RESTORE_COMMAND = "stigmer-bank-fixture";

function run(stigmer, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(stigmer, args, { env, cwd: FIXTURE_DIR, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output }));
  });
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)).map((f) => join(entry.name, f)) : [entry.name],
  );
}

/** A `stigmer` caller that throws naming the command and its output when it fails. */
function caller(stigmer, env) {
  return async (args, { mayFail = false } = {}) => {
    const result = await run(stigmer, args, env);
    if (!mayFail && result.status !== 0) throw new Error(`\`stigmer ${args.join(" ")}\` exited ${result.status}:\n${result.output}`);
    return result;
  };
}

/** Runs invoice-checker once and checks its saved report starts with the fixture's line. */
async function runInvoiceAgent(stigmer) {
  const downloads = mkdtempSync(join(tmpdir(), "bank-fixture-"));
  try {
    await stigmer(["run", FIXTURE.invoiceAgent, "--attach", join(FIXTURE_DIR, "samples", "march.csv"), "--download", downloads, "--until", "turn", "-m", "Check March's supplier invoices."]);
    const saved = filesUnder(downloads).find((file) => file.endsWith(FIXTURE.invoiceFile));
    if (saved === undefined) throw new Error(`${FIXTURE.invoiceAgent}'s run saved no ${FIXTURE.invoiceFile} (found: ${filesUnder(downloads).join(", ") || "nothing"})`);
    if (!readFileSync(join(downloads, saved), "utf8").startsWith(FIXTURE.invoiceFirstLine)) throw new Error(`${FIXTURE.invoiceFile} does not start with the fixture's line`);
  } finally {
    rmSync(downloads, { recursive: true, force: true });
  }
}

/** Runs reconciler once and checks it failed on the provider's credit refusal. */
async function runReconciler(stigmer) {
  const failed = await stigmer(["run", FIXTURE.reconcilerAgent, "--until", "turn", "-m", "Reconcile yesterday's statement."], { mayFail: true });
  if (failed.status === 0) throw new Error(`${FIXTURE.reconcilerAgent}'s run succeeded; the fixture needs it failed`);
  if (!/credit balance/i.test(failed.output)) throw new Error(`${FIXTURE.reconcilerAgent}'s failed run does not say the provider's reason:\n${failed.output}`);
}

/**
 * Signs the stage's CLI in against `serverUrl` and seeds the fixture.
 * @param {{ stigmer: string, env: NodeJS.ProcessEnv, serverUrl: string, log: (line: string) => void }} opts
 */
export async function seedFixture({ stigmer: shim, env, serverUrl, log }) {
  const stigmer = caller(shim, env);
  await stigmer(["config", "backend", "add", "bank", "--endpoint", new URL(serverUrl).host]);
  await stigmer(["config", "backend", "use", "bank"]);
  await stigmer(["auth", "login"]);
  await stigmer(["push", "skill", join(FIXTURE_DIR, "skills", FIXTURE.skill)]);
  await stigmer(["apply", "-f", join(FIXTURE_DIR, "agents")]);
  await runInvoiceAgent(stigmer);
  log(`seeded ${FIXTURE.invoiceAgent}'s finished run (${FIXTURE.invoiceFile} saved)`);
  await runReconciler(stigmer);
  log(`seeded ${FIXTURE.reconcilerAgent}'s failed run (the provider's credit refusal)`);
}

/** The slugs in a `stigmer … list --json` answer, whichever list shape it has. */
export function listedSlugs(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed?.items) ? parsed.items : [];
  return items.map((item) => item?.metadata?.slug ?? item?.slug ?? item?.metadata?.name ?? item?.name).filter((slug) => typeof slug === "string" && slug !== "");
}

/**
 * Puts back what an earlier try deleted or changed; returns what it put
 * back (empty when nothing was missing).
 * @param {{ stigmer: string, env: NodeJS.ProcessEnv }} opts
 */
export async function restoreFixture({ stigmer: shim, env }) {
  const stigmer = caller(shim, env);
  const exists = async (kind, slug) => (await stigmer(["get", kind, slug], { mayFail: true })).status === 0;
  const restored = [];
  if (!(await exists("skill", FIXTURE.skill))) {
    await stigmer(["push", "skill", join(FIXTURE_DIR, "skills", FIXTURE.skill)]);
    restored.push(`skill ${FIXTURE.skill}`);
  }
  const invoiceMissing = !(await exists("agent", FIXTURE.invoiceAgent));
  const reconcilerMissing = !(await exists("agent", FIXTURE.reconcilerAgent));
  await stigmer(["apply", "-f", join(FIXTURE_DIR, "agents")]);
  if (invoiceMissing) {
    await runInvoiceAgent(stigmer);
    restored.push(`agent ${FIXTURE.invoiceAgent} and its finished run`);
  }
  if (reconcilerMissing) {
    await runReconciler(stigmer);
    restored.push(`agent ${FIXTURE.reconcilerAgent} and its failed run`);
  }
  const accounts = await stigmer(["service-account", "list", "--json"], { mayFail: true });
  for (const slug of accounts.status === 0 ? listedSlugs(accounts.output) : []) {
    await stigmer(["service-account", "delete", slug, "--force"]);
    restored.push(`no service account ${slug}`);
  }
  return restored;
}

/** The folder in a person's project where the setup guide keeps their agents' manifests. */
export const PROJECT_MANIFESTS = "stigmer";

/**
 * Copies each fixture agent's manifest into `<projectDir>/stigmer/`, as a
 * person who set up holds them; returns the paths written, relative to
 * `projectDir`.
 * @param {string} projectDir
 */
export function writeProjectManifests(projectDir) {
  const into = join(projectDir, PROJECT_MANIFESTS);
  mkdirSync(into, { recursive: true });
  const agents = join(FIXTURE_DIR, "agents");
  return readdirSync(agents)
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => {
      copyFileSync(join(agents, name), join(into, name));
      return join(PROJECT_MANIFESTS, name);
    });
}

/* v8 ignore start -- @preserve: the scaffold's entry (`stigmer-bank-fixture`), run by claude plugin eval before each acting try */
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--restore")) {
  restoreFixture({ stigmer: "stigmer", env: process.env })
    .then((restored) => {
      if (restored.length > 0) process.stdout.write(`${RESTORE_COMMAND}: put back ${restored.join("; ")}\n`);
      // The scaffold runs in the try's own folder: lay out the set-up project there.
      writeProjectManifests(process.cwd());
    })
    .catch((error) => {
      process.stderr.write(`${RESTORE_COMMAND}: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
/* v8 ignore stop */
