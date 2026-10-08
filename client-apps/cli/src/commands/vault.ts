// `stigmer vault …` — the logins and secrets runs use.
//
//   vault mine                         your own vault's entry names
//   vault create <name>                a shared vault (organization admins)
//   vault set-secret <NAME>            save a secret by name
//   vault remove-secret <NAME...>      confirms first; -f/--force skips it
//   vault set-connection <address>     save a login for a tool's URL or a Git host
//   vault remove-connection <address...>  confirms first; -f/--force skips it
//
// Entry commands name their vault with --mine (your own, created by your
// first save) or --vault <ref> (a shared vault: id, org/slug, or slug).
// A value is read from --from-env, --from-file or stdin (a hidden prompt on a
// terminal), never from the command line, and no command prints one: saved
// values can be replaced but never read back. The generic get, list and
// delete verbs cover vaults too; a vault has no apply, because a secret never
// belongs in a manifest file.
//
// A removal destroys a value that cannot be recovered, so it runs the same
// interaction as `delete`: warn naming each entry and the vault, confirm on a
// TTY, and abort cleanly when declined or when no one can answer.
//
// Thin handlers: resolve credentials and org, delegate to resources/vault,
// render. Heavy modules are lazy-imported so `--help` stays fast.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import type { OutputFlags } from "../output/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface TargetFlags extends OutputFlags {
  mine?: boolean;
  vault?: string;
}

interface ValueFlags extends TargetFlags {
  fromEnv?: string;
  fromFile?: string;
  description?: string;
}

interface RemoveFlags extends TargetFlags {
  force?: boolean;
}

interface CreateFlags extends OutputFlags {
  description?: string;
  externalId?: string;
}

function addTargetFlags(command: Command): Command {
  return command
    .option("--mine", "your own vault (created by your first save)")
    .option("--vault <ref>", "a shared vault: id, org/slug, or slug");
}

function addForceFlag(command: Command): Command {
  return command.option("-f, --force", "skip the confirmation prompt");
}

function addValueFlags(command: Command): Command {
  return command
    .option("--from-env <var>", "read the value from this environment variable")
    .option("--from-file <path>", "read the value from this file")
    .option("--description <text>", "what the entry is for");
}

export function registerVault(program: Command): void {
  const vault = program
    .command("vault")
    .description("manage the logins and secrets your runs use (values are never shown)");

  const mine = vault
    .command("mine")
    .description("show your own vault: the names of its secrets and logins")
    .action((options: OutputFlags, command: Command) =>
      run(options, command, async (controller, org, r) => r.showMyVault(controller, org)),
    );
  addResultFlags(mine);

  const createCmd = vault
    .command("create <name>")
    .description("create a shared vault in the organization (organization admins)")
    .option("--description <text>", "what the vault is for")
    .option("--external-id <id>", "your own id for the vault, unique in the organization")
    .action((name: string, options: CreateFlags, command: Command) =>
      run(options, command, async (controller, org, r) =>
        r.createSharedVault(controller, org, name, {
          description: options.description,
          externalId: options.externalId,
        }),
      ),
    );
  addResultFlags(createCmd);

  const setSecret = addValueFlags(
    addTargetFlags(
      vault
        .command("set-secret <name>")
        .description("save a secret by name, replacing any saved under it (value from --from-env, --from-file or stdin)"),
    ),
  ).action((name: string, options: ValueFlags, command: Command) =>
    run(options, command, async (controller, org, r) => {
      const value = async () => r.readValue(name, options, await valueIo());
      return r.setSecret(controller, org, r.vaultChoiceOf(options), name, value, options.description ?? "");
    }),
  );
  addResultFlags(setSecret);

  const removeSecret = addForceFlag(
    addTargetFlags(vault.command("remove-secret <names...>").description("remove secrets by name")),
  ).action((names: string[], options: RemoveFlags, command: Command) =>
    runRemoval(options, command, async (controller, org, r) =>
      r.planRemoveSecrets(controller, org, r.vaultChoiceOf(options), names),
    ),
  );
  addResultFlags(removeSecret);

  const setConnection = addValueFlags(
    addTargetFlags(
      vault
        .command("set-connection <address>")
        .description(
          "save a login for a tool's URL (https://mcp.example.com/mcp) or a Git host (github.com), replacing any saved there",
        ),
    ),
  ).action((address: string, options: ValueFlags, command: Command) =>
    run(options, command, async (controller, org, r) => {
      const token = async () => r.readValue(address, options, await valueIo());
      return r.setConnection(controller, org, r.vaultChoiceOf(options), address, token, options.description ?? "");
    }),
  );
  addResultFlags(setConnection);

  const removeConnection = addForceFlag(
    addTargetFlags(
      vault.command("remove-connection <addresses...>").description("remove logins by address"),
    ),
  ).action((addresses: string[], options: RemoveFlags, command: Command) =>
    runRemoval(options, command, async (controller, org, r) =>
      r.planRemoveConnections(controller, org, r.vaultChoiceOf(options), addresses),
    ),
  );
  addResultFlags(removeConnection);
}

type VaultModule = typeof import("../resources/vault.js");
type ControllerFn = import("../resources/run/create.js").ControllerFn;
type CommandResult = import("../output/index.js").CommandResult;
type DeletePlan = import("../resources/delete.js").DeletePlan;
type Render = typeof import("../output/command-result.js").renderResult;

interface Session {
  readonly controller: ControllerFn;
  readonly org: string;
  readonly resources: VaultModule;
  readonly renderResult: Render;
}

async function openSession(command: Command): Promise<Session> {
  const [{ connectBackend }, resources, { renderResult }] = await Promise.all([
    import("../backend.js"),
    import("../resources/vault.js"),
    import("../output/command-result.js"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  return { controller: client.controller.bind(client), org, resources, renderResult };
}

async function run(
  options: OutputFlags,
  command: Command,
  act: (controller: ControllerFn, org: string, r: VaultModule) => Promise<CommandResult>,
): Promise<void> {
  const format = resultFormat(options);
  const session = await openSession(command);
  session.renderResult(await act(session.controller, session.org, session.resources), format);
}

// The `delete` interaction (commands/delete.ts): render the warning, confirm
// unless --force, then send the write.
async function runRemoval(
  options: RemoveFlags,
  command: Command,
  plan: (controller: ControllerFn, org: string, r: VaultModule) => Promise<DeletePlan>,
): Promise<void> {
  const format = resultFormat(options);
  const [session, { confirm }] = await Promise.all([openSession(command), import("../output/confirm.js")]);
  const staged = await plan(session.controller, session.org, session.resources);
  if (options.force !== true) {
    session.renderResult(staged.warning, format);
    const confirmed = await confirm(staged.confirmPrompt);
    if (!confirmed) {
      // Declined (or no TTY): a clean, intentional no-op — exit 0.
      process.stderr.write("Aborted.\n");
      return;
    }
  }
  session.renderResult(await staged.perform(), format);
}

async function valueIo(): Promise<import("../resources/vault.js").ValueIo> {
  const { promptSecret } = await import("../local/setup/prompt.js");
  return {
    env: process.env,
    stdinIsTty: process.stdin.isTTY === true,
    promptHidden: promptSecret,
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}
