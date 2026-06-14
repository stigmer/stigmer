// Builds the root commander program: global flags, the preAction hook that
// captures them into process-global runtime state, and command registration.
//
// Command modules are registered through small `register*` functions so the
// entry path stays light; heavier commands lazy-load their implementation via
// dynamic import inside the action (DD-001), so `stigmer --help`/`version`/
// `completion` never pay for importing the backend client or auth stack.

import { Command } from "commander";
import { registerApiKey } from "./commands/apikey/index.js";
import { registerApply } from "./commands/apply.js";
import { registerAuth } from "./commands/auth/index.js";
import { registerCompletion } from "./commands/completion.js";
import { registerConfig } from "./commands/config/index.js";
import { registerConnect } from "./commands/connect.js";
import { registerDelete } from "./commands/delete.js";
import { registerDiff } from "./commands/diff.js";
import { registerDown } from "./commands/down.js";
import { registerDownload } from "./commands/download.js";
import { registerDraft } from "./commands/draft.js";
import { registerExecution } from "./commands/execution/index.js";
import { registerGet } from "./commands/get.js";
import { registerInternalDaemon } from "./commands/internal-daemon.js";
import { registerList } from "./commands/list.js";
import { registerLogs } from "./commands/logs.js";
import { registerMcpServer } from "./commands/mcp-server.js";
import { registerPush } from "./commands/push.js";
import { registerReset } from "./commands/reset.js";
import { registerResume } from "./commands/resume.js";
import { registerRun } from "./commands/run.js";
import { registerSearch } from "./commands/search.js";
import { registerSetup } from "./commands/setup.js";
import { registerStatus } from "./commands/status.js";
import { registerTag } from "./commands/tag.js";
import { registerUp } from "./commands/up.js";
import { registerUsage } from "./commands/usage.js";
import { registerValidate } from "./commands/validate.js";
import { registerVersion } from "./commands/version.js";
import { setDebug, setStandalone } from "./runtime.js";
import { VERSION } from "./version.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("stigmer")
    .description("Stigmer command-line interface")
    .version(VERSION, "--version", "print the CLI version")
    .option("-d, --debug", "enable debug output")
    .option("--standalone", "ignore the config file; use flags and environment only")
    .option("--org <slug>", "organization slug override")
    .option("--api-key <key>", "API key for authentication")
    .enablePositionalOptions();

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
  registerDiff(program);
  registerUsage(program);
  registerPush(program);
  registerDownload(program);
  registerApply(program);
  registerRun(program);
  registerResume(program);
  registerDraft(program);
  registerExecution(program);
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
