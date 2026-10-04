/**
 * Pins the frozen envelope (../frozen-agent-instance.ts) the two frozen
 * data migrations read retired agent instance rows through:
 *   - the slug ledger reads the organization a retired row names, exactly
 *     as it read it through the schema the row was written with;
 *   - the public-visibility mover rewrites a retired row's level and leaves
 *     every other byte as the earlier release wrote it: the envelope's
 *     fields first, then spec and status verbatim, the order a whole-message
 *     encode writes them, so the step does what it did when it shipped;
 *   - a row that does not hold the public level is left untouched.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditStatusSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import {
  ORGANIZATION_SCOPED_KINDS_AT_LEDGER,
  organizationNamedBy,
} from "../organization-slug-history.js";
import {
  PUBLIC_ROW_KINDS_AT_RETIREMENT,
  movePublicRowToOrg,
} from "../public-visibility-retired.js";
import { retiredInstanceRow } from "./retired-instance-rows.js";

const ledgerEntry = ORGANIZATION_SCOPED_KINDS_AT_LEDGER.find(
  (entry) => entry.kind === "agent_instance",
);
const moverEntry = PUBLIC_ROW_KINDS_AT_RETIREMENT.find(
  (entry) => entry.kind === "agent_instance",
);

describe("the frozen agent instance envelope", () => {
  it("stays in both frozen kind tables", () => {
    expect(ledgerEntry).toBeDefined();
    expect(moverEntry).toBeDefined();
  });

  it("lets the slug ledger read the organization a retired row names", () => {
    const row = retiredInstanceRow({
      metadata: { id: "ain_1", org: "acme", slug: "bot-default" },
      agentId: "agt_1",
    });
    expect(organizationNamedBy(ledgerEntry!, row)).toBe("acme");
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
    expect(movePublicRowToOrg(moverEntry!, row)).toEqual(expected);
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
    expect(movePublicRowToOrg(moverEntry!, row)).toBeUndefined();
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
    const moved = movePublicRowToOrg(moverEntry!, row);
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
