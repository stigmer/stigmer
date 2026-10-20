// `stigmer list <type>` — list resources of a type, or `list types` to show the
// registry of available types. Thin handler: resolve/route, delegate, render.

import type { Command } from "commander";
import { stringify as toYaml } from "yaml";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import { renderTable } from "../output/index.js";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ALL_VERBS, defaultRegistry, Verb } from "../registry/index.js";
import { addReadFlags, globalOrg, readFormat } from "./shared.js";

const DEFAULT_LIMIT = 50;

interface ListFlags extends OutputFlags {
  limit?: string;
  verb?: string;
  label?: string[];
  session?: string;
}

export function registerList(program: Command): void {
  const list = program
    .command("list <type>")
    .description("list resources of a type (or 'list types' for available types)")
    .option("--limit <n>", "maximum number of results (0 reads every page)", String(DEFAULT_LIMIT))
    .option("--verb <verb>", "filter to types supporting this verb (only for 'list types')")
    .option(
      "-l, --label <key=value>",
      "keep only resources carrying this label (repeatable; every pair must match)",
      collectLabel,
      [],
    )
    .option("--session <id>", "files: list one conversation's Files, what was given to it and what its turns saved (only for 'list files')")
    .action((type: string, options: ListFlags, command: Command) => runList(type, options, command));
  addReadFlags(list);
}

async function runList(type: string, options: ListFlags, command: Command): Promise<void> {
  if (isTypesAlias(type)) {
    if ((options.label ?? []).length > 0) {
      throw new UsageError("--label filters resources; 'list types' has none to filter");
    }
    if (options.session !== undefined) {
      throw new UsageError("--session names a conversation whose Files to list; 'list types' has none");
    }
    process.stdout.write(renderTypes(options.verb, readFormat(options)));
    return;
  }
  const labels = parseLabels(options.label ?? []);

  // The one pre-gate alias family: runs resolve BEFORE the registry.
  // Adding another pre-gate alias here requires its kind to be
  // non-registry-addressable (run's posture) — an addressable
  // kind must list through the registry dispatch instead, or its verb-matrix
  // row lies. The alias-shadowing pin in registry/registry.test.ts enforces
  // this; sessions shipped works-but-unadvertised through exactly such a
  // bypass for two months (stigmer/stigmer#469).
  const { isRunAlias } = await import("../resources/runs.js");
  const sessionId = options.session ?? "";
  if (isRunAlias(type)) {
    if (options.session !== undefined) throw sessionFilterRefusal(type);
    await runListRuns(options, command, labels);
    return;
  }

  const info = defaultRegistry().getByAlias(type);
  if (info === undefined) {
    throw new UsageError(`unknown resource type: ${type}`);
  }
  if (!info.supportedVerbs.has(Verb.List)) {
    throw new UsageError(`${info.displayName} does not support 'list'`);
  }
  // A conversation holds Files and nothing else a list names, so the
  // filter is refused for every other type rather than ignored.
  if (options.session !== undefined) {
    if (info.kind !== ApiResourceKind.file) throw sessionFilterRefusal(type);
    const { isSessionId } = await import("../resources/reference.js");
    if (!isSessionId(sessionId)) {
      throw new UsageError(`invalid session ID: ${sessionId}\n\nA conversation is named by its ID (e.g., ses_01abc123)`);
    }
  }

  const [{ connectBackend }, { listResources }] = await Promise.all([
    import("../backend.js"),
    import("../resources/list.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const rendered = await listResources(
    client.stigmer,
    info.kind,
    org,
    parseLimit(options.limit),
    readFormat(options),
    { labels, sessionId },
  );
  process.stdout.write(rendered);
}

function sessionFilterRefusal(type: string): UsageError {
  return new UsageError(`--session lists one conversation's Files; 'list ${type}' takes no conversation (use 'list files --session <id>')`);
}

// Runs bypass the registry: they're listed by their own controller. Results are
// scoped to the resolved org context (--org flag, env, or configured context);
// an unset cloud context resolves to "" = permission-bounded across orgs.
async function runListRuns(options: ListFlags, command: Command, labels: Record<string, string>): Promise<void> {
  const [{ connectBackend }, runs] = await Promise.all([
    import("../backend.js"),
    import("../resources/runs.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const limit = parseLimit(options.limit);
  const format = readFormat(options);

  const result = await runs.listAgentRuns(client.stigmer, limit, org, labels);
  process.stdout.write(runs.renderRunList(result, format));
}

function isTypesAlias(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized === "type" || normalized === "types";
}

function collectLabel(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * The --label pairs as the request's `labels` map: each `key=value`, split
 * at the first `=`, so a value may hold `=` and may be empty (`team=`). A
 * pair without `=` or with an empty key, or one key given twice, is refused
 * here; whether a key or value is well formed is the server's to say.
 */
export function parseLabels(raw: readonly string[]): Record<string, string> {
  const labels = new Map<string, string>();
  for (const pair of raw) {
    const at = pair.indexOf("=");
    if (at <= 0) {
      throw new UsageError(`invalid --label "${pair}": want key=value`);
    }
    const key = pair.slice(0, at);
    if (labels.has(key)) {
      throw new UsageError(`--label "${key}" is given twice; a resource carries one value per key`);
    }
    labels.set(key, pair.slice(at + 1));
  }
  // fromEntries defines own properties, so no key reaches the prototype.
  return Object.fromEntries(labels);
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
