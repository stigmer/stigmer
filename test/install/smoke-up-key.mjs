#!/usr/bin/env node

/**
 * `stigmer up` and `stigmer setup` check the model key with the provider
 * before calling it ready, and on a terminal ask again when it is rejected
 * (stigmer#3036): the CLI's end to end, on `stigmer up` from source in a
 * scratch home, against test/support's fake model, which refuses
 * FAKE_REJECTED_KEY's check (401), does not answer FAKE_UNANSWERED_KEY's (503)
 * and takes any other key. The fake's address is exported as a person exports
 * a gateway (ANTHROPIC_BASE_URL), so the CLI checks each key where the runner
 * sends it, and every case stops its stack with `stigmer down`.
 *
 * The cases:
 *   1. `stigmer setup --provider anthropic --api-key <rejected>` exits 1 with
 *      the rejected sentence and saves nothing.
 *   2. The saved key is the rejected one; on a terminal, `stigmer up` says so
 *      and asks; the answer is a good key, pasted with its Enter in one write;
 *      it says "accepted", the card says the key was checked just now, and a
 *      first run's model call carries the new key, so it reached the runner
 *      in this start, with no restart.
 *   3. Off a terminal, an exported rejected key: the card says "not ready
 *      anthropic key rejected" before any run, and nothing is asked.
 *   4. Off a terminal, a key the fake does not answer for: the card says the
 *      key is not checked, and agents are ready.
 *   5. No key and no gateway, on a terminal: the prompt says why and where to
 *      get a key; Enter skips; the card says there is no model provider.
 *
 * A terminal is a pseudo-terminal (test/install/lib/pty-run.py), as a person
 * types at it. `stigmer up` serves on port 7234, so the smoke refuses before
 * anything starts when that port is taken: another stack is running.
 *
 * Usage:
 *   node test/install/smoke-up-key.mjs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { FAKE_MODEL_API_KEY, FAKE_REJECTED_KEY, FAKE_UNANSWERED_KEY, startFakeModel } from "./lib/fake-model.mjs";
import { CLI_SERVER_PORT, createCliInstall, spawnCommand } from "./lib/install-cli.mjs";
import { assertPortFree } from "./lib/stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const PTY_RUN = join(repoRoot, "test", "install", "lib", "pty-run.py");
// The first `up` may download the Temporal CLI and the runtimes.
const UP_TIMEOUT_MS = 300_000;
const AGENT = "key-smoke-agent";

/** What the prompt and the card say, restated here: the install layer imports no CLI source. */
export const SAYS = {
  why: "Your agents think with a model. Stigmer uses your own Anthropic key,",
  link: "https://console.anthropic.com/settings/keys",
  question: "Anthropic API key (Enter to skip)",
  rejectedSaved: "Anthropic rejected the saved key.",
  rejected: "Anthropic rejected this key. Check that it is a valid, active API key",
  accepted: "Checking with Anthropic… ✓ accepted",
  checked: "anthropic (gateway, key checked just now)",
  cardRejected: /not ready\s+anthropic key rejected/,
  cardUnchecked: "anthropic (gateway, key not checked: Anthropic didn't answer)",
  cardNoProvider: /not ready\s+no model provider/,
};

function log(step) {
  console.log(`smoke-up-key: ${step}`);
}

function expectIn(text, wanted, label) {
  const found = typeof wanted === "string" ? text.includes(wanted) : wanted.test(text);
  if (!found) throw new Error(`${label}: expected ${String(wanted)} in:\n${text}`);
}

function expectNotIn(text, unwanted, label) {
  if (text.includes(unwanted)) throw new Error(`${label}: did not expect ${JSON.stringify(unwanted)} in:\n${text}`);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) await main();

async function main() {
  try {
    await assertPortFree(CLI_SERVER_PORT);
  } catch (error) {
    console.error(`smoke-up-key: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const fake = await startFakeModel();
  const gateway = `http://127.0.0.1:${fake.port}`;
  // The install's own model settings are laid per case below; none by default.
  const stack = createCliInstall({ model: {}, log });
  const configFile = join(stack.home, ".stigmer", "config.yaml");
  let failed = false;
  const passed = [];

  /** The shell a case runs in: the install's, with exactly these model settings. */
  const shell = (model) => {
    const env = { ...stack.env };
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "STIGMER_ANTHROPIC_BACKEND", "STIGMER_PROXY_ENDPOINT"]) {
      delete env[key];
    }
    return { ...env, ...model };
  };

  /** `stigmer <args>` off a terminal, to its exit. */
  const offTerminal = async (args, model) => {
    log(`$ stigmer ${args.join(" ")}   (off a terminal)`);
    return spawnCommand(stack.command(), args, shell(model), UP_TIMEOUT_MS).done;
  };

  /** `stigmer <args>` on a pseudo-terminal, typing each answer when its text shows. */
  const onTerminal = async (args, model, answers) => {
    log(`$ stigmer ${args.join(" ")}   (on a terminal)`);
    const env = { ...shell(model), TERM: "xterm-256color" };
    delete env.CI;
    delete env.CONTINUOUS_INTEGRATION;
    const answerArgs = answers.flatMap(([text, keys]) => ["--answer", `${text}=${keys}`]);
    return spawnCommand(
      ["python3", PTY_RUN, "--timeout", String(UP_TIMEOUT_MS / 1000), "--cols", "120", ...answerArgs, "--"],
      stack.command(),
      env,
      UP_TIMEOUT_MS + 30_000,
    ).done;
  };

  const down = async () => {
    const result = await offTerminal(["down"], {});
    if (result.status !== 0) throw new Error(`stigmer down exited ${result.status}:\n${result.stderr}`);
  };

  const saveKey = (key) => {
    mkdirSync(join(stack.home, ".stigmer"), { recursive: true });
    writeFileSync(configFile, `backend:\n  local:\n    llm:\n      provider: anthropic\n      api_key: ${key}\n`, { mode: 0o600 });
  };
  const forgetKey = () => rmSync(configFile, { force: true });

  try {
    await stack.install({ kind: "build" });

    // 1. The flag form refuses a key Anthropic rejects, and saves nothing.
    {
      const result = await offTerminal(["setup", "--provider", "anthropic", "--api-key", FAKE_REJECTED_KEY], { ANTHROPIC_BASE_URL: gateway });
      if (result.status !== 1) throw new Error(`setup with a rejected key exited ${result.status}, expected 1:\n${result.stderr}`);
      expectIn(result.stderr, SAYS.rejected, "setup --api-key <rejected>");
      if (existsSync(configFile) && readFileSync(configFile, "utf8").includes(FAKE_REJECTED_KEY)) {
        throw new Error("setup saved a key Anthropic rejected");
      }
      passed.push("1. setup --api-key refuses a rejected key with exit 1 and saves nothing");
    }

    // 2. A saved key that is rejected: asked again on a terminal, the good key
    //    saved, checked, and carried by the first run's model call.
    {
      saveKey(FAKE_REJECTED_KEY);
      const result = await onTerminal(["up", "--no-web"], { ANTHROPIC_BASE_URL: gateway }, [[SAYS.question, `${FAKE_MODEL_API_KEY}\\r`]]);
      if (result.status !== 0) throw new Error(`stigmer up on a terminal exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
      const screen = result.stdout;
      for (const wanted of [SAYS.rejectedSaved, SAYS.why, SAYS.link, SAYS.accepted, "Saved for this computer's agents.", SAYS.checked]) {
        expectIn(screen, wanted, "stigmer up with a rejected saved key");
      }
      expectNotIn(screen, FAKE_MODEL_API_KEY, "the hidden prompt");
      expectIn(readFileSync(configFile, "utf8"), FAKE_MODEL_API_KEY, "the saved config");

      const agentPath = join(stack.home, `${AGENT}.yaml`);
      writeFileSync(
        agentPath,
        `apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: ${AGENT}\nspec:\n  description: A tool-less agent for the key smoke.\n  instructions: Answer the message in one short sentence.\n`,
      );
      const apply = await offTerminal(["apply", "-f", agentPath], { ANTHROPIC_BASE_URL: gateway });
      if (apply.status !== 0) throw new Error(`stigmer apply exited ${apply.status}:\n${apply.stderr}`);
      const before = fake.anthropicKeys().length;
      const run = await offTerminal(["run", AGENT, "-m", "Say hello.", "--json"], { ANTHROPIC_BASE_URL: gateway });
      if (run.status !== 0) throw new Error(`stigmer run exited ${run.status}:\n${run.stdout}\n${run.stderr}`);
      expectIn(run.stdout, fake.replyText, "the first run's stream");
      const carried = fake.anthropicKeys().slice(before);
      if (carried.length === 0 || carried.some((key) => key !== FAKE_MODEL_API_KEY)) {
        throw new Error(`the first run's model calls carried ${JSON.stringify(carried.map((key) => key.slice(0, 12)))}, not the key just entered`);
      }
      await down();
      forgetKey();
      passed.push("2. a rejected saved key is asked again on a terminal; the new key is checked and reaches the runner with no restart");
    }

    // 3. Off a terminal, an exported rejected key: said on the card, nothing asked.
    {
      const result = await offTerminal(["up", "--no-web"], { ANTHROPIC_API_KEY: FAKE_REJECTED_KEY, ANTHROPIC_BASE_URL: gateway });
      if (result.status !== 0) throw new Error(`stigmer up exited ${result.status}:\n${result.stderr}`);
      expectIn(result.stderr, SAYS.cardRejected, "stigmer up with an exported rejected key");
      expectIn(result.stderr, "Export a working ANTHROPIC_API_KEY", "stigmer up with an exported rejected key");
      expectNotIn(result.stderr, SAYS.question, "stigmer up off a terminal");
      await down();
      passed.push("3. off a terminal an exported rejected key is not ready on the card, and nothing is asked");
    }

    // 4. Off a terminal, a key the provider does not answer for: ready, not checked.
    {
      const result = await offTerminal(["up", "--no-web"], { ANTHROPIC_API_KEY: FAKE_UNANSWERED_KEY, ANTHROPIC_BASE_URL: gateway });
      if (result.status !== 0) throw new Error(`stigmer up exited ${result.status}:\n${result.stderr}`);
      expectIn(result.stderr, SAYS.cardUnchecked, "stigmer up with an unanswered key");
      await down();
      passed.push("4. a key the provider does not answer for is ready and said not checked");
    }

    // 5. No key and no gateway, on a terminal: why, the link, Enter skips.
    {
      const result = await onTerminal(["up", "--no-web"], {}, [[SAYS.question, "\\r"]]);
      if (result.status !== 0) throw new Error(`stigmer up on a terminal exited ${result.status}:\n${result.stdout}`);
      for (const wanted of [SAYS.why, SAYS.link, SAYS.cardNoProvider]) expectIn(result.stdout, wanted, "stigmer up with no key");
      expectNotIn(result.stdout, "Checking with Anthropic", "stigmer up with no key");
      if (existsSync(configFile)) throw new Error("a skipped prompt wrote the config");
      await down();
      passed.push("5. with no key the prompt says why and where to get one; Enter skips to no model provider");
    }

    log(`PASS: ${passed.length} cases\n  ${passed.join("\n  ")}`);
  } catch (error) {
    failed = true;
    console.error(`smoke-up-key: ${error instanceof Error ? error.message : String(error)}`);
    console.error(stack.diagnostics());
  } finally {
    await stack.stop({ keepHome: failed });
    await fake.close();
  }
  process.exit(failed ? 1 : 0);
}
