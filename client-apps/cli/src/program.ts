// Builds the root commander program: global flags, the preAction hook that
// captures them into process-global runtime state, and command registration.
//
// Command modules are registered through small `register*` functions so the
// entry path stays light; heavier commands lazy-load their implementation via
// dynamic import inside the action, so `stigmer --help`/`version`/
// `completion` never pay for importing the backend client or auth stack.

import { Command } from "commander";
import { registerApiKey } from "./commands/apikey/index.js";
import { registerApply } from "./commands/apply.js";
import { registerAuth } from "./commands/auth/index.js";
import { registerCompletion } from "./commands/completion.js";
import { registerConfig } from "./commands/config/index.js";
import { registerConnect } from "./commands/connect.js";
import { registerDelete } from "./commands/delete.js";
import { registerDown } from "./commands/down.js";
import { registerDownload } from "./commands/download.js";
import { registerGet } from "./commands/get.js";
import { registerInstall } from "./commands/install.js";
import { registerInternalDaemon } from "./commands/internal-daemon.js";
import { registerList } from "./commands/list.js";
import { registerLogs } from "./commands/logs.js";
import { registerMarketplace } from "./commands/marketplace.js";
import { registerMcpServer } from "./commands/mcp-server.js";
import { registerPush } from "./commands/push.js";
import { registerReset } from "./commands/reset.js";
import { registerResume } from "./commands/resume.js";
import { registerRun } from "./commands/run.js";
import { registerRuns } from "./commands/runs/index.js";
import { registerSchedule } from "./commands/schedule.js";
import { registerSearch } from "./commands/search.js";
import { registerSetup } from "./commands/setup.js";
import { registerShare } from "./commands/share.js";
import { registerStatus } from "./commands/status.js";
import { registerTag } from "./commands/tag.js";
import { registerUp } from "./commands/up.js";
import { registerUsage } from "./commands/usage.js";
import { registerValidate } from "./commands/validate.js";
import { registerVault } from "./commands/vault.js";
import { registerVersion } from "./commands/version.js";
import { setDebug, setStandalone } from "./runtime.js";
import { VERSION } from "./version.js";

/**
 * Top-level commands the CLI once had and no longer does. Typing one is an
 * old habit, not a typo, so commander's unknown-command answer gains the one
 * line here naming what replaced it. The old word is not an alias: it does
 * nothing but fail with this pointer.
 */
export const RETIRED_COMMANDS: ReadonlyMap<string, string> = new Map([
  ["execution", "`stigmer execution` is now `stigmer runs` (cancel, terminate, pause, resume, logs, trace, approve)."],
]);

/**
 * Options a command once had and no longer does, by the command's name: a
 * run and a connect carry no keys of their own, so a key is saved in a vault
 * and they read it there. As with {@link RETIRED_COMMANDS}, commander's
 * unknown-option answer on that command gains the one line here; the option
 * itself is gone, not hidden. Only the commands listed ever took these
 * options, so another command meeting the same word answers with commander's
 * error alone.
 */
const RETIRED_RUN_OPTION_HINT =
  "A run no longer takes keys on the command line: save it with `stigmer vault set-secret NAME --mine`, then run.";

const RETIRED_CONNECT_OPTION_HINT =
  "A connect no longer takes keys on the command line: save it with `stigmer vault set-secret NAME --mine`, then connect.";

export const RETIRED_OPTIONS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  [
    "run",
    new Map([
      ["--env", RETIRED_RUN_OPTION_HINT],
      ["--env-file", RETIRED_RUN_OPTION_HINT],
      ["--secret", RETIRED_RUN_OPTION_HINT],
      ["--secret-file", RETIRED_RUN_OPTION_HINT],
    ]),
  ],
  ["connect", new Map([["--env", RETIRED_CONNECT_OPTION_HINT]])],
]);

// Append a retired command's or option's pointer to commander's unknown
// command or option error. `command` is the top-level command the parse
// dispatched to, if any. A retired option is answered with its name alone,
// never the rest of commander's message: written as `--secret=KEY=VALUE`,
// commander echoes the whole argument, and the value (which may hold quotes
// or newlines) may be the key itself.
function withRetiredHint(message: string, command: string | undefined): string {
  const unknownCommand = /^error: unknown command '([^']+)'/.exec(message);
  if (unknownCommand !== null) {
    const hint = RETIRED_COMMANDS.get(unknownCommand[1]);
    return hint === undefined ? message : `${message}${hint}\n`;
  }
  const option = /^error: unknown option '(--[A-Za-z0-9-]+)(?=['=])/.exec(message);
  const hint = option === null || command === undefined ? undefined : RETIRED_OPTIONS.get(command)?.get(option[1]);
  if (option === null || hint === undefined) return message;
  return `error: unknown option '${option[1]}'\n${hint}\n`;
}

export function buildProgram(): Command {
  const program = new Command();
  // The top-level command this parse runs, so a retired option's pointer is
  // given only on the command that once took it.
  let dispatched: string | undefined;

  program
    .name("stigmer")
    .description("Stigmer command-line interface")
    .version(VERSION, "--version", "print the CLI version")
    .option("-d, --debug", "enable debug output")
    .option("--standalone", "ignore the config file; use flags and environment only")
    .option("--org <slug>", "organization, on servers that hold several")
    .option("--api-key <key>", "API key for authentication")
    .enablePositionalOptions()
    .configureOutput({ outputError: (message, write) => write(withRetiredHint(message, dispatched)) });

  program.hook("preSubcommand", (_program, subcommand) => {
    dispatched = subcommand.name();
  });

  // Capture global flags into process-global state before any command runs.
  // Bridging --api-key to the env mirrors the Go CLI's PersistentPreRun so the
  // SDK auth interceptor and config layer pick it up uniformly.
  program.hook("preAction", () => {
    const globals = program.opts();
    setDebug(Boolean(globals.debug));
    setStandalone(Boolean(globals.standalone));
    if (typeof globals.apiKey === "string" && globals.apiKey !== "") {
      process.env.STIGMER_API_KEY = globals.apiKey;
    }
  });

  registerVersion(program);
  registerCompletion(program);
  registerConfig(program);
  registerAuth(program);
  registerApiKey(program);
  registerGet(program);
  registerList(program);
  registerSearch(program);
  registerValidate(program);
  registerDelete(program);
  registerTag(program);
  registerShare(program);
  registerSchedule(program);
  registerVault(program);
  registerUsage(program);
  registerPush(program);
  registerInstall(program);
  registerMarketplace(program);
  registerDownload(program);
  registerApply(program);
  registerRun(program);
  registerResume(program);
  registerRuns(program);
  registerConnect(program);
  registerMcpServer(program);
  registerUp(program);
  registerDown(program);
  registerStatus(program);
  registerLogs(program);
  registerSetup(program);
  registerReset(program);
  registerInternalDaemon(program);

  return program;
}
