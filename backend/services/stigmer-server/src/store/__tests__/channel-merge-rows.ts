/**
 * Share and agent channel rows as the releases before the merge wrote them
 * (Postgres v37, SQLite v41), for the driver-neutral test of
 * ../channel-kinds-merged.ts and both drivers' migration arms. The two
 * kinds' generated messages are gone, so each row is encoded by field
 * number, exactly as AgentShare and AgentChannel laid their fields out,
 * with the live messages that keep their numbers for what nests
 * (metadata, references, run settings, install facts, audit).
 */
import { create, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { BinaryWriter } from "@bufbuild/protobuf/wire";

import { WebChannelMessagesSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import {
  SlackInstallStatusSchema,
  WhatsAppInstallStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/status_pb";
import { RunConfigSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";

export const MERGE_ORG = "org_01jz0000000000000000000000";

type Reference = MessageInitShape<typeof ApiResourceReferenceSchema>;

/** What every stored row of either kind carries. */
export interface MergedRowBase {
  readonly id: string;
  readonly slug: string;
  readonly name?: string;
  readonly org?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly createdAt?: Date;
  readonly agentRef?: Reference;
  readonly enabled?: boolean;
  readonly vaults?: ReadonlyArray<Reference>;
  readonly runConfig?: MessageInitShape<typeof RunConfigSchema>;
  readonly vaultAttachers?: Readonly<Record<string, string>>;
  /** Bytes the row still carries for a field the contract had retired. */
  readonly retiredFieldBytes?: boolean;
  /** A field number no release declared, to prove the step refuses it. */
  readonly unknownSpecField?: number;
}

/** A share's own fields. */
export interface ShareRow extends MergedRowBase {
  readonly audience?: number;
  readonly allowedOrigins?: ReadonlyArray<string>;
  readonly messages?: MessageInitShape<typeof WebChannelMessagesSchema>;
  readonly linkToken?: string;
  readonly agentPin?: string;
}

/** An agent channel's own fields. */
export interface AgentChannelRow extends MergedRowBase {
  readonly provider: "slack" | "whatsapp";
  readonly phoneNumberId?: string;
  readonly appRef?: Reference;
  readonly proactive?: boolean;
  readonly installState?: number;
  readonly slackInstall?: MessageInitShape<typeof SlackInstallStatusSchema>;
  readonly whatsappInstall?: MessageInitShape<typeof WhatsAppInstallStatusSchema>;
}

/** A stored AgentShare row: AgentShareSpec and AgentShareStatus by their numbers. */
export function shareRowBytes(row: ShareRow): Uint8Array {
  const spec = new BinaryWriter();
  writeCommonSpecHead(spec, row);
  if (row.audience !== undefined) spec.tag(3, 0).int32(row.audience);
  for (const origin of row.allowedOrigins ?? []) spec.tag(4, 2).string(origin);
  if (row.messages !== undefined) {
    spec.tag(5, 2).bytes(toBinary(WebChannelMessagesSchema, create(WebChannelMessagesSchema, row.messages)));
  }
  if (row.retiredFieldBytes === true) {
    spec.tag(6, 2).bytes(toBinary(ApiResourceReferenceSchema, create(ApiResourceReferenceSchema, { org: MERGE_ORG, slug: "old-env" })));
  }
  if (row.runConfig !== undefined) spec.tag(7, 2).bytes(toBinary(RunConfigSchema, create(RunConfigSchema, row.runConfig)));
  for (const vault of row.vaults ?? []) spec.tag(8, 2).bytes(reference(vault));
  if (row.unknownSpecField !== undefined) spec.tag(row.unknownSpecField, 0).int32(1);

  const status = new BinaryWriter();
  if (row.linkToken !== undefined) status.tag(1, 2).string(row.linkToken);
  if (row.agentPin !== undefined) status.tag(2, 2).string(row.agentPin);
  writeAttachers(status, 3, row.vaultAttachers);
  writeAudit(status, row.createdAt);
  return envelope("AgentShare", row, spec.finish(), status.finish());
}

/** A stored AgentChannel row: AgentChannelSpec and AgentChannelStatus by their numbers. */
export function agentChannelRowBytes(row: AgentChannelRow): Uint8Array {
  const spec = new BinaryWriter();
  writeCommonSpecHead(spec, row);
  if (row.provider === "slack") spec.tag(3, 2).bytes(new Uint8Array());
  if (row.retiredFieldBytes === true) {
    spec.tag(4, 2).bytes(toBinary(ApiResourceReferenceSchema, create(ApiResourceReferenceSchema, { org: MERGE_ORG, slug: "old-env" })));
  }
  if (row.appRef !== undefined) spec.tag(5, 2).bytes(reference(row.appRef));
  if (row.provider === "whatsapp") {
    const whatsapp = new BinaryWriter();
    if (row.phoneNumberId !== undefined) whatsapp.tag(1, 2).string(row.phoneNumberId);
    spec.tag(6, 2).bytes(whatsapp.finish());
  }
  if (row.proactive === true) spec.tag(7, 0).bool(true);
  if (row.runConfig !== undefined) spec.tag(8, 2).bytes(toBinary(RunConfigSchema, create(RunConfigSchema, row.runConfig)));
  for (const vault of row.vaults ?? []) spec.tag(9, 2).bytes(reference(vault));
  if (row.unknownSpecField !== undefined) spec.tag(row.unknownSpecField, 0).int32(1);

  const status = new BinaryWriter();
  if (row.installState !== undefined) status.tag(1, 0).int32(row.installState);
  if (row.slackInstall !== undefined) {
    status.tag(2, 2).bytes(toBinary(SlackInstallStatusSchema, create(SlackInstallStatusSchema, row.slackInstall)));
  }
  if (row.retiredFieldBytes === true) status.tag(3, 2).string("env_old_credentials");
  if (row.whatsappInstall !== undefined) {
    status.tag(4, 2).bytes(toBinary(WhatsAppInstallStatusSchema, create(WhatsAppInstallStatusSchema, row.whatsappInstall)));
  }
  writeAttachers(status, 5, row.vaultAttachers);
  writeAudit(status, row.createdAt);
  return envelope("AgentChannel", row, spec.finish(), status.finish());
}

function writeCommonSpecHead(spec: BinaryWriter, row: MergedRowBase): void {
  if (row.agentRef !== undefined) spec.tag(1, 2).bytes(reference(row.agentRef));
  if (row.enabled === true) spec.tag(2, 0).bool(true);
}

function reference(ref: Reference): Uint8Array {
  return toBinary(ApiResourceReferenceSchema, create(ApiResourceReferenceSchema, ref));
}

function writeAttachers(status: BinaryWriter, field: number, attachers: Readonly<Record<string, string>> | undefined): void {
  for (const [key, value] of Object.entries(attachers ?? {})) {
    const entry = new BinaryWriter();
    entry.tag(1, 2).string(key);
    entry.tag(2, 2).string(value);
    status.tag(field, 2).bytes(entry.finish());
  }
}

function writeAudit(status: BinaryWriter, createdAt: Date | undefined): void {
  if (createdAt === undefined) return;
  const audit = create(ApiResourceAuditSchema, { specAudit: { createdAt: timestampFromDate(createdAt) } });
  status.tag(99, 2).bytes(toBinary(ApiResourceAuditSchema, audit));
}

function envelope(kindString: string, row: MergedRowBase, spec: Uint8Array, status: Uint8Array): Uint8Array {
  const writer = new BinaryWriter();
  writer.tag(1, 2).string("agentic.stigmer.ai/v1");
  writer.tag(2, 2).string(kindString);
  const metadata = create(ApiResourceMetadataSchema, {
    id: row.id,
    org: row.org ?? MERGE_ORG,
    slug: row.slug,
    name: row.name ?? row.slug,
    labels: { ...(row.labels ?? {}) },
  });
  writer.tag(3, 2).bytes(toBinary(ApiResourceMetadataSchema, metadata));
  writer.tag(4, 2).bytes(spec);
  writer.tag(5, 2).bytes(status);
  return writer.finish();
}
