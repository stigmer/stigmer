// What `stigmer --help` and every command's help say beyond the options: the
// groups the top-level commands sit in, in the order a person reaches for
// them (run and resume first, then your library, then the local stack, then
// settings), and each runnable command's short examples.
//
// The groups are Commander's own (`helpGroup`), so the docs generator
// (scripts/gen-cli-docs.ts) reads a command's group from the command and the
// reference pages cannot disagree with help. Groups appear in the order their
// first command is registered (program.ts registers by group).
//
// Each example is declared once, here, and printed under "Examples:" by
// `examples` (command-tree.ts). A command's reference page keeps its own
// hand-written Examples section, whose prose explains a line; the docs check
// fails when a help example is missing from its page, so the two cannot
// drift. Every example is parsed through the real program in a test, so one
// that stops parsing fails the build.

import type { Command } from "commander";
import { commandPath, documentedCommands, examples, type HelpExample, runnableCommands } from "../command-tree.js";

/** The help groups, in the order help lists them. */
export const HELP_GROUPS = ["Run agents", "Your library", "Packages", "Local stack", "Account and access", "Configuration"] as const;

/** One help group's name. */
export type HelpGroup = (typeof HELP_GROUPS)[number];

/** The group of each top-level command a person sees. */
export const COMMAND_GROUPS: Readonly<Record<string, HelpGroup>> = {
  run: "Run agents",
  resume: "Run agents",
  runs: "Run agents",
  get: "Your library",
  list: "Your library",
  search: "Your library",
  apply: "Your library",
  validate: "Your library",
  delete: "Your library",
  tag: "Your library",
  agent: "Your library",
  routine: "Your library",
  channel: "Your library",
  vault: "Your library",
  file: "Your library",
  connect: "Your library",
  push: "Packages",
  install: "Packages",
  marketplace: "Packages",
  mcp: "Packages",
  eval: "Packages",
  download: "Packages",
  up: "Local stack",
  down: "Local stack",
  status: "Local stack",
  logs: "Local stack",
  setup: "Local stack",
  reset: "Local stack",
  "mcp-server": "Local stack",
  auth: "Account and access",
  apikey: "Account and access",
  "service-account": "Account and access",
  "provider-key": "Account and access",
  "access-history": "Account and access",
  usage: "Account and access",
  config: "Configuration",
  completion: "Configuration",
  version: "Configuration",
};

/** Each runnable command's examples, by path. */
export const HELP_EXAMPLES: ReadonlyMap<string, readonly HelpExample[]> = new Map<string, readonly HelpExample[]>([
  ["stigmer access-history export", [{ say: "everything, oldest first, one JSON object per line", run: "stigmer access-history export > access-history.jsonl" }, { say: "only what came after the last entry you hold", run: "stigmer access-history export --after 42 >> access-history.jsonl" }]],
  ["stigmer access-history list", [{ say: "the newest 50 changes", run: "stigmer access-history list" }, { say: "the newest 200, as JSON", run: "stigmer access-history list --limit 200 -o json" }]],
  ["stigmer agent quality", [{ say: "how the agent's runs were graded over the last 30 days, per version", run: "stigmer agent quality variance-reporter" }, { say: "the last week's failed grades, newest first", run: "stigmer agent quality variance-reporter --days 7 --flagged --limit 50" }]],
  ["stigmer apikey create", [{ say: "create a new API key", run: "stigmer apikey create --name \"ci-pipeline\"" }, { say: "create a key that never expires", run: "stigmer apikey create --name \"automation\" --never-expires" }]],
  ["stigmer apikey fingerprint", [{ say: "look up which key matches a raw token", run: "stigmer apikey fingerprint stk_abc123..." }]],
  ["stigmer apply", [{ say: "apply a single resource file", run: "stigmer apply -f agent.yaml" }, { say: "apply all resources in a directory", run: "stigmer apply -f ./manifests/" }]],
  ["stigmer auth login", [{ say: "log in to Stigmer Cloud", run: "stigmer auth login" }]],
  ["stigmer auth logout", [{ say: "log out", run: "stigmer auth logout" }]],
  ["stigmer auth whoami", [{ say: "check who you're logged in as", run: "stigmer auth whoami" }]],
  ["stigmer channel disable", [{ say: "pause any channel (web, Slack or WhatsApp), keeping its configuration", run: "stigmer channel disable acme-corp/variance-reporter-slack" }]],
  ["stigmer channel enable", [{ say: "turn it back on", run: "stigmer channel enable acme-corp/variance-reporter-slack" }]],
  ["stigmer channel link", [{ say: "turn on an Agent's chat link for your Organization's members", run: "stigmer channel link variance-reporter" }, { say: "make the link public and print the embed snippet", run: "stigmer channel link variance-reporter --audience public" }]],
  ["stigmer completion", [{ say: "install permanently", run: "stigmer completion bash > /etc/bash_completion.d/stigmer" }]],
  ["stigmer config backend add", [{ say: "register a self-hosted server (mint the key with `stigmer apikey create`)", run: "stigmer config backend add staging --endpoint stigmer.example.com:7234 --api-key stk_..." }]],
  ["stigmer config backend list", [{ say: "see what is configured", run: "stigmer config backend list" }]],
  ["stigmer config backend remove", [{ say: "remove one (switch away from it first)", run: "stigmer config backend remove staging" }]],
  ["stigmer config backend set", [{ say: "switch backend", run: "stigmer config backend set cloud" }]],
  ["stigmer config backend status", [{ say: "show which backend is active and whether it answers", run: "stigmer config backend status" }]],
  ["stigmer config backend use", [{ say: "switch between backends", run: "stigmer config backend use staging" }]],
  ["stigmer config context set", [{ say: "set active organization", run: "stigmer config context set --org my-org" }]],
  ["stigmer config context show", [{ say: "show the active organization", run: "stigmer config context show" }]],
  ["stigmer config get", [{ say: "print the active organization", run: "stigmer config get context.org" }]],
  ["stigmer config list", [{ say: "list all configuration values", run: "stigmer config list" }]],
  ["stigmer config path", [{ say: "show the config file path", run: "stigmer config path" }]],
  ["stigmer config set", [{ say: "make acme the active organization", run: "stigmer config set context.org acme" }]],
  ["stigmer connect plugin", [{ say: "list the tools the linear plugin's MCP server offers", run: "stigmer connect plugin linear" }]],
  ["stigmer delete", [{ say: "delete an agent by slug", run: "stigmer delete agent my-agent" }, { say: "delete an agent by ID", run: "stigmer delete agent agt_abc123" }]],
  ["stigmer down", [{ say: "stop the local stack", run: "stigmer down" }]],
  ["stigmer down server", [{ say: "stop the whole stack, as stigmer down does", run: "stigmer down server" }]],
  ["stigmer download", [{ say: "download all outputs from a run", run: "stigmer download run run_01abc123" }, { say: "download to a specific directory", run: "stigmer download run run_01abc123 --output-dir ./results/" }]],
  ["stigmer eval cancel", [{ say: "cancel a running eval run", run: "stigmer eval cancel evr_01abc123" }]],
  ["stigmer eval run", [{ say: "a plugin's own cases on the built-in assistant, with and without it", run: "stigmer eval run --plugin thermos" }, { say: "the cases of every plugin the agent attaches, on the agent", run: "stigmer eval run --agent variance-reporter" }, { say: "the cases of an Eval pushed with stigmer push eval, at its stable version", run: "stigmer eval run --agent variance-reporter --eval variance-reporter-evals@stable" }, { say: "the plugin's cases on the agent, with and without the plugin", run: "stigmer eval run --agent variance-reporter --plugin payroll" }]],
  ["stigmer file upload", [{ say: "upload a spreadsheet to reuse, and see the id it is named by", run: "stigmer file upload q3-ledger.xlsx" }, { say: "upload into a conversation you already have", run: "stigmer file upload notes.md --session ses_01abc123" }]],
  ["stigmer get", [{ say: "get an agent by slug", run: "stigmer get agent my-agent" }, { say: "get by org-qualified slug", run: "stigmer get agent acme-corp/variance-reporter" }]],
  ["stigmer install", [{ say: "install from the official catalogue by name", run: "stigmer install linear" }, { say: "install from a source you added, naming it", run: "stigmer install acme-plugins/thermos" }]],
  ["stigmer list", [{ say: "list all agents", run: "stigmer list agents" }, { say: "list available resource types", run: "stigmer list types" }]],
  ["stigmer logs", [{ say: "follow all components live (tail snapshot first)", run: "stigmer logs" }, { say: "show the last 100 lines and exit", run: "stigmer logs --no-follow --tail 100" }]],
  ["stigmer marketplace add", [{ say: "add your company's catalogue (a public GitHub repository with a marketplace file)", run: "stigmer marketplace add acme/agent-plugins" }, { say: "add a repository at a branch or tag, or from its URL", run: "stigmer marketplace add acme/agent-plugins@main" }]],
  ["stigmer marketplace list", [{ say: "see what is configured, and what one offers", run: "stigmer marketplace list" }]],
  ["stigmer marketplace remove", [{ say: "stop installing from one (plugins already installed stay)", run: "stigmer marketplace remove acme-plugins" }]],
  ["stigmer marketplace show", [{ say: "list what one catalogue offers", run: "stigmer marketplace show acme-plugins" }]],
  ["stigmer mcp add", [{ say: "add an MCP server as a plugin, sending a header from your environment", run: "stigmer mcp add acme https://mcp.acme.example/mcp --header 'Authorization=Bearer ${ACME_TOKEN}'" }]],
  ["stigmer mcp-server", [{ say: "serve on stdio, as an MCP client spawns it", run: "stigmer mcp-server" }, { say: "serve over HTTP on a port of your own", run: "stigmer mcp-server --transport http --port 9090" }]],
  ["stigmer provider-key delete", [{ say: "remove a key; asks first on a terminal", run: "stigmer provider-key delete anthropic" }]],
  ["stigmer provider-key list", [{ say: "see every provider and where it stands", run: "stigmer provider-key list" }]],
  ["stigmer provider-key set", [{ say: "save the Anthropic key, typed at a hidden prompt", run: "stigmer provider-key set anthropic" }, { say: "save a key from a script, through stdin", run: "stigmer provider-key set openai --key-stdin < openai.key" }]],
  ["stigmer push", [{ say: "push a skill from the current directory", run: "stigmer push skill" }, { say: "push from a specific directory", run: "stigmer push skill ./my-skill/" }]],
  ["stigmer reset", [{ say: "reset runtime data (configuration preserved), with confirmation", run: "stigmer reset" }, { say: "reset without the confirmation prompt", run: "stigmer reset --force" }]],
  ["stigmer resume", [{ say: "browse recent sessions interactively", run: "stigmer resume" }, { say: "resume by session ID", run: "stigmer resume ses_01j9z3k8m2q4r6t8v0w2y4a6c8" }]],
  ["stigmer routine fire", [{ say: "fire a routine once, right now — the fastest way to validate one", run: "stigmer routine fire my-org/daily-fee-reminders" }, { say: "start it with a note for this run, such as the alert that prompted it", run: "stigmer routine fire triage --text \"Sentry alert SEN-4521 fired\"" }]],
  ["stigmer routine fires", [{ say: "see who started each run, and how it went", run: "stigmer routine fires triage" }]],
  ["stigmer routine resume", [{ say: "clear a platform pause after fixing the underlying failure", run: "stigmer routine resume my-org/daily-fee-reminders" }]],
  ["stigmer run", [{ say: "run an agent with a message", run: "stigmer run my-agent -m \"Summarize the Q4 earnings report\"" }, { say: "give the shell back when the turn ends, with its outputs saved", run: "stigmer run variance-reporter --attach ledger.csv --download ./out --until turn -m \"Review this quarter's ledger.\"" }]],
  ["stigmer runs approve", [{ say: "allow the one tool call the run waits on", run: "stigmer runs approve run_01xyz789" }, { say: "deny a named call (its tool_use_id, from `stigmer runs logs`) with a reason", run: "stigmer runs approve run_01xyz789 --tool-call run_01xyz789.toolu_abc --action deny --comment \"not on prod\"" }]],
  ["stigmer runs cancel", [{ say: "cancel a run: every unfinished turn of its conversation stops", run: "stigmer runs cancel run_01abc123" }]],
  ["stigmer runs logs", [{ say: "follow a run's events until it ends", run: "stigmer runs logs run_01abc123 --follow" }]],
  ["stigmer runs pause", [{ say: "pause a run, saying why", run: "stigmer runs pause run_01abc123 --reason \"investigating issue\"" }]],
  ["stigmer runs resume", [{ say: "resume a paused run", run: "stigmer runs resume run_01abc123" }]],
  ["stigmer runs scores", [{ say: "people's thumbs, the run-health checks and the AI judge, one row per score", run: "stigmer runs scores run_01abc123" }, { say: "the scores as JSON, for a script", run: "stigmer runs scores run_01abc123 -o json" }]],
  ["stigmer runs terminate", [{ say: "force-stop immediately (unrecoverable)", run: "stigmer runs terminate run_01xyz789 --reason \"stuck run\"" }]],
  ["stigmer runs to-eval-case", [{ say: "write the case into evals/<name from the request>/", run: "stigmer runs to-eval-case run_01abc123" }, { say: "name the case, and also check that the plugin's review skill fired", run: "stigmer runs to-eval-case run_01abc123 --name finds-the-bug --skill thermos:review" }]],
  ["stigmer runs trace", [{ say: "list the run's events as YAML", run: "stigmer runs trace run_01abc123 -o yaml" }]],
  ["stigmer search", [{ say: "search for agents related to variance reports", run: "stigmer search agents \"variance report\"" }, { say: "output as JSON for scripting", run: "stigmer search agents \"data\" --output json" }]],
  ["stigmer service-account create", [{ say: "create a service account with the Member role", run: "stigmer service-account create ci-deploy" }, { say: "create one with another role", run: "stigmer service-account create release-bot --role admin" }]],
  ["stigmer service-account delete", [{ say: "delete one; every key it has stops working at once", run: "stigmer service-account delete ci-deploy" }]],
  ["stigmer service-account keys", [{ say: "list one's API keys; revoke one with: stigmer delete apikey <id>", run: "stigmer service-account keys ci-deploy" }]],
  ["stigmer service-account list", [{ say: "list the Organization's service accounts, newest first", run: "stigmer service-account list" }]],
  ["stigmer setup", [{ say: "interactive setup", run: "stigmer setup" }, { say: "non-interactive: configure Anthropic", run: "stigmer setup --provider anthropic --api-key sk-ant-xxx" }]],
  ["stigmer status", [{ say: "show component health and LLM configuration", run: "stigmer status" }, { say: "machine-readable status for scripts", run: "stigmer status --json" }]],
  ["stigmer tag", [{ say: "tag an agent version as stable, by the short hash the history prints", run: "stigmer tag agent acme-corp/variance-reporter 3f8a1c0e9b7d stable" }, { say: "the same, by its full 64-character hash", run: "stigmer tag agent acme-corp/variance-reporter 3f8a1c0e9b7d2a4c6e5f1b3d9a7c0e2f4b6d8a1c3e5f7b9d0a2c4e6f8b1d3a5c stable" }]],
  ["stigmer up", [{ say: "start the full local stack (server, runner, Temporal)", run: "stigmer up" }]],
  ["stigmer up server", [{ say: "start only the control plane (no runners)", run: "stigmer up server" }]],
  ["stigmer usage agent", [{ say: "view agent usage for a date range", run: "stigmer usage agent agt-01abc123 --from 2026-03-01 --to 2026-03-31" }]],
  ["stigmer usage hours", [{ say: "view the organization's agent hours (Stigmer Cloud)", run: "stigmer usage hours" }]],
  ["stigmer usage org", [{ say: "view organization-wide usage", run: "stigmer usage org --from 2026-03-01 --to 2026-03-31" }]],
  ["stigmer usage session", [{ say: "view usage for a specific session", run: "stigmer usage session ses_01j9z3k8m2q4r6t8v0w2y4a6c8" }]],
  ["stigmer validate", [{ say: "validate a single file", run: "stigmer validate -f agent.yaml" }, { say: "validate all YAML files in a directory", run: "stigmer validate -f ./manifests/" }]],
  ["stigmer vault connect-link", [{ say: "make a one-time sign-in page whose login lands in a shared vault", run: "stigmer vault connect-link ledger-keys --address https://mcp.linear.app/mcp --return-url https://app.example.com/settings" }]],
  ["stigmer vault create", [{ say: "create a shared vault for the finance team and add its key", run: "stigmer vault create \"Ledger keys\"" }]],
  ["stigmer vault mine", [{ say: "see what your vault holds (names only)", run: "stigmer vault mine" }]],
  ["stigmer vault remove-connection", [{ say: "remove the GitHub login from your vault", run: "stigmer vault remove-connection github.com --mine" }]],
  ["stigmer vault remove-secret", [{ say: "remove a key from a script, without the question", run: "stigmer vault remove-secret LINEAR_API_KEY --mine --force" }]],
  ["stigmer vault set-connection", [{ say: "save a GitHub token so private repositories clone", run: "stigmer vault set-connection github.com --mine --from-file ~/.github-token" }]],
  ["stigmer vault set-secret", [{ say: "save your OpenAI key in your own vault (prompts with hidden input)", run: "stigmer vault set-secret OPENAI_API_KEY --mine" }, { say: "save a key from an environment variable you already have", run: "stigmer vault set-secret LINEAR_API_KEY --mine --from-env LINEAR_API_KEY" }]],
  ["stigmer version", [{ say: "print the CLI version", run: "stigmer version" }]],
]);

/** `stigmer --help`'s own examples: the first three lines of the quickstart a person reaches for. */
export const ROOT_EXAMPLES: readonly HelpExample[] = [
  { say: "start the local stack", run: "stigmer up" },
  {
    say: "run an agent on a file, and get the shell back with its outputs saved",
    run: 'stigmer run variance-reporter --attach ledger.csv --download ./out --until turn -m "Review this quarter\'s ledger."',
  },
  { say: "see an agent's instructions, skills and tools", run: "stigmer get agent variance-reporter" },
];

/** Give every top-level command its group, Commander's `help` the last one, and every runnable command its examples. */
export function applyHelp(program: Command): void {
  examples(program, ROOT_EXAMPLES);
  for (const cmd of documentedCommands(program)) {
    const group = COMMAND_GROUPS[cmd.name()];
    if (group !== undefined) cmd.helpGroup(`${group}:`);
  }
  // Commander's own `help` joins the last group; the default is cleared at
  // once, so a command added later has no group until it is given one.
  program.commandsGroup("Configuration:").helpCommand(true).commandsGroup("");
  for (const cmd of runnableCommands(program)) {
    const list = HELP_EXAMPLES.get(commandPath(cmd));
    if (list !== undefined) examples(cmd, list);
  }
}
