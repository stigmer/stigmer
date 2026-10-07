// `stigmer get <type> <reference>` — fetch a single resource.
//
// Thin handler: route the two non-registry special cases (runs, addressed
// by `run_` ID; agent version history/retrieval) first, then the
// registry-driven standard path. Heavy modules (backend client, SDK schemas)
// are dynamically imported inside the action so `--help` stays fast.

import type { Command } from "commander";
import type { Message } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { omitsOrganization } from "../client/single-org.js";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags, OutputFormat } from "../output/index.js";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { defaultRegistry, Verb } from "../registry/index.js";
import { addReadFlags, globalOrg, readFormat } from "./shared.js";

interface GetFlags extends OutputFlags {
  version?: string;
  versionHistory?: boolean;
}

export function registerGet(program: Command): void {
  const get = program
    .command("get <type> <reference>")
    .description("get a resource by type and reference (slug, org/slug, or ID)")
    .option("--version <hashOrTag>", "fetch a specific version by hash or tag (agents)")
    .option("--version-history", "show the version history timeline (agents)")
    .action((type: string, reference: string, options: GetFlags, command: Command) =>
      runGet(type, reference, options, command),
    );
  addReadFlags(get);
}

async function runGet(type: string, reference: string, options: GetFlags, command: Command): Promise<void> {
  const { isRunAlias } = await import("../resources/runs.js");
  if (isRunAlias(type)) {
    await runGetRun(reference, options, command);
    return;
  }

  const info = defaultRegistry().getByAlias(type);
  if (info === undefined) {
    throw new UsageError(`unknown resource type: ${type}`);
  }
  if (!info.supportedVerbs.has(Verb.Get)) {
    throw new UsageError(`${info.displayName} does not support 'get'`);
  }

  const [{ connectBackend }, { parseReference }, { fetchResource }, { renderResource }] = await Promise.all([
    import("../backend.js"),
    import("../resources/reference.js"),
    import("../resources/get.js"),
    import("../resources/render.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  // Agents are the kind an apply versions (Go ignores the flags for other
  // kinds, returning the current resource).
  const wantsVersion = options.versionHistory === true || (options.version ?? "") !== "";
  if (info.kind === ApiResourceKind.agent && wantsVersion) {
    const [refOrg, slug] = parseOrgSlug(reference, org);
    const { renderAgentVersionHistory, getAgentAtVersion } = await import("../resources/version.js");
    if (options.versionHistory === true) {
      process.stdout.write(await renderAgentVersionHistory(client.stigmer, refOrg, slug));
      return;
    }
    const [{ AgentSchema }, agent, hideOrg] = await Promise.all([
      import("@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb"),
      getAgentAtVersion(client.stigmer, refOrg, slug, options.version ?? ""),
      omitsOrganization(client.stigmer),
    ]);
    const format = readFormat(options);
    const orgLabel = await humanOrgLabel(client.stigmer, agent, format, hideOrg);
    process.stdout.write(renderResource(AgentSchema, agent, format, { hideOrg, orgLabel }));
    return;
  }

  const parsed = parseReference(reference, org, info.idPrefixes);
  const [{ schema, message }, hideOrg] = await Promise.all([
    fetchResource(client.stigmer, info.kind, parsed),
    omitsOrganization(client.stigmer),
  ]);
  const format = readFormat(options);
  const orgLabel = await humanOrgLabel(client.stigmer, message, format, hideOrg);
  process.stdout.write(renderResource(schema, message, format, { hideOrg, orgLabel }));
}

async function runGetRun(reference: string, options: GetFlags, command: Command): Promise<void> {
  const [{ connectBackend }, { getRun }, { renderResource }] = await Promise.all([
    import("../backend.js"),
    import("../resources/runs.js"),
    import("../resources/render.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  // Runs are addressed by ID; org context is irrelevant.
  void globalOrg(command);

  const [{ schema, message }, hideOrg] = await Promise.all([
    getRun(client.stigmer, reference),
    omitsOrganization(client.stigmer),
  ]);
  const format = readFormat(options);
  const orgLabel = await humanOrgLabel(client.stigmer, message, format, hideOrg);
  process.stdout.write(renderResource(schema, message, format, { hideOrg, orgLabel }));
}

/**
 * The organization's slug for the human field view, which names it in place
 * of the id the resource carries; undefined for json and yaml, which print
 * the resource exactly as the server answered, and when the Org line is
 * hidden.
 */
async function humanOrgLabel(
  stigmer: Stigmer,
  message: Message,
  format: OutputFormat,
  hideOrg: boolean,
): Promise<string | undefined> {
  if (hideOrg || format === "json" || format === "yaml") return undefined;
  const org = (message as { metadata?: { org?: string } }).metadata?.org ?? "";
  if (org === "") return undefined;
  const { organizationLabel } = await import("../client/organizations.js");
  return organizationLabel(stigmer, org);
}

// Splits "org/slug" into its parts; a bare token uses the resolved org context.
function parseOrgSlug(reference: string, org: string): [string, string] {
  const idx = reference.indexOf("/");
  if (idx > 0) return [reference.slice(0, idx), reference.slice(idx + 1)];
  return [org, reference];
}
