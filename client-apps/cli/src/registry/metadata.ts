// Declarative mirror of api_resource_kind.proto `kind_meta` for CLI-relevant
// kinds.
//
// A hand-kept table: the CLI reads its kinds from here, and every row is
// copied verbatim from the proto. protobuf-es does surface the `kind_meta`
// enum-value option at runtime (`getOption(value, kind_meta)`, the server
// reads it that way), so the table could be derived; until it is, the parity
// test (registry/__tests__/kind-meta-parity.test.ts) holds every row to the
// contract, so a row cannot drift from it unnoticed.

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export interface KindMeta {
  /** Proto kind_meta.name — also the YAML `kind` value (e.g. "ChannelApp"). */
  readonly name: string;
  /** Proto kind_meta.display_name (e.g. "Channel App"). */
  readonly displayName: string;
  /** Proto kind_meta.id_prefix (e.g. "chn"): what new ids are minted with. */
  readonly idPrefix: string;
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
    ApiResourceKind.api_key,
    { name: "ApiKey", displayName: "API Key", idPrefix: "key" },
  ],
  [
    ApiResourceKind.federation_issuer,
    { name: "FederationIssuer", displayName: "Federation Issuer", idPrefix: "fis" },
  ],
  [
    ApiResourceKind.oauth_app,
    { name: "OAuthApp", displayName: "OAuth App", idPrefix: "oapp" },
  ],
  [
    ApiResourceKind.vault,
    { name: "Vault", displayName: "Vault", idPrefix: "vlt" },
  ],
  [
    ApiResourceKind.channel,
    { name: "Channel", displayName: "Channel", idPrefix: "chn" },
  ],
  [
    ApiResourceKind.channel_app,
    { name: "ChannelApp", displayName: "Channel App", idPrefix: "chapp" },
  ],
  [
    ApiResourceKind.routine,
    { name: "Routine", displayName: "Routine", idPrefix: "rtn" },
  ],
  [
    ApiResourceKind.environment,
    { name: "Environment", displayName: "Environment", idPrefix: "env" },
  ],
  [
    ApiResourceKind.session,
    { name: "Session", displayName: "Session", idPrefix: "ses" },
  ],
  [
    ApiResourceKind.file,
    { name: "File", displayName: "File", idPrefix: "file" },
  ],
  [
    ApiResourceKind.run,
    { name: "Run", displayName: "Run", idPrefix: "run" },
  ],
  [
    ApiResourceKind.score,
    { name: "Score", displayName: "Score", idPrefix: "scr" },
  ],
  [
    ApiResourceKind.scoring_rule,
    { name: "ScoringRule", displayName: "Scoring Rule", idPrefix: "srl" },
  ],
  [
    ApiResourceKind.eval,
    { name: "Eval", displayName: "Eval", idPrefix: "evs" },
  ],
  [
    ApiResourceKind.eval_run,
    { name: "EvalRun", displayName: "Eval Run", idPrefix: "evr" },
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
  ApiResourceKind.api_key,
  ApiResourceKind.federation_issuer,
  ApiResourceKind.oauth_app,
  ApiResourceKind.vault,
  ApiResourceKind.channel,
  ApiResourceKind.channel_app,
  ApiResourceKind.routine,
  ApiResourceKind.environment,
  ApiResourceKind.session,
  ApiResourceKind.file,
  ApiResourceKind.score,
  ApiResourceKind.scoring_rule,
  ApiResourceKind.eval,
  ApiResourceKind.eval_run,
];
