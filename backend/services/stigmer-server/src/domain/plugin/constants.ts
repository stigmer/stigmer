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

/** FailedPrecondition copy when the upload lane was not configured. */
export const TRANSFER_LANE_NOT_CONFIGURED =
  "plugin artifact transfer lane is not configured on this server";

/**
 * Warning kinds the SERVER adds to the library's; the wire carries them as
 * strings, and the list in PluginWarning.kind's comment (plugin/v1/status.proto)
 * is kept equal to this one because the SDK docs are generated from it.
 */
export const SERVER_WARNING_KINDS = {
  /** An agent left out because every entry of its `tools` list was dropped. */
  agentNotInstalled: "agent-not-installed",
  componentIgnored: "component-ignored",
  modelHintUnresolved: "model-hint-unresolved",
  /** A Claude plugin's settings name a main agent, which a conversation's own agent replaces. */
  settingsAgentNotApplied: "settings-agent-not-applied",
  /** A tool-list entry the contract cannot store. */
  toolListEntryDropped: "tool-list-entry-dropped",
  versionNotTaggable: "version-not-taggable",
} as const;
