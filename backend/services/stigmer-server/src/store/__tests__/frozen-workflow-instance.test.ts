/**
 * Pins the frozen envelope (../frozen-workflow-instance.ts) the two frozen
 * data migrations read retired workflow instance rows through:
 *   - the slug ledger reads the organization a retired row names, exactly
 *     as it read it through the schema the row was written with;
 *   - the public-visibility mover rewrites a retired row's level and leaves
 *     every other byte as the earlier release wrote it: the envelope's
 *     fields first, then spec and status verbatim, the order a whole-message
 *     encode writes them, so the step does what it did when it shipped;
 *   - a row that does not hold the public level is left untouched;
 *   - the envelope carries the retired message's own full name, apart from
 *     the agent instance envelope.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditStatusSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import { FrozenWorkflowInstanceEnvelopeSchema } from "../frozen-workflow-instance.js";
import {
  ORGANIZATION_SCOPED_KINDS_AT_LEDGER,
  organizationNamedBy,
} from "../organization-slug-history.js";
import {
  PUBLIC_ROW_KINDS_AT_RETIREMENT,
  movePublicRowToOrg,
} from "../public-visibility-retired.js";
import { retiredWorkflowInstanceRow } from "./retired-workflow-instance-rows.js";

const ledgerEntry = ORGANIZATION_SCOPED_KINDS_AT_LEDGER.find(
  (entry) => entry.kind === "workflow_instance",
);
const moverEntry = PUBLIC_ROW_KINDS_AT_RETIREMENT.find(
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
    expect(ledgerEntry?.schema).toBe(FrozenWorkflowInstanceEnvelopeSchema);
    expect(moverEntry?.schema).toBe(FrozenWorkflowInstanceEnvelopeSchema);
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
    expect(organizationNamedBy(ledgerEntry!, row)).toBe("acme");
  });

  it("moves a retired public row to org and keeps every other byte", () => {
    expect(
      movePublicRowToOrg(
        moverEntry!,
        fullInstance("win_1", ApiResourceVisibility.visibility_public),
      ),
    ).toEqual(fullInstance("win_1", ApiResourceVisibility.visibility_org));
  });

  it("leaves a retired row that holds another level untouched", () => {
    expect(
      movePublicRowToOrg(
        moverEntry!,
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
        moverEntry!,
        rowAt(ApiResourceVisibility.visibility_public),
      ),
    ).toEqual(rowAt(ApiResourceVisibility.visibility_org));
  });
});
