// `stigmer service-account create|list|delete` — an organization's own
// accounts for automation.
//
//   service-account create <name> [--role admin|member|viewer]   default member
//   service-account list
//   service-account keys <name>            its API keys (organization admins)
//   service-account delete <name>          confirms first; -f/--force skips it
//
// A service account is what a CI job or a script acts as, through API keys
// created for it with `stigmer apikey create --service-account <name>`, so the
// automation keeps working when the person who set it up leaves. It is an
// account noun, not a resource kind, so it has a group of its own as `auth`
// and `apikey` do, and the generic verbs gain no row for it. Its keys are
// listed with `keys`, since `stigmer list apikeys` answers the caller's own,
// and read and revoked with the generic verbs on `apikey`. Its organization is the one every org-scoped command uses:
// `--org`, then `STIGMER_ORG`, then the context.
//
// Deleting one ends every key it has at once, so it runs the `delete`
// interaction: warn naming the account, confirm on a TTY, and abort cleanly
// when declined or when no one can answer.
//
// Thin handlers: resolve credentials and org, delegate to
// resources/service-account, render. Heavy modules are lazy-imported so
// `--help` stays fast.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../../config/index.js";
import type { OutputFlags } from "../../output/index.js";
import { addReadFlags, addResultFlags, globalOrg, readFormat, resultFormat } from "../shared.js";

export interface ServiceAccountCreateFlags extends OutputFlags {
  role?: string;
}

interface DeleteFlags extends OutputFlags {
  force?: boolean;
}

/** The lines `requireOrganization` prints for setting the organization. */
const SET_ORG_WITH = [
  "stigmer service-account <command> --org <org>",
  "stigmer config context set --org <org>",
];

export function registerServiceAccount(program: Command): void {
  const group = program
    .command("service-account")
    .description("manage the organization's service accounts, the accounts its automation acts as");

  const createCmd = group
    .command("create <name>")
    .description("create a service account holding one organization role (organization admins)")
    .option("--role <role>", "its organization role: admin, member or viewer", "member")
    .action(async (name: string, options: ServiceAccountCreateFlags, command: Command) => {
      const format = resultFormat(options);
      const resources = await import("../../resources/service-account.js");
      // A wrong role fails before anything is sent.
      const role = resources.parseServiceAccountRole(options.role ?? "member");
      const [session, { renderResult }] = await Promise.all([
        openSession(command),
        import("../../output/command-result.js"),
      ]);
      renderResult(
        await resources.createServiceAccount(session.client, session.org, name, role),
        format,
      );
    });
  addResultFlags(createCmd);

  const listCmd = group
    .command("list")
    .description("list the organization's service accounts, newest first (organization admins)")
    .action(async (options: OutputFlags, command: Command) => {
      const format = readFormat(options);
      const [session, resources, output, { IdentityAccountSchema }] = await Promise.all([
        openSession(command),
        import("../../resources/service-account.js"),
        import("../../output/index.js"),
        import("@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb"),
      ]);
      const accounts = await resources.listServiceAccounts(session.client, session.org);
      if (format === "json") {
        process.stdout.write(output.renderProtoListJson(IdentityAccountSchema, accounts));
        return;
      }
      if (format === "yaml") {
        process.stdout.write(output.renderProtoListYaml(IdentityAccountSchema, accounts));
        return;
      }
      if (accounts.length === 0) {
        process.stdout.write(output.renderEmpty("service accounts"));
        return;
      }
      process.stdout.write(
        output.renderTable(resources.SERVICE_ACCOUNT_TABLE_HEADERS, resources.serviceAccountRows(accounts)),
      );
    });
  addReadFlags(listCmd);

  const keysCmd = group
    .command("keys <name>")
    .description("list a service account's API keys, newest first (organization admins)")
    .action(async (name: string, options: OutputFlags, command: Command) => {
      const format = readFormat(options);
      const [session, resources, output, { ApiKeySchema }] = await Promise.all([
        openSession(command),
        import("../../resources/service-account.js"),
        import("../../output/index.js"),
        import("@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb"),
      ]);
      const keys = await resources.listServiceAccountKeys(session.client, session.org, name);
      if (format === "json") {
        process.stdout.write(output.renderProtoListJson(ApiKeySchema, keys));
        return;
      }
      if (format === "yaml") {
        process.stdout.write(output.renderProtoListYaml(ApiKeySchema, keys));
        return;
      }
      if (keys.length === 0) {
        process.stdout.write(output.renderEmpty("API keys"));
        return;
      }
      process.stdout.write(
        output.renderTable(resources.SERVICE_ACCOUNT_KEY_TABLE_HEADERS, resources.serviceAccountKeyRows(keys)),
      );
    });
  addReadFlags(keysCmd);

  const deleteCmd = group
    .command("delete <name>")
    .description("delete a service account; every API key it has stops working at once")
    .option("-f, --force", "skip the confirmation prompt")
    .action(async (name: string, options: DeleteFlags, command: Command) => {
      const format = resultFormat(options);
      const [session, resources, { renderResult }, { confirm }] = await Promise.all([
        openSession(command),
        import("../../resources/service-account.js"),
        import("../../output/command-result.js"),
        import("../../output/confirm.js"),
      ]);
      const staged = await resources.planDeleteServiceAccount(session.client, session.org, name);
      if (options.force !== true) {
        renderResult(staged.warning, format);
        if (!(await confirm(staged.confirmPrompt))) {
          // Declined (or no TTY): a clean, intentional no-op — exit 0.
          process.stderr.write("Aborted.\n");
          return;
        }
      }
      renderResult(await staged.perform(), format);
    });
  addResultFlags(deleteCmd);
}

interface Session {
  readonly client: import("../../resources/service-account.js").ServiceAccountClient;
  readonly org: string;
}

async function openSession(command: Command): Promise<Session> {
  const [{ connectBackend }, { requireOrganization }] = await Promise.all([
    import("../../backend.js"),
    import("../../client/single-org.js"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  await requireOrganization(client.stigmer, org, SET_ORG_WITH);
  return { client: client.stigmer, org };
}
