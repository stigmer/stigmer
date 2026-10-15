/**
 * Pins the frozen envelopes (../frozen-envelopes.ts) the two frozen data
 * migrations read the rows of retired kinds through:
 *   - the slug ledger reads the organization a retired row names, exactly
 *     as it read it through the schema the row was written with, for every
 *     retired kind it lists;
 *   - the public-visibility mover rewrites a retired row's level and leaves
 *     every other byte as the earlier release wrote it: the envelope's
 *     fields first, then spec and status verbatim, the order a whole-message
 *     encode writes them, so the step does what it did when it shipped;
 *   - a row that does not hold the public level is left untouched;
 *   - each envelope carries its retired message's own full name, one
 *     envelope per message;
 *   - the platform client envelope is what the slug ledger, the name
 *     backfill and the reference rewrite read a retired client through, and
 *     it reads the organization a retired row names;
 *   - the AgentShare and AgentChannel shapes (the two kinds merged into
 *     Channel) carry their old full names, declare in their spec exactly
 *     their reference fields, each with the `reference_kind` the reference
 *     rewrite reads, and in their status only the audit; a row decoded and
 *     re-encoded through either keeps every other field's bytes.
 */
import { create, fromBinary, getOption, toBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { BinaryReader, BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { reference_kind } from "@stigmer/protos/ai/stigmer/commons/apiresource/field_options_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditStatusSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import {
  FrozenAgentChannelSchema,
  FrozenAgentInstanceEnvelopeSchema,
  FrozenAgentShareSchema,
  FrozenArtifactEnvelopeSchema,
  FrozenPlatformClientEnvelopeSchema,
  FrozenWorkflowEnvelopeSchema,
  FrozenWorkflowExecutionEnvelopeSchema,
  FrozenWorkflowInstanceEnvelopeSchema,
} from "../frozen-envelopes.js";
import {
  ORGANIZATION_SCOPED_KINDS_AT_LEDGER,
  organizationNamedBy,
} from "../organization-slug-history.js";
import {
  PUBLIC_ROW_KINDS_AT_RETIREMENT,
  movePublicRowToOrg,
} from "../public-visibility-retired.js";
import { REFERRING_KINDS_AT_REWRITE } from "../references-by-id.js";
import { agentChannelRowBytes, MERGE_ORG, shareRowBytes } from "./channel-merge-rows.js";
import { retiredInstanceRow } from "./retired-instance-rows.js";
import { retiredPlatformClientRow } from "./retired-platform-client-rows.js";
import {
  retiredArtifactRow,
  retiredWorkflowInstanceRow,
  retiredWorkflowRow,
  retiredWorkflowRunRow,
} from "./retired-workflow-rows.js";

const workflowInstanceLedgerEntry = ORGANIZATION_SCOPED_KINDS_AT_LEDGER.find(
  (entry) => entry.kind === "workflow_instance",
);
const workflowInstanceMoverEntry = PUBLIC_ROW_KINDS_AT_RETIREMENT.find(
  (entry) => entry.kind === "workflow_instance",
);

/** A retired instance with every spec field an earlier release could write. */
function fullInstance(
  id: string,
  visibility: ApiResourceVisibility,
): Uint8Array {
  return retiredWorkflowInstanceRow({
    metadata: { id, org: "acme", slug: "nightly-shared", visibility },
    workflowId: "wfl_1",
    description: "Shared deployment",
    environmentRefs: [{ org: "acme", slug: "prod", kind: 53 }],
    executionVisibility: 2,
  });
}

describe("the frozen workflow instance envelope", () => {
  it("stays in both frozen kind tables, under the retired message's name", () => {
    expect(workflowInstanceLedgerEntry?.schema).toBe(FrozenWorkflowInstanceEnvelopeSchema);
    expect(workflowInstanceMoverEntry?.schema).toBe(FrozenWorkflowInstanceEnvelopeSchema);
    expect(FrozenWorkflowInstanceEnvelopeSchema.typeName).toBe(
      "ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance",
    );
    expect(
      FrozenWorkflowInstanceEnvelopeSchema.fields.map((f) => f.number),
    ).toEqual([1, 2, 3]);
  });

  it("lets the slug ledger read the organization a retired row names", () => {
    const row = retiredWorkflowInstanceRow({
      metadata: { id: "win_1", org: "acme", slug: "nightly-default" },
      workflowId: "wfl_1",
    });
    expect(organizationNamedBy(workflowInstanceLedgerEntry!, row)).toBe("acme");
  });

  it("moves a retired public row to org and keeps every other byte", () => {
    expect(
      movePublicRowToOrg(
        workflowInstanceMoverEntry!,
        fullInstance("win_1", ApiResourceVisibility.visibility_public),
      ),
    ).toEqual(fullInstance("win_1", ApiResourceVisibility.visibility_org));
  });

  it("leaves a retired row that holds another level untouched", () => {
    expect(
      movePublicRowToOrg(
        workflowInstanceMoverEntry!,
        fullInstance("win_1", ApiResourceVisibility.visibility_private),
      ),
    ).toBeUndefined();
  });

  it("keeps fields it does not declare in the order they were written", () => {
    // A row written with status before spec still round-trips both blobs
    // byte for byte, after the declared fields.
    const metadata = (visibility: ApiResourceVisibility) =>
      toBinary(
        ApiResourceMetadataSchema,
        create(ApiResourceMetadataSchema, {
          id: "win_2",
          org: "acme",
          visibility,
        }),
      );
    const status = toBinary(
      ApiResourceAuditStatusSchema,
      create(ApiResourceAuditStatusSchema, {}),
    );
    const spec = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string("wfl_2")
      .finish();
    const rowAt = (visibility: ApiResourceVisibility) =>
      new BinaryWriter()
        .tag(3, WireType.LengthDelimited)
        .bytes(metadata(visibility))
        .tag(5, WireType.LengthDelimited)
        .bytes(status)
        .tag(4, WireType.LengthDelimited)
        .bytes(spec)
        .finish();
    expect(
      movePublicRowToOrg(
        workflowInstanceMoverEntry!,
        rowAt(ApiResourceVisibility.visibility_public),
      ),
    ).toEqual(rowAt(ApiResourceVisibility.visibility_org));
  });
});

const agentInstanceLedgerEntry = ORGANIZATION_SCOPED_KINDS_AT_LEDGER.find(
  (entry) => entry.kind === "agent_instance",
);
const agentInstanceMoverEntry = PUBLIC_ROW_KINDS_AT_RETIREMENT.find(
  (entry) => entry.kind === "agent_instance",
);

describe("the frozen agent instance envelope", () => {
  it("stays in both frozen kind tables", () => {
    expect(agentInstanceLedgerEntry).toBeDefined();
    expect(agentInstanceMoverEntry).toBeDefined();
  });

  it("lets the slug ledger read the organization a retired row names", () => {
    const row = retiredInstanceRow({
      metadata: { id: "ain_1", org: "acme", slug: "bot-default" },
      agentId: "agt_1",
    });
    expect(organizationNamedBy(agentInstanceLedgerEntry!, row)).toBe("acme");
  });

  it("moves a retired public row to org and keeps every other byte", () => {
    const row = retiredInstanceRow({
      metadata: {
        id: "ain_1",
        org: "acme",
        slug: "bot-shared",
        visibility: ApiResourceVisibility.visibility_public,
      },
      agentId: "agt_1",
      description: "Shared deployment",
    });
    const expected = retiredInstanceRow({
      metadata: {
        id: "ain_1",
        org: "acme",
        slug: "bot-shared",
        visibility: ApiResourceVisibility.visibility_org,
      },
      agentId: "agt_1",
      description: "Shared deployment",
    });
    expect(movePublicRowToOrg(agentInstanceMoverEntry!, row)).toEqual(expected);
  });

  it("leaves a retired row that holds another level untouched", () => {
    const row = retiredInstanceRow({
      metadata: {
        id: "ain_1",
        org: "acme",
        slug: "bot-private",
        visibility: ApiResourceVisibility.visibility_private,
      },
      agentId: "agt_1",
    });
    expect(movePublicRowToOrg(agentInstanceMoverEntry!, row)).toBeUndefined();
  });

  it("keeps fields it does not declare in the order they were written", () => {
    // A row written with status before spec still round-trips both blobs
    // byte for byte, after the declared fields.
    const metadata = toBinary(
      ApiResourceMetadataSchema,
      create(ApiResourceMetadataSchema, {
        id: "ain_2",
        org: "acme",
        visibility: ApiResourceVisibility.visibility_public,
      }),
    );
    const status = toBinary(
      ApiResourceAuditStatusSchema,
      create(ApiResourceAuditStatusSchema, {}),
    );
    const spec = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string("agt_2")
      .finish();
    const row = new BinaryWriter()
      .tag(3, WireType.LengthDelimited)
      .bytes(metadata)
      .tag(5, WireType.LengthDelimited)
      .bytes(status)
      .tag(4, WireType.LengthDelimited)
      .bytes(spec)
      .finish();
    const moved = movePublicRowToOrg(agentInstanceMoverEntry!, row);
    const movedMetadata = toBinary(
      ApiResourceMetadataSchema,
      create(ApiResourceMetadataSchema, {
        id: "ain_2",
        org: "acme",
        visibility: ApiResourceVisibility.visibility_org,
      }),
    );
    expect(moved).toEqual(
      new BinaryWriter()
        .tag(3, WireType.LengthDelimited)
        .bytes(movedMetadata)
        .tag(5, WireType.LengthDelimited)
        .bytes(status)
        .tag(4, WireType.LengthDelimited)
        .bytes(spec)
        .finish(),
    );
  });
});


describe("the frozen workflow, workflow run and artifact envelopes", () => {
  const ledgerOf = (kind: string) =>
    ORGANIZATION_SCOPED_KINDS_AT_LEDGER.find((entry) => entry.kind === kind);
  const moverOf = (kind: string) =>
    PUBLIC_ROW_KINDS_AT_RETIREMENT.find((entry) => entry.kind === kind);
  const metadata = (id: string, visibility = ApiResourceVisibility.api_resource_visibility_unspecified) => ({
    id,
    org: "acme",
    slug: id,
    visibility,
  });

  it("stay in the frozen kind tables that list their kinds, under the retired messages' names", () => {
    expect(ledgerOf("workflow")?.schema).toBe(FrozenWorkflowEnvelopeSchema);
    expect(moverOf("workflow")?.schema).toBe(FrozenWorkflowEnvelopeSchema);
    expect(ledgerOf("workflow_execution")?.schema).toBe(
      FrozenWorkflowExecutionEnvelopeSchema,
    );
    expect(ledgerOf("artifact")?.schema).toBe(FrozenArtifactEnvelopeSchema);
    expect(
      [
        FrozenAgentInstanceEnvelopeSchema,
        FrozenWorkflowInstanceEnvelopeSchema,
        FrozenWorkflowEnvelopeSchema,
        FrozenWorkflowExecutionEnvelopeSchema,
        FrozenArtifactEnvelopeSchema,
      ].map((schema) => [schema.typeName, schema.fields.map((f) => f.number)]),
    ).toEqual([
      ["ai.stigmer.agentic.agentinstance.v1.AgentInstance", [1, 2, 3]],
      ["ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance", [1, 2, 3]],
      ["ai.stigmer.agentic.workflow.v1.Workflow", [1, 2, 3]],
      ["ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution", [1, 2, 3]],
      ["ai.stigmer.agentic.artifact.v1.Artifact", [1, 2, 3]],
    ]);
  });

  it.each([
    {
      kind: "workflow",
      row: retiredWorkflowRow({ metadata: metadata("wfl_1"), versionHash: "a".repeat(64) }),
    },
    {
      kind: "workflow_execution",
      row: retiredWorkflowRunRow({
        metadata: metadata("wex_1"),
        kindString: "WorkflowExecution",
        workflowId: "wfl_1",
      }),
    },
    {
      kind: "artifact",
      row: retiredArtifactRow({
        metadata: metadata("art_1"),
        source: { workflowRunId: "wex_1", taskName: "triage" },
      }),
    },
  ])("lets the slug ledger read the organization a retired $kind row names", ({ kind, row }) => {
    expect(organizationNamedBy(ledgerOf(kind)!, row)).toBe("acme");
  });

  it("moves a retired public workflow row to org and keeps every other byte", () => {
    const at = (visibility: ApiResourceVisibility) =>
      retiredWorkflowRow({
        metadata: metadata("wfl_1", visibility),
        versionHash: "a".repeat(64),
        defaultInstanceId: "win_1",
      });
    expect(
      movePublicRowToOrg(moverOf("workflow")!, at(ApiResourceVisibility.visibility_public)),
    ).toEqual(at(ApiResourceVisibility.visibility_org));
    expect(
      movePublicRowToOrg(moverOf("workflow")!, at(ApiResourceVisibility.visibility_private)),
    ).toBeUndefined();
  });
});

describe("the frozen platform client envelope", () => {
  const ledgerEntry = ORGANIZATION_SCOPED_KINDS_AT_LEDGER.find(
    (entry) => entry.kind === "platform_client",
  );

  it("is what the slug ledger and the reference rewrite read a retired client through, under the retired message's name", () => {
    expect(ledgerEntry?.schema).toBe(FrozenPlatformClientEnvelopeSchema);
    expect(
      REFERRING_KINDS_AT_REWRITE.find((entry) => entry.kind === "platform_client")?.schema,
    ).toBe(FrozenPlatformClientEnvelopeSchema);
    expect(FrozenPlatformClientEnvelopeSchema.typeName).toBe(
      "ai.stigmer.iam.platformclient.v1.PlatformClient",
    );
  });

  it("lets the slug ledger read the organization a retired row names", () => {
    const row = retiredPlatformClientRow({
      metadata: { id: "pcl_1", org: "acme", slug: "dashboard" },
      clientId: "stgm_cid_1",
      vaults: [{ kind: ApiResourceKind.vault, org: "acme", slug: "product-keys" }],
    });
    expect(organizationNamedBy(ledgerEntry!, row)).toBe("acme");
  });
});

/** One field of an encoded message: its number and its bytes, tag included. */
interface WireField {
  readonly no: number;
  readonly raw: Uint8Array;
}

/**
 * Every field of `data`, ordered by number and, within one number, as
 * written: a re-encode writes declared fields first and unknown ones
 * after, so two encodings holding the same fields compare equal here.
 */
function wireFields(data: Uint8Array): WireField[] {
  const reader = new BinaryReader(data);
  const fields: WireField[] = [];
  while (reader.pos < reader.len) {
    const start = reader.pos;
    const [no, wireType] = reader.tag();
    reader.skip(wireType);
    fields.push({ no, raw: data.subarray(start, reader.pos) });
  }
  return fields.map((field, index) => ({ field, index }))
    .sort((a, b) => a.field.no - b.field.no || a.index - b.index)
    .map(({ field }) => field);
}

/** The payload of `data`'s length-delimited field `no`, or empty when it holds none. */
function payloadOf(data: Uint8Array, no: number): Uint8Array {
  const reader = new BinaryReader(data);
  while (reader.pos < reader.len) {
    const [field, wireType] = reader.tag();
    if (field === no && wireType === WireType.LengthDelimited) {
      return reader.bytes();
    }
    reader.skip(wireType);
  }
  return new Uint8Array();
}

/** A frozen shape's nested message by its field name in the envelope. */
function nestedOf(schema: DescMessage, name: "spec" | "status"): DescMessage {
  const field = schema.fields.find((candidate) => candidate.name === name);
  if (field?.fieldKind !== "message") {
    throw new Error(`${schema.typeName} declares no ${name} message`);
  }
  return field.message;
}

describe("the frozen AgentShare and AgentChannel shapes", () => {
  const reference = (slug: string) => ({ org: MERGE_ORG, slug });

  it.each([
    {
      schema: FrozenAgentShareSchema,
      typeName: "ai.stigmer.agentic.agentshare.v1.AgentShare",
      references: [
        { name: "agent_ref", number: 1, kind: ApiResourceKind.agent, repeated: false },
        { name: "vaults", number: 8, kind: ApiResourceKind.vault, repeated: true },
      ],
    },
    {
      schema: FrozenAgentChannelSchema,
      typeName: "ai.stigmer.agentic.agentchannel.v1.AgentChannel",
      references: [
        { name: "agent_ref", number: 1, kind: ApiResourceKind.agent, repeated: false },
        { name: "app_ref", number: 5, kind: ApiResourceKind.channel_app, repeated: false },
        { name: "vaults", number: 9, kind: ApiResourceKind.vault, repeated: true },
      ],
    },
  ])("$typeName carries its old full name, its reference fields and only its audit", ({ schema, typeName, references }) => {
    expect(schema.typeName).toBe(typeName);
    expect(schema.fields.map((f) => [f.name, f.number])).toEqual([
      ["api_version", 1],
      ["kind", 2],
      ["metadata", 3],
      ["spec", 4],
      ["status", 5],
    ]);
    const spec = nestedOf(schema, "spec");
    expect(
      spec.fields.map((f) => ({
        name: f.name,
        number: f.number,
        kind: getOption(f, reference_kind),
        repeated: f.fieldKind === "list",
      })),
    ).toEqual(references);
    for (const field of spec.fields) {
      expect(field.message?.typeName, field.name).toBe("ai.stigmer.commons.apiresource.ApiResourceReference");
    }
    const status = nestedOf(schema, "status");
    expect(status.fields.map((f) => [f.name, f.number, f.message?.typeName])).toEqual([
      ["audit", 99, "ai.stigmer.commons.apiresource.ApiResourceAudit"],
    ]);
  });

  it.each([
    {
      kind: "agent share",
      schema: FrozenAgentShareSchema,
      row: shareRowBytes({
        id: "ash_1",
        slug: "support",
        labels: { team: "support" },
        createdAt: new Date("2026-01-02T03:04:05Z"),
        agentRef: reference("helper"),
        enabled: true,
        vaults: [reference("keys"), reference("more-keys")],
        runConfig: { modelName: "claude-sonnet", maxCostUsd: 2 },
        vaultAttachers: { vlt_1: "ida_1" },
        retiredFieldBytes: true,
        audience: 1,
        allowedOrigins: ["https://example.com", "https://docs.example.com"],
        messages: { rateLimited: "Slow down", unavailable: "Back soon" },
        linkToken: "tok_1",
        agentPin: "agt_1",
      }),
    },
    {
      kind: "agent channel",
      schema: FrozenAgentChannelSchema,
      row: agentChannelRowBytes({
        id: "ach_1",
        slug: "support",
        createdAt: new Date("2026-01-02T03:04:05Z"),
        agentRef: reference("helper"),
        enabled: true,
        vaults: [reference("keys")],
        runConfig: { modelName: "claude-sonnet" },
        vaultAttachers: { vlt_1: "ida_1" },
        retiredFieldBytes: true,
        provider: "whatsapp",
        phoneNumberId: "15550001",
        appRef: reference("meta-app"),
        proactive: true,
        installState: 2,
        whatsappInstall: { phoneNumberId: "15550001", displayPhoneNumber: "+1 555 0001" },
      }),
    },
  ])("keeps every other field's bytes of an $kind row it decodes and re-encodes", ({ schema, row }) => {
    const reencoded = toBinary(schema, fromBinary(schema, row));
    const envelope = (data: Uint8Array) => wireFields(data).filter((f) => f.no !== 4 && f.no !== 5);
    expect(envelope(reencoded)).toEqual(envelope(row));
    expect(wireFields(payloadOf(reencoded, 4))).toEqual(wireFields(payloadOf(row, 4)));
    expect(wireFields(payloadOf(reencoded, 5))).toEqual(wireFields(payloadOf(row, 5)));
    expect(wireFields(payloadOf(row, 4)).length).toBeGreaterThan(3);
    expect(wireFields(payloadOf(row, 5)).length).toBeGreaterThan(2);
  });
});
