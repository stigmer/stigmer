/**
 * Plugin domain constants — every wire-visible string and pinned value in
 * one place (guidelines: errors are API surface; the CLI, console and SDK
 * show these verbatim). The archive budgets are the platform's
 * (src/archive/limits.ts); what is a plugin's is here.
 */

/** Storage key prefix for plugin archives: "plugins/<digest>.zip". */
export const PLUGIN_ARTIFACT_KEY_PREFIX = "plugins/";

/**
 * A manifest version becomes the plugin's audit tag only when it fits the
 * tag pattern every versioned kind shares (`spec.tag` on skills). Semantic
 * Versioning build metadata (`1.0.0+build.1`) does not fit; such a version
 * installs untagged with a warning rather than refusing the plugin.
 */
export const VERSION_TAG_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * The runner's built-in sub-agents. A plugin sub-agent bearing one of these
 * names shadows a built-in at run time; the runner only warns, so the
 * install warns too rather than refusing (an M1 finding kept as data here).
 */
export const BUILT_IN_SUB_AGENT_NAMES: ReadonlySet<string> = new Set([
  "explore",
  "shell",
  "general-purpose",
]);

/**
 * The materialisation order and the kinds a plugin may own, in the order
 * references resolve: an agent names skills and servers, a workflow may
 * name the agent. Cascade deletes in reverse.
 */
export const MATERIALIZATION_ORDER = [
  "skill",
  "mcp_server",
  "agent",
  "workflow",
] as const;
export type MaterializedKindName = (typeof MATERIALIZATION_ORDER)[number];

/** FailedPrecondition copy when the upload lane was not configured. */
export const TRANSFER_LANE_NOT_CONFIGURED =
  "plugin artifact transfer lane is not configured on this server";

/**
 * Warning kinds the SERVER adds to the library's; the wire carries them as
 * strings, and the list in PluginWarning.kind's comment (plugin/v1/status.proto)
 * is kept equal to this one because the SDK docs are generated from it.
 */
export const SERVER_WARNING_KINDS = {
  componentIgnored: "component-ignored",
  /** A system-content row the plugin took over in place (members.ts, judgeSlug). */
  memberAdopted: "member-adopted",
  modelHintUnresolved: "model-hint-unresolved",
  subAgentNameBuiltin: "sub-agent-name-builtin",
  versionNotTaggable: "version-not-taggable",
} as const;
