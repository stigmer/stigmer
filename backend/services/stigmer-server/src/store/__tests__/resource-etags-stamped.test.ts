/**
 * Pins resource-etags-stamped.ts: what one stored resource becomes when
 * resources gain an etag.
 *
 *   - the table names the message of every kind that stores a resource,
 *     each the kind's own (its group, name and version), so a kind added
 *     to the enum without an entry fails here;
 *   - an unstamped row, and one carrying a stale etag, gain the etag its
 *     content gives, every other field and unknown field kept;
 *   - a row already carrying its etag, and a row of a kind with no entry,
 *     are left alone (undefined);
 *   - bytes that do not decode throw; the step's one line per kind names
 *     the count and the first ids.
 */
import { create, fromBinary, getOption, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  ApiResourceKind,
  ApiResourceKindSchema,
  kind_meta,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceGroup } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_group_pb";

import { etagOf } from "../etag.js";
import {
  ETAG_STAMPED_KIND_NAMES,
  RESOURCE_SCHEMAS,
  stampEtagRow,
  UNREADABLE_ETAG_ROW_SAMPLE,
  logUnreadableEtagRows,
} from "../resource-etags-stamped.js";

/** The kinds that name no stored resource message: the audit record and the platform singleton. */
const NO_RESOURCE_MESSAGE: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.api_resource_version,
  ApiResourceKind.platform,
]);

const reviewer = () =>
  create(AgentSchema, {
    metadata: { id: "agt_1", org: "org_1", slug: "reviewer", name: "Reviewer", labels: { team: "core" } },
    spec: { instructions: "Review every pull request." },
  });

describe("RESOURCE_SCHEMAS", () => {
  it("names the message of every kind that stores a resource, each the kind's own", () => {
    for (const value of ApiResourceKindSchema.values) {
      const kind = value.number as ApiResourceKind;
      if (kind === ApiResourceKind.api_resource_kind_unknown || NO_RESOURCE_MESSAGE.has(kind)) {
        expect(RESOURCE_SCHEMAS.has(kind), value.name).toBe(false);
        continue;
      }
      const meta = getOption(value, kind_meta);
      const group = ApiResourceGroup[meta.group];
      expect(RESOURCE_SCHEMAS.get(kind)?.typeName, value.name).toBe(
        `ai.stigmer.${group}.${meta.name.toLowerCase()}.v1.${meta.name}`,
      );
    }
    expect(ETAG_STAMPED_KIND_NAMES).toContain("agent");
    expect(ETAG_STAMPED_KIND_NAMES).toHaveLength(RESOURCE_SCHEMAS.size);
  });
});

describe("stampEtagRow", () => {
  it("stamps an unstamped row with the etag its content gives, and keeps every other field", () => {
    const stamped = stampEtagRow("agent", toBinary(AgentSchema, reviewer()));
    const decoded = fromBinary(AgentSchema, stamped!);
    expect(decoded.metadata?.etag).toBe(etagOf(AgentSchema, reviewer()));
    decoded.metadata!.etag = "";
    expect(toBinary(AgentSchema, decoded)).toEqual(toBinary(AgentSchema, reviewer()));
  });

  it("restamps a stale etag, and leaves a row carrying its own alone", () => {
    const stale = reviewer();
    stale.metadata!.etag = "stale";
    const restamped = stampEtagRow("agent", toBinary(AgentSchema, stale));
    expect(fromBinary(AgentSchema, restamped!).metadata?.etag).toBe(etagOf(AgentSchema, reviewer()));
    expect(stampEtagRow("agent", restamped!)).toBeUndefined();
  });

  it("keeps a field no release defined", () => {
    const w = new BinaryWriter();
    w.raw(toBinary(AgentSchema, reviewer()));
    w.tag(900, WireType.LengthDelimited).string("kept");
    const stamped = stampEtagRow("agent", w.finish());
    expect((fromBinary(AgentSchema, stamped!).$unknown ?? []).map((field) => field.no)).toEqual([900]);
  });

  it("leaves a row of a kind with no entry, and one with no metadata, alone", () => {
    expect(stampEtagRow("workflow", toBinary(AgentSchema, reviewer()))).toBeUndefined();
    expect(stampEtagRow("agent", toBinary(AgentSchema, create(AgentSchema)))).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() => stampEtagRow("agent", new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
  });
});

describe("logUnreadableEtagRows", () => {
  it("logs one line per kind with the count and the first ids, and nothing for none", () => {
    const warned: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    const logger = {
      debug() {},
      info() {},
      warn(message: string, fields?: Record<string, unknown>) {
        warned.push({ message, fields });
      },
    };
    const ids = Array.from({ length: UNREADABLE_ETAG_ROW_SAMPLE + 5 }, (_, i) => `agt_${i}`);
    logUnreadableEtagRows(logger, "agent", ids);
    logUnreadableEtagRows(logger, "skill", []);
    expect(warned).toEqual([
      {
        message: "rows that do not decode were left without an etag",
        fields: { kind: "agent", count: ids.length, ids: ids.slice(0, UNREADABLE_ETAG_ROW_SAMPLE) },
      },
    ]);
  });
});
