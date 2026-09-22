/**
 * The one data migration both store drivers run when the public visibility
 * level is retired: every stored row that holds `visibility_public` is moved
 * to `visibility_org`, once, in place. The drivers own the SQL (which rows
 * to read, how to write them back, the transaction); this module owns what
 * is edition- and driver-neutral: WHICH kinds could hold the level and HOW
 * one row's bytes are moved.
 *
 * Why a migration and not a sweep. The migration chain is the one place
 * that runs exactly once per database, before any request is served. A
 * public row nobody can set again would otherwise stay readable by every
 * account on a self-hosted install forever, because the level's grant was
 * derived from the row itself; on the hosted edition the rows are moved
 * through the API before this release deploys (the tuple lifecycle is
 * row-driven, and only that path deletes the grant's stored tuple), so the
 * migration there finds none and is the safety net, never the mechanism.
 *
 * Why the kind table is frozen here and not read from the live kind
 * configuration. A migration is a statement about the store AS IT WAS when
 * the level was retired: the seven kinds whose VisibilityConfig declared
 * `supports_public` at that moment are the only kinds a public row can
 * exist under, and a later release that adds or removes a kind must not
 * change what this step does. The list is spelled out with its schemas, the
 * per-consumer kind-to-schema idiom the tree already uses; nothing here
 * reads `kind_meta`. The `kind` strings are the enum NAMES the drivers'
 * `kind` column holds (proto-fields.ts `apiResourceKindName`).
 *
 * Why decode and re-encode rather than patch bytes. `resources.data` is the
 * marshaled proto message; the level is one enum field on the metadata
 * message, and only a decode knows where it is. protobuf-es keeps unknown
 * fields through `fromBinary` and writes them back in `toBinary`, so a row
 * written by a newer or older release than this one loses nothing it
 * carried; every other field is re-encoded from the same values. A row this
 * step cannot decode is a fault that fails the whole transaction (the
 * driver's `applyInTransaction` rolls back and the boot stops): skipping it
 * would leave the one row the migration exists for readable by everyone,
 * silently.
 *
 * `resource_audit` is deliberately untouched: it is the version history,
 * and a snapshot that said "public" at the time is true history. The search
 * index is left to boot's rebuild, which re-derives it from the rows.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

/** One kind that could hold the public level, with the schema its rows decode through. */
export interface PublicRowKind {
  /** The enum NAME the drivers' `kind` column holds. */
  readonly kind: string;
  readonly schema: DescMessage;
}

/**
 * The seven kinds whose VisibilityConfig declared `supports_public` when the
 * level was retired — frozen (the module header). Order is the order the
 * drivers walk the kinds; it has no other meaning.
 */
export const PUBLIC_ROW_KINDS_AT_RETIREMENT: ReadonlyArray<PublicRowKind> = [
  { kind: "agent", schema: AgentSchema },
  { kind: "skill", schema: SkillSchema },
  { kind: "mcp_server", schema: McpServerSchema },
  { kind: "agent_instance", schema: AgentInstanceSchema },
  { kind: "workflow", schema: WorkflowSchema },
  { kind: "workflow_instance", schema: WorkflowInstanceSchema },
  { kind: "plugin", schema: PluginSchema },
];

/** The level every moved row takes: the widest level that stays inside the owning organization. */
export const LEVEL_AFTER_RETIREMENT = ApiResourceVisibility.visibility_org;

/**
 * The moved bytes of one row when it holds the public level, or undefined
 * when it does not (the driver then leaves the row's bytes exactly as they
 * are; a row with no metadata holds no level and is one of these). Throws
 * when the bytes do not decode as the kind's message: a row this migration
 * cannot read is a row it must not pass over (the module header).
 */
export function movePublicRowToOrg(
  entry: PublicRowKind,
  data: Uint8Array,
): Uint8Array | undefined {
  const message = fromBinary(entry.schema, data);
  const root = reflect(entry.schema, message);
  const metadataField = root.fields.find((field) => field.name === "metadata");
  if (metadataField === undefined || metadataField.fieldKind !== "message") {
    throw new Error(
      `${entry.kind}: the schema declares no metadata message field`,
    );
  }
  if (!root.isSet(metadataField)) {
    return undefined;
  }
  const metadata = root.get(metadataField);
  const visibilityField = metadata.fields.find(
    (field) => field.name === "visibility",
  );
  if (visibilityField === undefined || visibilityField.fieldKind !== "enum") {
    throw new Error(
      `${entry.kind}: the metadata message declares no visibility enum field`,
    );
  }
  if (
    metadata.get(visibilityField) !== ApiResourceVisibility.visibility_public
  ) {
    return undefined;
  }
  metadata.set(visibilityField, LEVEL_AFTER_RETIREMENT);
  return toBinary(entry.schema, message);
}
