// Canonical valid Session fixtures for the conformance suite.
// Domain: conformance support.
//
// Session is the runtime conversation thread. It names the agent it runs by
// reference (spec.agent_ref), or none: an absent reference is the built-in
// assistant. The server pins the agent and the exact version the reference
// resolves to on status.agent_id and status.agent_version_hash, so a
// version the author saves later never changes an open conversation. The
// builder sets a reference only when the caller passes one (`agentRef`,
// usually `agentRefOf(agent)` from support/agents.ts); the built-in
// assistant is the builder with no reference.
//
// Negatives (duplicate, missing name, wrong const fields) are written inline in the
// suite, matching support/agents.ts and support/vaults.ts: this module is
// validity-by-construction. harness_state_id is normally populated by the engine
// after the first execution and gates the harness / execution_target immutability
// validators; the Class B immutability suite sets it directly (it is a plain
// client-settable spec field) to exercise those validators hermetically.
import type { InitShape } from "./init-shape";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness, ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { type AgentRefInit, makeAgentRef } from "./agents";

export const SESSION_API_VERSION = "agentic.stigmer.ai/v1";
export const SESSION_KIND = "Session";

export interface SessionSpecOptions {
  // The agent the session runs (spec.agent_ref), optionally at a version.
  // Omitted: the built-in assistant.
  agentRef?: AgentRefInit;
  // Conversation title; defaults to a stable placeholder.
  subject?: string;
  // Execution engine. Omitted by default so the create-vs-get parity check stays
  // stable on the as-stored value (the server does not normalize harness at
  // create — UNSPECIFIED is only resolved to NATIVE at execution dispatch).
  harness?: Harness;
  // Where activities run. Omitted by default for the same parity reason.
  executionTarget?: ExecutionTarget;
  // The immutability sentinel (spec.harness_state_id). Normally populated by the
  // engine after the first execution; the immutability suite sets it directly to
  // exercise the harness / execution_target immutability validators hermetically
  // (it is a plain client-settable spec field). Omitted by default.
  harnessStateId?: string;
  // Session-level McpServer slugs, projected into spec.mcp_server_usages. Org is
  // left empty so the server normalizes it to the session's org.
  mcpServerRefs?: string[];
  // Session-level Skill slugs, projected into spec.skill_refs.
  skillRefs?: string[];
  // Workspaces mounted for the session's turns (spec.workspace_entries), each a
  // local path on the runner's host. The first entry is the primary workspace:
  // when it is a git work tree the runner runs its turns in file-review capture
  // mode (the file-review suites attach a harness GitWorkspace here).
  localWorkspaces?: LocalWorkspaceOption[];
  // Vault slugs the conversation lists (spec.vaults), in order: the
  // conversation uses exactly those, after the sender's My vault when
  // includeMyVault is set.
  vaults?: string[];
  // Whether each turn also uses its sender's My vault, first
  // (spec.include_my_vault). Omitted = off, the wire default.
  includeMyVault?: boolean;
}

export interface LocalWorkspaceOption {
  name: string;
  // Absolute path on the host the runner runs on.
  path: string;
}

// A valid SessionSpec naming the given agent (or none). Optional harness /
// execution_target / references are only set when explicitly provided, keeping the
// canonical session minimal and parity-stable.
export function makeSessionSpec(opts: SessionSpecOptions = {}): InitShape<typeof SessionSpecSchema> {
  return {
    ...(opts.agentRef !== undefined ? { agentRef: makeAgentRef(opts.agentRef) } : {}),
    subject: opts.subject ?? "conformance fixture session",
    ...(opts.harness !== undefined ? { harness: opts.harness } : {}),
    ...(opts.executionTarget !== undefined ? { executionTarget: opts.executionTarget } : {}),
    ...(opts.harnessStateId !== undefined ? { harnessStateId: opts.harnessStateId } : {}),
    mcpServerUsages: (opts.mcpServerRefs ?? []).map((slug) => ({
      mcpServerRef: { slug, kind: ApiResourceKind.mcp_server },
    })),
    skillRefs: (opts.skillRefs ?? []).map((slug) => ({ slug, kind: ApiResourceKind.skill })),
    ...(opts.localWorkspaces !== undefined ? { workspaceEntries: localWorkspaceEntries(opts.localWorkspaces) } : {}),
    ...(opts.vaults !== undefined ? { vaults: opts.vaults.map((slug) => ({ slug, kind: ApiResourceKind.vault })) } : {}),
    ...(opts.includeMyVault !== undefined ? { includeMyVault: opts.includeMyVault } : {}),
  };
}

// spec.workspace_entries for local-path workspaces, the one projection both
// the Session builder above and an execution's one-call bootstrap
// (Run.spec.session_spec) mount a host directory through.
export function localWorkspaceEntries(
  workspaces: readonly LocalWorkspaceOption[],
): NonNullable<InitShape<typeof SessionSpecSchema>["workspaceEntries"]> {
  return workspaces.map((workspace) => ({
    name: workspace.name,
    source: { source: { case: "localPath" as const, value: { path: workspace.path } } },
  }));
}

export interface SessionOptions extends SessionSpecOptions {
  org: string;
  name: string;
  // Metadata labels. The activity suite uses these to stamp runtime-origin
  // labels (stigmer.ai/channel-id etc.) the way the channel/schedule runtimes
  // do, exercising the recents personal-sessions-only exclusion.
  labels?: Record<string, string>;
}

// A complete, valid Session resource ready to hand to create/apply/update.
export function makeSession(opts: SessionOptions): InitShape<typeof SessionSchema> {
  const { org, name, labels, ...specOpts } = opts;
  return {
    apiVersion: SESSION_API_VERSION,
    kind: SESSION_KIND,
    metadata: { name, org, ...(labels !== undefined ? { labels } : {}) },
    spec: makeSessionSpec(specOpts),
  };
}
