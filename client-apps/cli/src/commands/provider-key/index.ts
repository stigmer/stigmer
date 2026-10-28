// `stigmer provider-key list|set|delete` — the model providers that serve an
// organization, and on Stigmer Cloud its own provider keys.
//
//   provider-key list                      every provider and where it stands
//   provider-key set <provider>            save a key: hidden prompt, or --key-stdin
//                    [--base-url <url>]    an Anthropic- or OpenAI-compatible endpoint
//   provider-key delete <provider>         confirms first; -f/--force skips it
//
// A provider key is an organization's account noun, not a resource kind (it
// is keyed by organization and provider), so it has a group of its own as
// `service-account` does, and the generic verbs gain no row for it. Its
// organization is the one every org-scoped command uses: `--org`, then
// `STIGMER_ORG`, then the context.
//
// `list` answers on every edition: each provider's standing comes from the
// platform's model readiness, and Stigmer Cloud adds each key's details.
// `set` and `delete` are Stigmer Cloud's; elsewhere the runners hold their
// own keys, and the refusal names how to give them one.
//
// A key is read from a hidden prompt on a terminal, or from stdin under
// `--key-stdin`, never from an argument or a flag: a key on the command line
// stays in the shell's history and shows in the process list, so one given
// there is refused before anything is sent.
//
// Removing a key refuses the organization's runs that need its provider
// until another key serves it, so `delete` confirms on a terminal; off one,
// no one can answer, so without `--force` it aborts, as every confirmed
// delete does.
//
// Thin handlers: resolve credentials and org, delegate to
// resources/provider-key, render. Heavy modules are lazy-imported so
// `--help` stays fast.

import { type Command, Option } from "commander";
import {
  contextOrganizationLabel,
  ensureAuthenticated,
  resolveContextOrganization,
  resolveOrganization,
} from "../../config/index.js";
import { UsageError } from "../../errors/usage-error.js";
import type { OutputFlags } from "../../output/index.js";
import { addReadFlags, addResultFlags, globalOrg, readFormat, resultFormat } from "../shared.js";

interface SetFlags extends OutputFlags {
  keyStdin?: boolean;
  baseUrl?: string;
  key?: string;
}

interface DeleteFlags extends OutputFlags {
  force?: boolean;
}

/** The lines `requireOrganization` prints for setting the organization. */
const SET_ORG_WITH = [
  "stigmer --org <org> provider-key <command>",
  "stigmer config context set --org <org>",
];

/** `-o` for a mutating command: `table` is the human result, `json` its JSON form. */
function addResultOutputFlag(command: Command): Command {
  return command.option("-o, --output <format>", "output format: table or json");
}

export function registerProviderKey(program: Command): void {
  const group = program
    .command("provider-key")
    .description("see which model providers serve the organization, and manage its provider keys (Stigmer Cloud)");

  const listCmd = group
    .command("list")
    .description("list every model provider and where it stands for the organization, with its key on Stigmer Cloud")
    .action(async (options: OutputFlags, command: Command) => {
      const format = readFormat(options);
      const [session, resources, output, { stringify }] = await Promise.all([
        openSession(command),
        import("../../resources/provider-key.js"),
        import("../../output/index.js"),
        import("yaml"),
      ]);
      const listing = await resources.listProviders(session.client.stigmer, session.org);
      if (format === "json") {
        process.stdout.write(JSON.stringify(resources.providerListJson(listing), null, 2) + "\n");
        return;
      }
      if (format === "yaml") {
        process.stdout.write(stringify(resources.providerListJson(listing)));
        return;
      }
      process.stdout.write(
        output.renderTable(resources.providerTableHeaders(listing), resources.providerTableRows(listing)),
      );
      if (listing.keyDetails === "not-permitted") {
        process.stderr.write("\nThe keys' details are shown to those who manage the organization's billing.\n");
      }
    });
  addReadFlags(listCmd);

  const setCmd = group
    .command("set <provider>")
    .description("save the organization's key for anthropic, openai or cursor, replacing any it holds (Stigmer Cloud)")
    .option("--key-stdin", "read the key from stdin instead of a hidden prompt")
    .option("--base-url <url>", "use the key against your own Anthropic- or OpenAI-compatible endpoint (https)")
    // Declared only to refuse it: a key on the command line stays in the
    // shell's history, and commander's own unknown-option answer would not
    // say why.
    .addOption(new Option("--key <key>").hideHelp())
    .allowExcessArguments(true)
    .action(async (providerArg: string, options: SetFlags, command: Command) => {
      const format = resultFormat(options);
      const resources = await import("../../resources/provider-key.js");
      const provider = resources.parseProvider(providerArg);
      if (command.args.length > 1 || options.key !== undefined) resources.refuseKeyOnCommandLine(provider);
      const baseUrl = resources.parseBaseUrl(provider, options.baseUrl);
      // The session refuses a server that keeps no keys before the key is
      // asked for: no one types a key a server will not keep.
      const [session, { renderResult }] = await Promise.all([
        openSession(command, "writes keys"),
        import("../../output/command-result.js"),
      ]);
      const apiKey = await resources.readProviderKey(provider, options.keyStdin === true, await keyIo());
      renderResult(
        await resources.setProviderKey(session.client.stigmer, session.org, provider, apiKey, baseUrl),
        format,
      );
    });
  addResultFlags(setCmd);
  addResultOutputFlag(setCmd);

  const deleteCmd = group
    .command("delete <provider>")
    .description("remove the organization's key for a provider; runs that need it are refused until a key serves it again")
    .option("-f, --force", "skip the confirmation prompt")
    .action(async (providerArg: string, options: DeleteFlags, command: Command) => {
      const format = resultFormat(options);
      const resources = await import("../../resources/provider-key.js");
      const provider = resources.parseProvider(providerArg);
      const [session, { renderResult }, { confirm }] = await Promise.all([
        openSession(command, "writes keys"),
        import("../../output/command-result.js"),
        import("../../output/confirm.js"),
      ]);
      if (options.force !== true) {
        if (!(await confirm(resources.deletePrompt(provider, session.orgLabel)))) {
          // Declined (or no TTY): a clean, intentional no-op — exit 0.
          process.stderr.write("Aborted.\n");
          return;
        }
      }
      renderResult(await resources.deleteProviderKey(session.client.stigmer, session.org, provider), format);
    });
  addResultFlags(deleteCmd);
  addResultOutputFlag(deleteCmd);
}

type BackendClient = import("../../client/index.js").BackendClient;

interface Session {
  readonly client: BackendClient;
  readonly org: string;
  /** How output names the organization: the context's slug when the org is the context's. */
  readonly orgLabel: string;
}

/**
 * Connect, resolve the organization, and require one where the server needs
 * it. A session that writes keys first refuses a server that keeps none, so
 * that refusal, with its fix, comes before any question about the
 * organization.
 */
async function openSession(command: Command, writes?: "writes keys"): Promise<Session> {
  const [{ connectBackend }, { requireOrganization }, { refuseKeyWritesOff }] = await Promise.all([
    import("../../backend.js"),
    import("../../client/single-org.js"),
    import("../../resources/provider-key.js"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  if (writes !== undefined) refuseKeyWritesOff((await client.serverInfo()).deploymentMode);
  const org = resolveOrganization(client.config, globalOrg(command));
  await requireOrganization(client.stigmer, org, SET_ORG_WITH);
  const orgLabel =
    org !== "" && org === resolveContextOrganization(client.config) ? contextOrganizationLabel(client.config) : org;
  return { client, org, orgLabel };
}

async function keyIo(): Promise<import("../../resources/provider-key.js").KeyIo> {
  const { promptSecret } = await import("../../local/setup/prompt.js");
  return {
    stdinIsTty: process.stdin.isTTY === true,
    promptHidden: promptSecret,
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}
