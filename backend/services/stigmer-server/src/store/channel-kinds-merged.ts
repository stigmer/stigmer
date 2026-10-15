/**
 * The one data migration both store drivers run when the AgentShare and
 * AgentChannel kinds become one Channel kind (agentic/channel/v1), whose
 * type says how people reach the agent: a share is a web channel, an agent
 * channel a Slack or WhatsApp one. Postgres v36 and SQLite v40. The drivers
 * own the SQL (which rows to read, in what pages, how to write and delete
 * them, the transaction); this module owns what is driver-neutral: what one
 * row becomes, which row keeps a slug two rows held, which grant and which
 * conversation move.
 *
 * Why the rows are converted, not retired. A chat link lives in pages
 * Stigmer does not control (`/chat/<id>`, the embed), and a Slack or
 * WhatsApp connection in a provider's install, so each row keeps its id:
 * an `ash_` or `ach_` id stays valid under the kind's retired prefixes, and
 * every link, embed and webhook keeps working. The two kinds' fields map
 * one to one onto the channel's, so the conversion loses nothing a reader
 * reads.
 *
 * What one row becomes (`convertToChannel`). The old row is read by field
 * number, never through a schema: the generated messages are gone, and the
 * frozen shapes (frozen-envelopes.ts) declare only what the older steps
 * read. Each nested message is decoded with the live message that keeps its
 * numbers (ApiResourceMetadata, ApiResourceReference, RunConfig,
 * WebChannelMessages, SlackInstallStatus, WhatsAppInstallStatus,
 * ApiResourceAudit), so its own unknown fields ride through. A share's
 * audience, origins, messages and link token go to the web type; an agent
 * channel's provider arm, app reference and proactive flag to its Slack or
 * WhatsApp type, its install state and facts to status. Dropped
 * deliberately, each counted: a Slack channel's proactive flag (no sender
 * ever read it), a share's agent pin (`status.agent_id`: the reference
 * holds the agent's id, so it never names another agent), and the bytes of
 * fields the contract had already retired (a share's and a channel's
 * `environment_refs`, a channel's `credentials_environment_id`), which
 * environment-retired.ts left as unknown fields no reader decodes. Any
 * other field number fails the step, naming the row, so nothing is lost
 * silently. The row's `kind` string becomes `Channel` and its etag is
 * stamped again, as a write would stamp it.
 *
 * One namespace (`assignChannelSlugs`). Names were kept per kind, so a
 * share and a channel of one organization may hold the same slug. The
 * older row keeps it, by creation time, then by id (the rule the name
 * backfill keeps, resource-names-backfill.ts); every other row takes
 * `<slug>-<type>`, then `-2`, `-3` on that, the first one free. A row
 * whose slug no other row of its organization held keeps it. The driver
 * logs every changed slug at warn, once, as a count and a capped sample.
 * Neither kind could be renamed, so neither held a `previous` name: the
 * driver asserts it and fails by name if one exists.
 *
 * Grants, conversations, history. A grant naming either kind is re-keyed
 * to the `channel` triple's id (kind-rename.ts `rekeyedGrant`, under the
 * `grt_` prefix grants carry since Postgres v34 and SQLite v38), and its
 * history entries move with it. A conversation a chat link's guest
 * started carries `stigmer.ai/share-id`; it now carries
 * `stigmer.ai/channel-id`, the one label every type's conversations carry
 * (`relabelChannelSessionRow`, the eval-kinds-retired.ts shape: a row
 * already holding a channel id keeps it, and its etag is stamped again). A
 * Slack or WhatsApp conversation already carries the channel id and is
 * left byte for byte. Neither kind is versioned, so neither has
 * `resource_audit` rows: the driver asserts there are none and fails by
 * name if one exists, rather than carrying a converter for rows the code
 * never writes.
 *
 * List keys. A converted row is written with `updated_at` stamped and no
 * list facts, and a relabelled conversation with `updated_at` stamped, so
 * the store's reconciliation at open derives their keys with the code
 * that runs (list-index.ts); the old kinds' key rows are deleted.
 *
 * Frozen: the kind names, kind strings, labels and field numbers here are
 * the store's as it was when the kinds merged, never read off the live
 * contract, so a later change cannot change what this step does.
 *
 * An undecodable row fails the step, the rule every data migration here
 * keeps: the driver's transaction rolls back and the boot stops on the row
 * it names.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";

import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import type { ChannelAudience } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import {
  ChannelSpecSchema,
  SlackChannelConfigSchema,
  WebChannelConfigSchema,
  WebChannelMessagesSchema,
  WhatsAppChannelConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import {
  ChannelStatusSchema,
  SlackInstallStatusSchema,
  WebChannelStatusSchema,
  WhatsAppInstallStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/channel/v1/status_pb";
import type { ChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/status_pb";
import { RunConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { ApiResourceAudit } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";

import { stampEtag, storedEtagOf } from "./etag.js";
import { FrozenAgentChannelSchema, FrozenAgentShareSchema } from "./frozen-envelopes.js";
import { GRANT_ID_PREFIX_V34, rekeyedGrant } from "./kind-rename.js";
import type { KindRename, RekeyedGrant } from "./kind-rename.js";
import type { StoreLogger } from "./logger.js";

/** The `kind` column value and kind string of a share at the merge. */
export const SHARE_KIND_AT_MERGE = "agent_share";

/** The `kind` column value and kind string of an agent channel at the merge. */
export const AGENT_CHANNEL_KIND_AT_MERGE = "agent_channel";

/** The `kind` column value the merged rows take. */
export const CHANNEL_KIND_AT_MERGE = "channel";

/** The two kinds the step merges, by their `kind` column values. */
export const MERGED_CHANNEL_KINDS: ReadonlyArray<string> = [SHARE_KIND_AT_MERGE, AGENT_CHANNEL_KIND_AT_MERGE];

/** The `kind` column value of the grant rows the step reads (Postgres v34 and SQLite v38 named it). */
export const CHANNEL_MERGE_GRANT_KIND = "grant";

/** The `kind` column values of the conversation rows the step relabels. */
export const CHANNEL_MERGE_SESSION_KINDS: ReadonlyArray<string> = ["session", "run"];

/** The label a chat link's guest conversations carried before the merge. */
export const SHARE_ID_LABEL_AT_MERGE = "stigmer.ai/share-id";

/** The label every channel's conversations carry, written here as the merge's own constant. */
export const CHANNEL_ID_LABEL_AT_MERGE = "stigmer.ai/channel-id";

/** How many rows the step decodes per page. */
export const CHANNEL_MERGE_PAGE_SIZE = 500;

/** How many changed slugs the step's warning names. */
export const CHANNEL_MERGE_SLUG_SAMPLE = 10;

/** The share's half of the merge, as the grant re-key reads it (kind-rename.ts). */
export const SHARE_MERGE_V36: KindRename = {
  kind: [SHARE_KIND_AT_MERGE, CHANNEL_KIND_AT_MERGE],
  kindString: ["AgentShare", "Channel"],
  schema: FrozenAgentShareSchema,
  label: "the merge of the agent share into the channel",
};

/** The agent channel's half of the merge, as the grant re-key reads it (kind-rename.ts). */
export const AGENT_CHANNEL_MERGE_V36: KindRename = {
  kind: [AGENT_CHANNEL_KIND_AT_MERGE, CHANNEL_KIND_AT_MERGE],
  kindString: ["AgentChannel", "Channel"],
  schema: FrozenAgentChannelSchema,
  label: "the merge of the agent channel into the channel",
};

/** The type a converted row takes, by its manifest field name. */
export type MergedChannelType = "web" | "slack" | "whatsapp";

/** What the merge dropped deliberately from one row (the module header), for its log. */
export interface DroppedAtMerge {
  /** A Slack channel's proactive flag was set. */
  readonly slackProactiveFlag: boolean;
  /** A share's agent pin was set. */
  readonly sharePin: boolean;
  /** The row held bytes of a field the contract had already retired. */
  readonly retiredFields: boolean;
}

/** One stored share or agent channel, converted. */
export interface ConvertedChannel {
  /** The `kind` column value the row was stored under. */
  readonly fromKind: string;
  readonly id: string;
  readonly org: string;
  /** The slug the row held before the merge. */
  readonly slug: string;
  /** `status.audit.spec_audit.created_at` as RFC-3339, or "" when the row has none. */
  readonly createdAt: string;
  readonly type: MergedChannelType;
  readonly dropped: DroppedAtMerge;
  /** The converted resource, its slug the one it held (`encodeChannel` sets the final one). */
  readonly channel: Channel;
}

/** The step's failure for a row it cannot read or convert (the module header). */
export function unreadableChannelMergeRowError(kind: string, id: string, error: unknown): Error {
  return new Error(
    `${kind} '${id}' cannot be read to merge the agent share and agent channel kinds into the channel kind: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}

/** The step's failure for an archived version of a merged kind, which neither kind ever wrote. */
export function channelMergeAuditRowError(kind: string, resourceId: string): Error {
  return new Error(
    `${kind} '${resourceId}' has an archived version, which no release wrote for this kind, so the merge into the channel kind does not know what it means; remove the resource_audit rows of ${kind} '${resourceId}', then start the server again`,
  );
}

/** The step's failure for a previous name of a merged kind, which neither kind could take. */
export function channelMergePreviousNameError(kind: string, org: string, name: string): Error {
  return new Error(
    `${kind} name '${org}/${name}' is a previous name, which no release let this kind take, so the merge into the channel kind does not know what it means; remove that resource_names row, then start the server again`,
  );
}

/**
 * One stored row of `fromKind` (agent_share or agent_channel), converted
 * (the module header). Throws when the bytes do not decode or hold a field
 * the merge does not know.
 */
export function convertToChannel(fromKind: string, id: string, data: Uint8Array): ConvertedChannel {
  if (fromKind !== SHARE_KIND_AT_MERGE && fromKind !== AGENT_CHANNEL_KIND_AT_MERGE) {
    throw new Error(`${fromKind} is not a kind the merge converts`);
  }
  const envelope = readEnvelope(data);
  const metadata = envelope.metadata ?? create(ApiResourceMetadataSchema);
  const converted =
    fromKind === SHARE_KIND_AT_MERGE
      ? convertShare(envelope.spec, envelope.status)
      : convertAgentChannel(envelope.spec, envelope.status);
  const channel = create(ChannelSchema, {
    apiVersion: envelope.apiVersion,
    kind: "Channel",
    metadata,
    spec: converted.spec,
    status: converted.status,
  });
  const createdAt = converted.status.audit?.specAudit?.createdAt;
  return {
    fromKind,
    id,
    org: metadata.org,
    slug: metadata.slug,
    createdAt: createdAt === undefined ? "" : timestampDate(createdAt).toISOString(),
    type: converted.type,
    dropped: converted.dropped,
    channel,
  };
}

/**
 * The final slug of every converted row whose slug changes (the module
 * header's one namespace): a map from row id to its new slug. A row not in
 * the map keeps the slug it held.
 */
export function assignChannelSlugs(rows: ReadonlyArray<ConvertedChannel>): Map<string, string> {
  const byOrg = new Map<string, ConvertedChannel[]>();
  for (const row of rows) {
    const held = byOrg.get(row.org) ?? [];
    held.push(row);
    byOrg.set(row.org, held);
  }
  const changed = new Map<string, string>();
  for (const orgRows of byOrg.values()) {
    const ordered = [...orgRows].sort((a, b) => (isOlder(a, b) ? -1 : isOlder(b, a) ? 1 : 0));
    const taken = new Set<string>();
    const losers: ConvertedChannel[] = [];
    for (const row of ordered) {
      if (row.slug === "" || !taken.has(row.slug)) {
        taken.add(row.slug);
      } else {
        losers.push(row);
      }
    }
    for (const row of losers) {
      const base = `${row.slug}-${row.type}`;
      let slug = base;
      for (let n = 2; taken.has(slug); n++) {
        slug = `${base}-${n}`;
      }
      taken.add(slug);
      changed.set(row.id, slug);
    }
  }
  return changed;
}

/** The converted row's bytes under `slug`, its etag stamped as a write would stamp it. */
export function encodeChannel(row: ConvertedChannel, slug: string): Uint8Array {
  const channel = row.channel;
  if (channel.metadata !== undefined) {
    channel.metadata.slug = slug;
  }
  stampEtag(ChannelSchema, channel);
  return toBinary(ChannelSchema, channel);
}

/**
 * The relabelled bytes of one conversation row of `kindName` (session or
 * run), or undefined when it carries no share id (the driver then leaves
 * its bytes as they are). A row that already holds a channel id keeps that
 * value. Throws when the bytes do not decode.
 */
export function relabelChannelSessionRow(kindName: string, data: Uint8Array): Uint8Array | undefined {
  const schema = SESSION_SCHEMAS.get(kindName);
  if (schema === undefined) {
    return undefined;
  }
  const resource = fromBinary(schema, data);
  const labels = (resource as unknown as { readonly metadata?: { readonly labels: Record<string, string> } }).metadata
    ?.labels;
  const value = labels?.[SHARE_ID_LABEL_AT_MERGE];
  if (labels === undefined || value === undefined) {
    return undefined;
  }
  delete labels[SHARE_ID_LABEL_AT_MERGE];
  labels[CHANNEL_ID_LABEL_AT_MERGE] ??= value;
  if ((storedEtagOf(schema, resource) ?? "") !== "") {
    stampEtag(schema, resource);
  }
  return toBinary(schema, resource);
}

/**
 * The re-keyed grant of one grant row (or one history entry's copy of it)
 * whose resource or principal is a share or an agent channel, under the
 * channel triple's `grt_` id; undefined when it names neither. Throws when
 * the bytes do not decode.
 */
export function rekeyedChannelGrant(data: Uint8Array): RekeyedGrant | undefined {
  return (
    rekeyedGrant(SHARE_MERGE_V36, data, GRANT_ID_PREFIX_V34) ??
    rekeyedGrant(AGENT_CHANNEL_MERGE_V36, data, GRANT_ID_PREFIX_V34)
  );
}

/**
 * The step's log: every changed slug at warn, once, as a count and a
 * capped sample (each `org/old -> new` and the row's id), and what the
 * merge dropped deliberately at info, as counts.
 */
export function logChannelMerge(
  logger: StoreLogger,
  rows: ReadonlyArray<ConvertedChannel>,
  changedSlugs: ReadonlyMap<string, string>,
): void {
  if (changedSlugs.size > 0) {
    const sample = rows
      .filter((row) => changedSlugs.has(row.id))
      .slice(0, CHANNEL_MERGE_SLUG_SAMPLE)
      .map((row) => `${row.org}/${row.slug} -> ${changedSlugs.get(row.id) ?? ""} (${row.id})`);
    logger.warn(
      "A chat link and a Slack or WhatsApp channel of one organization held the same slug; the older kept it and the other took its type as a suffix. Each keeps its id, so every link and install keeps working; rename a channel to choose another slug",
      { count: changedSlugs.size, sample },
    );
  }
  if (rows.length > 0) {
    logger.info("Merged the agent share and agent channel kinds into the channel kind", {
      channels: rows.length,
      slackProactiveFlagsDropped: rows.filter((row) => row.dropped.slackProactiveFlag).length,
      sharePinsDropped: rows.filter((row) => row.dropped.sharePin).length,
      retiredFieldsDropped: rows.filter((row) => row.dropped.retiredFields).length,
    });
  }
}

/** The conversation kinds the step relabels, with the message each decodes as, frozen. */
const SESSION_SCHEMAS: ReadonlyMap<string, DescMessage> = new Map<string, DescMessage>([
  ["session", SessionSchema],
  ["run", RunSchema],
]);

// ---------------------------------------------------------------------------
// Reading the old rows by field number.
// ---------------------------------------------------------------------------

/** The resource envelope every kind shares: api_version 1, kind 2, metadata 3, spec 4, status 5. */
interface Envelope {
  readonly apiVersion: string;
  readonly metadata?: MessageShape<typeof ApiResourceMetadataSchema>;
  readonly spec: Uint8Array;
  readonly status: Uint8Array;
}

function readEnvelope(data: Uint8Array): Envelope {
  let apiVersion = "";
  let metadata: MessageShape<typeof ApiResourceMetadataSchema> | undefined;
  let spec: Uint8Array = new Uint8Array();
  let status: Uint8Array = new Uint8Array();
  eachField(data, "the resource", (no, wireType, reader) => {
    switch (no) {
      case 1:
        apiVersion = expectString(reader, wireType, "api_version");
        return true;
      case 2:
        expectString(reader, wireType, "kind");
        return true;
      case 3:
        metadata = fromBinary(ApiResourceMetadataSchema, expectBytes(reader, wireType, "metadata"));
        return true;
      case 4:
        spec = expectBytes(reader, wireType, "spec");
        return true;
      case 5:
        status = expectBytes(reader, wireType, "status");
        return true;
      default:
        return false;
    }
  });
  return { apiVersion, metadata, spec, status };
}

/** A converted spec and status, with the type and what was dropped. */
interface ConvertedParts {
  readonly spec: MessageShape<typeof ChannelSpecSchema>;
  readonly status: MessageShape<typeof ChannelStatusSchema>;
  readonly type: MergedChannelType;
  readonly dropped: DroppedAtMerge;
}

/**
 * AgentShareSpec: agent_ref 1, enabled 2, audience 3, allowed_origins 4,
 * messages 5, environment_refs 6 (retired), run_config 7, vaults 8.
 * AgentShareStatus: share_link_token 1, agent_id 2 (dropped),
 * vault_attachers 3, audit 99.
 */
function convertShare(specBytes: Uint8Array, statusBytes: Uint8Array): ConvertedParts {
  const spec = create(ChannelSpecSchema);
  const web = create(WebChannelConfigSchema);
  let retiredFields = false;
  eachField(specBytes, "the share's spec", (no, wireType, reader) => {
    switch (no) {
      case 1:
        spec.agentRef = readReference(reader, wireType, "agent_ref");
        return true;
      case 2:
        spec.enabled = expectBool(reader, wireType, "enabled");
        return true;
      case 3:
        web.audience = expectEnum(reader, wireType, "audience") as ChannelAudience;
        return true;
      case 4:
        web.allowedOrigins.push(expectString(reader, wireType, "allowed_origins"));
        return true;
      case 5:
        web.messages = fromBinary(WebChannelMessagesSchema, expectBytes(reader, wireType, "messages"));
        return true;
      case 6:
        skipRetired(reader, wireType);
        retiredFields = true;
        return true;
      case 7:
        spec.runConfig = fromBinary(RunConfigSchema, expectBytes(reader, wireType, "run_config"));
        return true;
      case 8:
        spec.vaults.push(readReference(reader, wireType, "vaults"));
        return true;
      default:
        return false;
    }
  });
  spec.type = { case: "web", value: web };

  const status = create(ChannelStatusSchema);
  let linkToken = "";
  let sharePin = false;
  eachField(statusBytes, "the share's status", (no, wireType, reader) => {
    switch (no) {
      case 1:
        linkToken = expectString(reader, wireType, "share_link_token");
        return true;
      case 2:
        sharePin = expectString(reader, wireType, "agent_id") !== "" || sharePin;
        return true;
      case 3:
        readMapEntry(reader, wireType, "vault_attachers", status.vaultAttachers);
        return true;
      case 99:
        status.audit = readAudit(reader, wireType);
        return true;
      default:
        return false;
    }
  });
  if (linkToken !== "") {
    status.typeStatus = { case: "web", value: create(WebChannelStatusSchema, { linkToken }) };
  }
  return { spec, status, type: "web", dropped: { slackProactiveFlag: false, sharePin, retiredFields } };
}

/**
 * AgentChannelSpec: agent_ref 1, enabled 2, slack 3, environment_refs 4
 * (retired), app_ref 5, whatsapp 6, proactive_messaging_enabled 7,
 * run_config 8, vaults 9. AgentChannelStatus: install_state 1, slack 2,
 * credentials_environment_id 3 (retired), whatsapp 4, vault_attachers 5,
 * audit 99.
 */
function convertAgentChannel(specBytes: Uint8Array, statusBytes: Uint8Array): ConvertedParts {
  const spec = create(ChannelSpecSchema);
  let arm: "slack" | "whatsapp" | undefined;
  let phoneNumberId = "";
  let appRef: ApiResourceReference | undefined;
  let proactive = false;
  let retiredFields = false;
  eachField(specBytes, "the agent channel's spec", (no, wireType, reader) => {
    switch (no) {
      case 1:
        spec.agentRef = readReference(reader, wireType, "agent_ref");
        return true;
      case 2:
        spec.enabled = expectBool(reader, wireType, "enabled");
        return true;
      case 3:
        eachField(expectBytes(reader, wireType, "slack"), "the agent channel's Slack settings", () => false);
        arm = "slack";
        return true;
      case 4:
        skipRetired(reader, wireType);
        retiredFields = true;
        return true;
      case 5:
        appRef = readReference(reader, wireType, "app_ref");
        return true;
      case 6:
        arm = "whatsapp";
        eachField(expectBytes(reader, wireType, "whatsapp"), "the agent channel's WhatsApp settings", (field, fieldWire, nested) => {
          if (field !== 1) {
            return false;
          }
          phoneNumberId = expectString(nested, fieldWire, "whatsapp.phone_number_id");
          return true;
        });
        return true;
      case 7:
        proactive = expectBool(reader, wireType, "proactive_messaging_enabled");
        return true;
      case 8:
        spec.runConfig = fromBinary(RunConfigSchema, expectBytes(reader, wireType, "run_config"));
        return true;
      case 9:
        spec.vaults.push(readReference(reader, wireType, "vaults"));
        return true;
      default:
        return false;
    }
  });
  if (arm === undefined) {
    throw new Error("its spec names no provider (slack or whatsapp)");
  }
  spec.type =
    arm === "slack"
      ? { case: "slack", value: create(SlackChannelConfigSchema, { appRef }) }
      : {
          case: "whatsapp",
          value: create(WhatsAppChannelConfigSchema, {
            phoneNumberId,
            appRef,
            proactiveMessagingEnabled: proactive,
          }),
        };

  const status = create(ChannelStatusSchema);
  eachField(statusBytes, "the agent channel's status", (no, wireType, reader) => {
    switch (no) {
      case 1:
        status.installState = expectEnum(reader, wireType, "install_state") as ChannelInstallState;
        return true;
      case 2:
        status.typeStatus = {
          case: "slack",
          value: fromBinary(SlackInstallStatusSchema, expectBytes(reader, wireType, "slack")),
        };
        return true;
      case 3:
        skipRetired(reader, wireType);
        retiredFields = true;
        return true;
      case 4:
        status.typeStatus = {
          case: "whatsapp",
          value: fromBinary(WhatsAppInstallStatusSchema, expectBytes(reader, wireType, "whatsapp")),
        };
        return true;
      case 5:
        readMapEntry(reader, wireType, "vault_attachers", status.vaultAttachers);
        return true;
      case 99:
        status.audit = readAudit(reader, wireType);
        return true;
      default:
        return false;
    }
  });
  if (status.typeStatus.case !== undefined && status.typeStatus.case !== arm) {
    throw new Error(`its install status is ${status.typeStatus.case}'s, and its spec ${arm}'s`);
  }
  return {
    spec,
    status,
    type: arm,
    dropped: { slackProactiveFlag: arm === "slack" && proactive, sharePin: false, retiredFields },
  };
}

/**
 * Walks every field of `data`, handing each to `visit`, which reads it and
 * answers true, or answers false for a field number it does not know: the
 * walk then fails, naming the number and `where`.
 */
function eachField(
  data: Uint8Array,
  where: string,
  visit: (no: number, wireType: WireType, reader: BinaryReader) => boolean,
): void {
  const reader = new BinaryReader(data);
  while (reader.pos < reader.len) {
    const [no, wireType] = reader.tag();
    if (!visit(no, wireType, reader)) {
      throw new Error(`${where} holds field ${no}, which the merge does not know`);
    }
  }
}

function expectWireType(wireType: WireType, expected: WireType, field: string): void {
  if (wireType !== expected) {
    throw new Error(`its ${field} has wire type ${wireType}, not ${expected}`);
  }
}

function expectBytes(reader: BinaryReader, wireType: WireType, field: string): Uint8Array {
  expectWireType(wireType, WireType.LengthDelimited, field);
  return reader.bytes();
}

function expectString(reader: BinaryReader, wireType: WireType, field: string): string {
  expectWireType(wireType, WireType.LengthDelimited, field);
  return reader.string();
}

function expectBool(reader: BinaryReader, wireType: WireType, field: string): boolean {
  expectWireType(wireType, WireType.Varint, field);
  return reader.bool();
}

function expectEnum(reader: BinaryReader, wireType: WireType, field: string): number {
  expectWireType(wireType, WireType.Varint, field);
  return reader.int32();
}

/** Skips a retired field's bytes, whatever its wire type. */
function skipRetired(reader: BinaryReader, wireType: WireType): void {
  reader.skip(wireType);
}

function readReference(reader: BinaryReader, wireType: WireType, field: string): ApiResourceReference {
  return fromBinary(ApiResourceReferenceSchema, expectBytes(reader, wireType, field));
}

function readAudit(reader: BinaryReader, wireType: WireType): ApiResourceAudit {
  return fromBinary(ApiResourceAuditSchema, expectBytes(reader, wireType, "audit"));
}

/** One map<string, string> entry (key 1, value 2) into `into`. */
function readMapEntry(
  reader: BinaryReader,
  wireType: WireType,
  field: string,
  into: Record<string, string>,
): void {
  let key = "";
  let value = "";
  eachField(expectBytes(reader, wireType, field), `its ${field} entry`, (no, entryWire, entry) => {
    if (no === 1) {
      key = expectString(entry, entryWire, `${field} key`);
      return true;
    }
    if (no === 2) {
      value = expectString(entry, entryWire, `${field} value`);
      return true;
    }
    return false;
  });
  into[key] = value;
}

/** Whether `a` is the older of two rows: by creation time, an unknown one last, then by id. */
function isOlder(a: ConvertedChannel, b: ConvertedChannel): boolean {
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt === "") {
      return false;
    }
    if (b.createdAt === "") {
      return true;
    }
    return a.createdAt < b.createdAt;
  }
  return a.id < b.id;
}

