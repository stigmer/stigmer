// Declarative mirror of api_resource_kind.proto `kind_meta` for CLI-relevant
// kinds.
//
// A hand-kept table: the CLI reads its kinds from here, and every row is
// copied verbatim from the proto. protobuf-es does surface the `kind_meta`
// enum-value option at runtime (`getOption(value, kind_meta)`, the server
// reads it that way), so the table could be derived; until it is, the parity
// test (registry/__tests__/kind-meta-parity.test.ts) holds every row to the
// contract, so a row cannot drift from it unnoticed.

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export interface KindMeta {
  /** Proto kind_meta.name — also the YAML `kind` value (e.g. "McpServer"). */
  readonly name: string;
  /** Proto kind_meta.display_name (e.g. "MCP Server"). */
  readonly displayName: string;
  /** Proto kind_meta.id_prefix (e.g. "mcp"): what new ids are minted with. */
  readonly idPrefix: string;
  /**
   * Proto kind_meta.retired_id_prefixes: what this kind's ids were minted
   * with before. Ids are never rewritten, so a stored id may still carry one
   * (a run's `aex_…`); readers that tell a kind from an id read these too.
   */
  readonly retiredIdPrefixes?: readonly string[];
}

export const KIND_META: ReadonlyMap<ApiResourceKind, KindMeta> = new Map([
  [
    ApiResourceKind.organization,
    { name: "Organization", displayName: "Organization", idPrefix: "org" },
  ],
  [
    ApiResourceKind.agent,
    { name: "Agent", displayName: "Agent", idPrefix: "agt" },
  ],
  [
    ApiResourceKind.skill,
    { name: "Skill", displayName: "Skill", idPrefix: "skl" },
  ],
  [
    ApiResourceKind.plugin,
    { name: "Plugin", displayName: "Plugin", idPrefix: "plg" },
  ],
  [
    ApiResourceKind.mcp_server,
    { name: "McpServer", displayName: "MCP Server", idPrefix: "mcp" },
  ],
  [
    ApiResourceKind.api_key,
    { name: "ApiKey", displayName: "API Key", idPrefix: "key" },
  ],
  [
    ApiResourceKind.identity_provider,
    {
      name: "IdentityProvider",
      displayName: "Identity Provider",
      idPrefix: "idp",
    },
  ],
  [
    ApiResourceKind.oauth_app,
    { name: "OAuthApp", displayName: "OAuth App", idPrefix: "oapp" },
  ],
  [
    ApiResourceKind.credential,
    { name: "Credential", displayName: "Credential", idPrefix: "cred" },
  ],
  [
    ApiResourceKind.agent_share,
    { name: "AgentShare", displayName: "Agent Share", idPrefix: "ash" },
  ],
  [
    ApiResourceKind.agent_channel,
    { name: "AgentChannel", displayName: "Agent Channel", idPrefix: "ach" },
  ],
  [
    ApiResourceKind.channel_app,
    { name: "ChannelApp", displayName: "Channel App", idPrefix: "chapp" },
  ],
  [
    ApiResourceKind.schedule,
    { name: "Schedule", displayName: "Schedule", idPrefix: "sch" },
  ],
  [
    ApiResourceKind.session,
    { name: "Session", displayName: "Session", idPrefix: "ses" },
  ],
  [
    ApiResourceKind.run,
    { name: "Run", displayName: "Run", idPrefix: "run", retiredIdPrefixes: ["aex"] },
  ],
]);

// Kinds that are user-facing in the CLI and therefore registered as addressable
// types. (Inherited from the Go CLI's `cliRelevantKinds`, removed in the
// TypeScript migration — stigmer/stigmer#203.) Note: run is
// intentionally excluded — it is driven through its dedicated
// RunQueryController RPCs as a command special-case, not the generic
// verb dispatch, even though it carries kind metadata above and a verb-support
// entry below.
export const CLI_RELEVANT_KINDS: readonly ApiResourceKind[] = [
  ApiResourceKind.organization,
  ApiResourceKind.agent,
  ApiResourceKind.skill,
  ApiResourceKind.plugin,
  ApiResourceKind.mcp_server,
  ApiResourceKind.api_key,
  ApiResourceKind.identity_provider,
  ApiResourceKind.oauth_app,
  ApiResourceKind.credential,
  ApiResourceKind.agent_share,
  ApiResourceKind.agent_channel,
  ApiResourceKind.channel_app,
  ApiResourceKind.schedule,
  ApiResourceKind.session,
];

/**
 * YAML kinds the platform once served and no longer does. A manifest that
 * still carries one is an old file, not a typo, so the refusal it meets
 * says what happened and what to do instead of "unknown kind"; the
 * registry's `unknownKindError` reads this table before falling back to the
 * generic sentence. The key is the YAML `kind` value as the retired proto
 * declared it; the value is the sentence that follows the kind's name.
 */
export const RETIRED_KINDS: ReadonlyMap<string, string> = new Map([
  [
    "AgentInstance",
    "is no longer a Stigmer resource. A conversation starts on the agent itself: run `stigmer run <org>/<agent>`, and delete this file.",
  ],
  [
    "WorkflowInstance",
    "is no longer a Stigmer resource. A run starts on an agent: run `stigmer run <org>/<agent>`, pass the keys it reads with `--env` (`--secret` for a secret) or save them as a credential with `stigmer credential create`, and delete this file.",
  ],
  [
    "Environment",
    "is no longer a Stigmer resource. Saved keys are credentials, created with their values and never applied from a file: run `stigmer credential create <name> --field KEY=VALUE --serves agent:<slug>`, and delete this file.",
  ],
  [
    "Project",
    "is no longer a Stigmer resource. A folder of resources that belong together is a plugin: run `stigmer push plugin <dir>` to install it as one, or apply each resource file with `stigmer apply -f <file>`.",
  ],
]);
