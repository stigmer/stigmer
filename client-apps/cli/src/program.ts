// Builds the root commander program: global flags (written before the
// command, or after it, global-options.ts), the preAction hook that captures
// them into process-global runtime state, command registration, and the
// command-line errors every command words alike (errors/command-line.ts).
// `--org`, `--debug` and `--standalone` may follow the command; `--api-key`
// only precedes it.
// Commands register in their help groups' order, and help.ts gives each its
// group and examples.
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
import { applyHelp } from "./commands/help.js";
import { setActionCommand, setDebug, setStandalone } from "./runtime.js";
import { commandPath } from "./command-tree.js";
import { installCommandLineErrors } from "./errors/command-line.js";
import { acceptGlobalsAfterCommand, addGlobalOptions, helpConfiguration, readGlobalOptions } from "./global-options.js";
import { VERSION } from "./version.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("stigmer")
    .description("Command-line interface for Stigmer, the open-source backend for the agents in your product")
    .version(VERSION, "--version", "print the CLI version")
    .enablePositionalOptions()
    .configureHelp(helpConfiguration);
  addGlobalOptions(program);

  // Capture global flags into process-global state before any command runs,
  // reading the action command's own copy first (global-options.ts).
  // Bridging --api-key to the env lets the SDK auth interceptor and config
  // layer pick it up uniformly.
  program.hook("preAction", (root, action) => {
    const globals = readGlobalOptions(root, action);
    setDebug(globals.debug);
    setStandalone(globals.standalone);
    setActionCommand(commandPath(action));
    if (globals.apiKey !== "") {
      process.env.STIGMER_API_KEY = globals.apiKey;
    }
  });

  // Run agents
  registerRun(program);
  registerResume(program);
  registerRuns(program);
  // Your library
  registerGet(program);
  registerList(program);
  registerSearch(program);
  registerApply(program);
  registerValidate(program);
  registerDelete(program);
  registerTag(program);
  registerAgent(program);
  registerRoutine(program);
  registerChannel(program);
  registerVault(program);
  registerFile(program);
  registerConnect(program);
  // Packages
  registerPush(program);
  registerInstall(program);
  registerMarketplace(program);
  registerMcp(program);
  registerEval(program);
  registerDownload(program);
  // Local stack
  registerUp(program);
  registerDown(program);
  registerStatus(program);
  registerLogs(program);
  registerSetup(program);
  registerReset(program);
  registerMcpServer(program);
  // Account and access
  registerAuth(program);
  registerApiKey(program);
  registerServiceAccount(program);
  registerProviderKey(program);
  registerAccessHistory(program);
  registerUsage(program);
  // Configuration
  registerConfig(program);
  registerCompletion(program);
  registerVersion(program);
  registerInternalDaemon(program);

  // After registration, so every command is reached.
  acceptGlobalsAfterCommand(program);
  applyHelp(program);
  installCommandLineErrors(program);

  return program;
}
