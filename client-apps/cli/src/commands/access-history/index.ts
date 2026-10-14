// `stigmer access-history list|export` — who gave whom access to what, and
// when, in the organization.
//
//   access-history list [--limit N]      newest first; table, -o json or -o yaml
//   access-history export [--after N]    JSON Lines, oldest first, to stdout
//
// The history is read by the organization's owners and admins. It is not a
// resource kind, so it has a group of its own as `service-account` does, and
// the generic verbs gain no row for it. Its organization is the one every
// org-scoped command uses: `--org`, then `STIGMER_ORG`, then the context.
//
// `export` is for a security team's tools: each line is one entry's proto
// JSON, and `--after` with the last `sequence` a tool holds asks for exactly
// what came since, which no entry can slip past.
//
// Thin handlers: resolve credentials and org, delegate to
// resources/access-history, render. Heavy modules are lazy-imported so
// `--help` stays fast.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../../config/index.js";
import { UsageError } from "../../errors/usage-error.js";
import type { OutputFlags } from "../../output/index.js";
import { addReadFlags, globalOrg, readFormat } from "../shared.js";

interface ListFlags extends OutputFlags {
  limit?: string;
}

interface ExportFlags {
  after?: string;
}

const DEFAULT_LIMIT = 50;

/** The lines `requireOrganization` prints for setting the organization. */
const SET_ORG_WITH = [
  "stigmer access-history <command> --org <org>",
  "stigmer config context set --org <org>",
];

export function registerAccessHistory(program: Command): void {
  const group = program
    .command("access-history")
    .description("read and export who gave whom access to what in the organization (owners and admins)");

  const listCmd = group
    .command("list")
    .description("list the organization's access changes, newest first")
    .option("--limit <n>", `the most entries to list (default ${DEFAULT_LIMIT})`)
    .action(async (options: ListFlags, command: Command) => {
      const format = readFormat(options);
      const limit = parseLimit(options.limit);
      const [session, resources, output, { AccessHistoryEntrySchema }] = await Promise.all([
        openSession(command),
        import("../../resources/access-history.js"),
        import("../../output/index.js"),
        import("@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb"),
      ]);
      const entries = await resources.listAccessHistory(session.client, session.org, limit);
      if (format === "json") {
        process.stdout.write(output.renderProtoListJson(AccessHistoryEntrySchema, entries));
      } else if (format === "yaml") {
        process.stdout.write(output.renderProtoListYaml(AccessHistoryEntrySchema, entries));
      } else if (entries.length === 0) {
        process.stdout.write(output.renderEmpty("access changes"));
      } else {
        process.stdout.write(
          output.renderTable(resources.ACCESS_HISTORY_TABLE_HEADERS, resources.accessHistoryRows(entries)),
        );
      }
    });
  addReadFlags(listCmd);

  group
    .command("export")
    .description("write the organization's access history as JSON Lines, oldest first, to stdout")
    .option("--after <sequence>", "start after this entry: the last sequence you already hold")
    .action(async (options: ExportFlags, command: Command) => {
      const resources = await import("../../resources/access-history.js");
      const after = resources.parseAfterSequence(options.after);
      const session = await openSession(command);
      await resources.exportAccessHistoryLines(session.client, session.org, after, (line) => {
        process.stdout.write(line);
      });
    });
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) throw new UsageError(`invalid --limit value "${raw}"`);
  const value = Number.parseInt(raw, 10);
  if (value < 1) throw new UsageError("--limit must be at least 1");
  return value;
}

interface Session {
  readonly client: import("../../resources/access-history.js").AccessHistoryClient;
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
