// `stigmer list <type>` — list resources of a type, or `list types` to show the
// registry of available types. Thin handler: resolve/route, delegate, render.

import type { Command } from "commander";
import { stringify as toYaml } from "yaml";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import { renderTable } from "../output/index.js";
import { ALL_VERBS, defaultRegistry, Verb } from "../registry/index.js";
import { addReadFlags, globalOrg, readFormat } from "./shared.js";

const DEFAULT_LIMIT = 50;

interface ListFlags extends OutputFlags {
  limit?: string;
  verb?: string;
  type?: string;
}

export function registerList(program: Command): void {
  const list = program
    .command("list <type>")
    .description("list resources of a type (or 'list types' for available types)")
    .option("--limit <n>", "maximum number of results", String(DEFAULT_LIMIT))
    .option("--verb <verb>", "filter to types supporting this verb (only for 'list types')")
    .option("--type <kind>", "execution type filter: agent or workflow (only for 'list executions')")
    .action((type: string, options: ListFlags, command: Command) => runList(type, options, command));
  addReadFlags(list);
}

async function runList(type: string, options: ListFlags, command: Command): Promise<void> {
  if (isTypesAlias(type)) {
    process.stdout.write(renderTypes(options.verb, readFormat(options)));
    return;
  }

  const { isExecutionAlias } = await import("../resources/execution.js");
  const { isSessionAlias } = await import("../resources/session.js");
  if (isExecutionAlias(type)) {
    await runListExecutions(options, command);
    return;
  }
  if (isSessionAlias(type)) {
    await runListSessions(options);
    return;
  }

  const info = defaultRegistry().getByAlias(type);
  if (info === undefined) {
    throw new UsageError(`unknown resource type: ${type}`);
  }
  if (!info.supportedVerbs.has(Verb.List)) {
    throw new UsageError(`${info.displayName} does not support 'list'`);
  }

  const [{ connectBackend }, { listResources }] = await Promise.all([
    import("../backend.js"),
    import("../resources/list.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const rendered = await listResources(client.stigmer, info.kind, org, parseLimit(options.limit), readFormat(options));
  process.stdout.write(rendered);
}

// Executions bypass the registry: they're listed by their own controllers and
// optionally filtered to agent (default) or workflow by `--type`. Results are
// scoped to the resolved org context (--org flag, env, or configured context);
// an unset cloud context resolves to "" = permission-bounded across orgs.
async function runListExecutions(options: ListFlags, command: Command): Promise<void> {
  const [{ connectBackend }, execution] = await Promise.all([
    import("../backend.js"),
    import("../resources/execution.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const limit = parseLimit(options.limit);
  const format = readFormat(options);

  const filter = (options.type ?? "").trim().toLowerCase();
  if (filter === "workflow" || filter === "wf") {
    const result = await execution.listWorkflowExecutions(client.stigmer, limit, org);
    process.stdout.write(execution.renderExecutionList(result, format, "workflow"));
    return;
  }
  if (filter !== "" && filter !== "agent") {
    throw new UsageError(`unknown execution type filter: ${options.type}\n\nValid values: agent, workflow`);
  }
  const result = await execution.listAgentExecutions(client.stigmer, limit, org);
  process.stdout.write(execution.renderExecutionList(result, format, "agent"));
}

async function runListSessions(options: ListFlags): Promise<void> {
  const [{ connectBackend }, session] = await Promise.all([
    import("../backend.js"),
    import("../resources/session.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const result = await session.listSessions(client.stigmer, parseLimit(options.limit));
  process.stdout.write(session.renderSessionList(result, readFormat(options)));
}

function isTypesAlias(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized === "type" || normalized === "types";
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) throw new UsageError(`invalid --limit value "${raw}"`);
  return Number.parseInt(raw, 10);
}

// `list types` reads from the local registry — no backend call.
function renderTypes(verbFilter: string | undefined, format: string): string {
  const registry = defaultRegistry();
  const verb = verbFilter !== undefined && verbFilter !== "" ? (verbFilter.toLowerCase() as Verb) : undefined;
  if (verb !== undefined && !ALL_VERBS.includes(verb)) {
    throw new UsageError(`unknown verb: ${verbFilter}`);
  }

  const types = (verb !== undefined ? registry.typesForVerb(verb) : registry.all()).map((info) => ({
    name: info.name,
    display_name: info.displayName,
    id_prefix: info.idPrefix,
    aliases: [...info.aliases],
    verbs: ALL_VERBS.filter((v) => info.supportedVerbs.has(v)),
  }));

  if (format === "json") return `${JSON.stringify(types, null, 2)}\n`;
  if (format === "yaml") return toYaml(types);
  const rows = types.map((t) => [t.name, t.id_prefix, t.verbs.join(", ")]);
  return `\n${renderTable(["TYPE", "ID PREFIX", "VERBS"], rows)}`;
}
