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
 *   - the retired Environment kind stays in the slug ledger's table under
 *     its envelope, which reads the organization a stored environment row
 *     names (the v22 / v17 step that removes those rows runs after the
 *     ledger).
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditStatusSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import {
  FrozenAgentInstanceEnvelopeSchema,
  FrozenArtifactEnvelopeSchema,
  FrozenEnvironmentEnvelopeSchema,
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
import { retiredInstanceRow } from "./retired-instance-rows.js";
import {
  retiredArtifactRow,
  retiredWorkflowInstanceRow,
  retiredWorkflowRow,
  retiredWorkflowRunRow,
} from "./retired-workflow-rows.js";

/**
 * The wire number the retired Environment kind held in ApiResourceKind; an
 * earlier release wrote it into a workflow instance's environment refs.
 */
const RETIRED_ENVIRONMENT_KIND_NUMBER = 53 as ApiResourceKind;

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
    environmentRefs: [
      { org: "acme", slug: "prod", kind: RETIRED_ENVIRONMENT_KIND_NUMBER },
    ],
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

describe("the frozen environment envelope", () => {
  const ledgerEntry = ORGANIZATION_SCOPED_KINDS_AT_LEDGER.find(
    (entry) => entry.kind === "environment",
  );

  /** An Environment row as an earlier release stored it: api_version 1, kind 2, metadata 3, spec 4 { data 1 }. */
  function retiredEnvironmentRow(org: string): Uint8Array {
    const value = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string("enc:v1:sealed")
      .tag(2, WireType.Varint)
      .bool(true)
      .finish();
    const entry = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string("TOKEN")
      .tag(2, WireType.LengthDelimited)
      .bytes(value)
      .finish();
    const spec = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .bytes(entry)
      .finish();
    return new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string("agentic.stigmer.ai/v1")
      .tag(2, WireType.LengthDelimited)
      .string("Environment")
      .tag(3, WireType.LengthDelimited)
      .bytes(
        toBinary(
          ApiResourceMetadataSchema,
          create(ApiResourceMetadataSchema, { id: "env_1", org, slug: "prod" }),
        ),
      )
      .tag(4, WireType.LengthDelimited)
      .bytes(spec)
      .finish();
  }

  it("stays in the slug ledger's kind table under the retired message's name", () => {
    expect(ledgerEntry?.schema).toBe(FrozenEnvironmentEnvelopeSchema);
    expect(FrozenEnvironmentEnvelopeSchema.typeName).toBe(
      "ai.stigmer.agentic.environment.v1.Environment",
    );
    expect(FrozenEnvironmentEnvelopeSchema.fields.map((f) => f.number)).toEqual([
      1, 2, 3,
    ]);
  });

  it("lets the slug ledger read the organization a retired row names", () => {
    expect(organizationNamedBy(ledgerEntry!, retiredEnvironmentRow("acme"))).toBe(
      "acme",
    );
  });
});
