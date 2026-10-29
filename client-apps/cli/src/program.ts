// Builds the root commander program: global flags, the preAction hook that
// captures them into process-global runtime state, and command registration.
//
// Command modules are registered through small `register*` functions so the
// entry path stays light; heavier commands lazy-load their implementation via
// dynamic import inside the action, so `stigmer --help`/`version`/
// `completion` never pay for importing the backend client or auth stack.

import { Command } from "commander";
import { registerApiKey } from "./commands/apikey/index.js";
import { registerAgent } from "./commands/agent.js";
import { registerApply } from "./commands/apply.js";
import { registerChannel } from "./commands/channel.js";
import { registerAuth } from "./commands/auth/index.js";
import { registerCompletion } from "./commands/completion.js";
import { registerConfig } from "./commands/config/index.js";
import { registerConnect } from "./commands/connect.js";
import { registerDelete } from "./commands/delete.js";
import { registerDown } from "./commands/down.js";
import { registerDownload } from "./commands/download.js";
import { registerEval } from "./commands/eval.js";
import { registerFile } from "./commands/file.js";
import { registerGet } from "./commands/get.js";
import { registerInstall } from "./commands/install.js";
import { registerInternalDaemon } from "./commands/internal-daemon.js";
import { registerList } from "./commands/list.js";
import { registerLogs } from "./commands/logs.js";
import { registerMarketplace } from "./commands/marketplace.js";
import { registerMcp } from "./commands/mcp.js";
import { registerMcpServer } from "./commands/mcp-server.js";
import { registerProviderKey } from "./commands/provider-key/index.js";
import { registerPush } from "./commands/push.js";
import { registerReset } from "./commands/reset.js";
import { registerResume } from "./commands/resume.js";
import { registerRun } from "./commands/run.js";
import { registerRuns } from "./commands/runs/index.js";
import { registerRoutine } from "./commands/routine.js";
import { registerServiceAccount } from "./commands/service-account/index.js";
import { registerAccessHistory } from "./commands/access-history/index.js";
import { registerSearch } from "./commands/search.js";
import { registerSetup } from "./commands/setup.js";
import { registerStatus } from "./commands/status.js";
import { registerTag } from "./commands/tag.js";
import { registerUp } from "./commands/up.js";
import { registerUsage } from "./commands/usage.js";
import { registerValidate } from "./commands/validate.js";
import { registerVault } from "./commands/vault.js";
import { registerVersion } from "./commands/version.js";
import { setDebug, setStandalone } from "./runtime.js";
import { VERSION } from "./version.js";

// Commander echoes an unknown option exactly as typed, so `--name=VALUE`
// would print the value, which may be a key pasted onto the wrong flag. The
// answer names the option alone.
function withoutOptionValue(message: string): string {
  const option = /^error: unknown option '(--[A-Za-z0-9-]+)=/.exec(message);
  return option === null ? message : `error: unknown option '${option[1]}'\n`;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("stigmer")
    .description("Command-line interface for Stigmer, the open-source backend for the agents in your product")
    .version(VERSION, "--version", "print the CLI version")
    .option("-d, --debug", "enable debug output")
    .option("--standalone", "ignore the config file; use flags and environment only")
    .option("--org <slug>", "organization, on servers that hold several")
    .option("--api-key <key>", "API key for authentication")
    .enablePositionalOptions()
    .configureOutput({ outputError: (message, write) => write(withoutOptionValue(message)) });

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
  registerServiceAccount(program);
  registerProviderKey(program);
  registerAccessHistory(program);
  registerGet(program);
  registerList(program);
  registerSearch(program);
  registerValidate(program);
  registerDelete(program);
  registerTag(program);
  registerChannel(program);
  registerRoutine(program);
  registerFile(program);
  registerVault(program);
  registerUsage(program);
  registerPush(program);
  registerInstall(program);
  registerMarketplace(program);
  registerEval(program);
  registerAgent(program);
  registerDownload(program);
  registerApply(program);
  registerRun(program);
  registerResume(program);
  registerRuns(program);
  registerConnect(program);
  registerMcp(program);
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
