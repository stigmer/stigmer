// `delete` dispatch: resolve a resource by reference, describe it for a
// confirmation prompt, then delete it. Mirrors the Go CLI's unified delete,
// including its three special cases:
//
//   - execution  → maps to a *cancel* (agent executions only, by ID)
//   - organization → not org-scoped; resolved via findMyOrganizations
//   - api_key    → addressable by ID only (not slug)
//
// The deletion verbs are id-shaped mutations, so they ride the high-level
// `client.stigmer.*` sub-clients — only `apply` needs raw controllers (see the
// Wave 2 architecture note). Fetching reuses the `get` bindings rather than
// re-implementing a second fetch path.
//
// Each kind produces a DeletePlan: a warning to show before confirming, the
// confirmation prompt, and a `perform` thunk that runs the mutation and returns
// the success/already-terminal result. The command layer owns the interaction
// (render warning → confirm → perform → render result); this module owns *what*
// to delete and *how* to describe it.

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
import { CliExitError, ExitCode, UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { defaultRegistry, type TypeInfo, Verb } from "../registry/index.js";
import { cancelAgentExecution, formatAgentPhase, isAgentExecutionId } from "./execution.js";
import { fetchResource } from "./get.js";
import { getterFor } from "./get-bindings.js";
import { parseReference } from "./reference.js";

/** A staged delete: confirmation content plus the mutation to run on approval. */
export interface DeletePlan {
  /** Shown to the user (unless `--force`) before the destructive action. */
  readonly warning: CommandResult;
  /** The yes/no question, e.g. "Proceed with deletion? [y/N]". */
  readonly confirmPrompt: string;
  /** Runs the mutation and returns the result to render. */
  perform(): Promise<CommandResult>;
}

// Every resource proto carries the same ApiResourceMetadata envelope; this is
// the structural slice the delete UI needs. Reading it generically keeps the
// dispatch kind-agnostic without a per-kind accessor.
interface HasMetadata {
  readonly metadata?: { readonly id?: string; readonly name?: string; readonly slug?: string; readonly org?: string };
}

type DeleteFn = (client: Stigmer, id: string) => Promise<HasMetadata>;

// Kinds the unified delete handles directly, each bound to its SDK delete call.
// Mirrors Go's routeDelete switch exactly: kinds that carry a Delete verb but no
// entry here (identity_provider, oauth_app, environment, instances, session)
// fall through to a "not implemented" usage error, as in Go's default branch.
// McpServer is the outlier whose delete takes a DeleteResourceInput, not an ID.
const DELETE_HANDLERS: ReadonlyMap<ApiResourceKind, DeleteFn> = new Map<ApiResourceKind, DeleteFn>([
  [ApiResourceKind.agent, (c, id) => c.agent.delete(id)],
  [ApiResourceKind.workflow, (c, id) => c.workflow.delete(id)],
  [ApiResourceKind.mcp_server, (c, id) => c.mcpServer.delete({ resourceId: id })],
  [ApiResourceKind.project, (c, id) => c.project.delete(id)],
  [ApiResourceKind.skill, (c, id) => c.skill.delete(id)],
  [ApiResourceKind.api_key, (c, id) => c.apiKey.delete(id)],
]);

/**
 * Build the delete plan for a `<type> <reference>` pair. Routes the three
 * special cases first, then the registry-driven standard path. Throws on
 * unknown/unsupported types before any network call.
 */
export async function planDelete(
  client: Stigmer,
  typeArg: string,
  reference: string,
  org: string,
): Promise<DeletePlan> {
  if (isExecutionAlias(typeArg)) {
    return planExecutionCancel(client, reference);
  }

  const info = defaultRegistry().getByAlias(typeArg);
  if (info === undefined) {
    throw new UsageError(
      `unknown resource type: ${typeArg}\n\nAvailable types: agent, workflow, mcpserver, project, skill, execution, organization`,
    );
  }

  if (info.kind === ApiResourceKind.organization) {
    return planOrganizationDelete(client, reference);
  }

  if (!info.supportedVerbs.has(Verb.Delete)) {
    throw new UsageError(`${info.displayName} does not support 'delete'`);
  }

  const deleteFn = DELETE_HANDLERS.get(info.kind);
  if (deleteFn === undefined) {
    throw new UsageError(`delete not implemented for ${info.displayName}`);
  }

  return planStandardDelete(client, info, reference, org, deleteFn);
}

function isExecutionAlias(typeArg: string): boolean {
  const normalized = typeArg.trim().toLowerCase();
  return normalized === "execution" || normalized === "executions" || normalized === "exec";
}

async function planStandardDelete(
  client: Stigmer,
  info: TypeInfo,
  reference: string,
  org: string,
  deleteFn: DeleteFn,
): Promise<DeletePlan> {
  // Safe by construction: every DELETE_HANDLERS key also has a get binding.
  const getter = getterFor(info.kind);
  if (getter === undefined) {
    throw new UsageError(`delete not implemented for ${info.displayName}`);
  }

  const parsed = parseReference(reference, org, info.idPrefix);
  // ResourceResult.message is the opaque proto Message; every resource carries
  // the ApiResourceMetadata envelope, so read it through the structural view.
  const resource = (await getter(client, parsed)).message as unknown as HasMetadata;
  const id = metaOf(resource).id;

  return {
    warning: buildDeleteWarning(info, resource),
    confirmPrompt: "Proceed with deletion? [y/N]",
    perform: async () => buildDeleteSuccess(info, await deleteFn(client, id)),
  };
}

async function planOrganizationDelete(client: Stigmer, reference: string): Promise<DeletePlan> {
  // Organizations are not org-scoped: a bare token is a slug resolved against
  // the caller's memberships (fetchResource handles the id-vs-slug split).
  const parsed = parseReference(reference, "", "org");
  const resource = (await fetchResource(client, ApiResourceKind.organization, parsed)).message as unknown as HasMetadata;
  const meta = metaOf(resource);

  const warning = CommandResult.warning("You are about to delete the following organization:");
  warning.addSection("").field("ID", meta.id).field("Name", meta.name).field("Slug", meta.slug);
  warning.hint("This will delete the organization and all its resources.");
  warning.hint("This action cannot be undone.");

  return {
    warning,
    confirmPrompt: "Proceed with deletion? [y/N]",
    perform: async () => {
      const deleted = metaOf(await client.organization.delete(meta.id));
      const out = CommandResult.success("Organization deleted successfully");
      out.addSection("Deleted Organization").field("ID", deleted.id).field("Name", deleted.name).field("Slug", deleted.slug);
      return out;
    },
  };
}

function planExecutionCancel(client: Stigmer, reference: string): DeletePlan {
  if (!isAgentExecutionId(reference)) {
    throw new CliExitError(
      `invalid execution ID: ${reference}\n\nExecutions must be referenced by ID (e.g., aex_01abc123)`,
      ExitCode.Usage,
    );
  }

  const warning = CommandResult.warning(`You are about to cancel execution: ${reference}`);
  warning.hint("This will gracefully stop the running agent.");

  return {
    warning,
    confirmPrompt: "Proceed with cancellation? [y/N]",
    perform: async () => {
      const { execution, wasAlreadyTerminal } = await cancelAgentExecution(client, reference);
      const id = execution.metadata?.id ?? "";
      const status = formatAgentPhase(execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED);

      const out = wasAlreadyTerminal
        ? CommandResult.warning("Execution was already in terminal state")
        : CommandResult.success("Execution cancelled successfully");
      out.addSection("Execution").field("ID", id).field("Status", status);
      return out;
    },
  };
}

// --- Warning + success rendering (mirrors Go's per-type delete handlers) ---

function buildDeleteWarning(info: TypeInfo, message: HasMetadata): CommandResult {
  if (info.kind === ApiResourceKind.api_key) {
    return buildApiKeyWarning(message);
  }

  const meta = metaOf(message);
  const warning = CommandResult.warning(`You are about to delete the following ${info.displayName.toLowerCase()}:`);
  const section = warning
    .addSection("")
    .field("ID", meta.id)
    .field("Name", meta.name)
    .field("Slug", meta.slug)
    .field("Org", meta.org);

  if (info.kind === ApiResourceKind.skill) {
    const tag = (message as { spec?: { tag?: string } }).spec?.tag;
    if (tag) section.field("Tag", tag);
    warning.hint("This will delete the skill and all its versions.");
  }

  warning.hint("This action cannot be undone.");
  return warning;
}

function buildApiKeyWarning(message: HasMetadata): CommandResult {
  const meta = metaOf(message);
  const warning = CommandResult.warning("You are about to delete the following API key:");
  const section = warning.addSection("").field("ID", meta.id);
  if (meta.name) section.field("Name", meta.name);
  const fingerprint = (message as { spec?: { fingerprint?: string } }).spec?.fingerprint;
  if (fingerprint) section.field("Fingerprint", `***${fingerprint}`);
  warning.hint("This will permanently revoke the API key.");
  warning.hint("This action cannot be undone.");
  return warning;
}

function buildDeleteSuccess(info: TypeInfo, deleted: HasMetadata): CommandResult {
  const meta = metaOf(deleted);
  const out = CommandResult.success(`${info.displayName} deleted successfully`);
  const section = out.addSection(`Deleted ${info.displayName}`).field("ID", meta.id);

  if (info.kind === ApiResourceKind.api_key) {
    if (meta.name) section.field("Name", meta.name);
    return out;
  }

  section.field("Name", meta.name).field("Slug", meta.slug);
  return out;
}

function metaOf(message: HasMetadata): { id: string; name: string; slug: string; org: string } {
  return {
    id: message.metadata?.id ?? "",
    name: message.metadata?.name ?? "",
    slug: message.metadata?.slug ?? "",
    org: message.metadata?.org ?? "",
  };
}
