/**
 * Pins label-tag-report.ts, what the report migration finds in one stored
 * row and how a kind's warning reads:
 *
 *   - a row whose labels and tags the contract admits holds nothing;
 *   - a bad label key, a bad label value, more than 64 pairs, a bad tag, a
 *     repeated tag and more than 20 tags are each found, by the same
 *     protovalidate rules a write is refused by;
 *   - stored annotations are found as the unknown field 7 they ride as;
 *   - a kind with no entry is not read, and bytes that do not decode throw;
 *   - a kind's tally logs one warning with its counts and at most ten ids,
 *     and none when no row held anything.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";

import {
  LABEL_TAG_REPORT_SAMPLE,
  LabelTagTally,
  labelTagFindings,
} from "../label-tag-report.js";

function agent(metadata: { labels?: Record<string, string>; tags?: string[] } = {}): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: "org_1", slug: "reviewer", name: "Reviewer", ...metadata },
    spec: { instructions: "Review every pull request." },
  });
}

function bytes(resource: Agent): Uint8Array {
  return toBinary(AgentSchema, resource);
}

/** An agent's bytes whose metadata also carries field 7, as a row written before annotations were removed. */
function withStoredAnnotations(resource: Agent): Uint8Array {
  const metadata = resource.metadata!;
  const entry = new BinaryWriter().tag(1, WireType.LengthDelimited).string("note").tag(2, WireType.LengthDelimited).string("kept").finish();
  metadata.$unknown = [{ no: 7, wireType: WireType.LengthDelimited, data: new BinaryWriter().bytes(entry).finish() }];
  return toBinary(AgentSchema, resource);
}

const NOTHING = { labels: false, tags: false, annotations: false };

describe("labelTagFindings", () => {
  it("finds nothing in a row whose labels and tags the contract admits", () => {
    const clean = agent({
      labels: { team: "support", "stigmer.ai/schedule-id": "sch_01", "example.com/tier": "", app: "a.b_c-d" },
      tags: ["prod", "a-b-testing"],
    });
    expect(labelTagFindings("agent", bytes(clean))).toEqual(NOTHING);
  });

  it("finds each label the rules refuse", () => {
    const refused: Array<Record<string, string>> = [
      { "-team": "support" },
      { "team/": "support" },
      { "Example.com/team": "support" },
      { [`${"a".repeat(254)}/team`]: "support" },
      { [`${"t".repeat(64)}`]: "support" },
      { team: "-support" },
      { team: "support team" },
      { team: "x".repeat(64) },
      Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`key${i}`, "v"])),
    ];
    for (const labels of refused) {
      expect(labelTagFindings("agent", bytes(agent({ labels }))), JSON.stringify(labels).slice(0, 80)).toEqual({
        ...NOTHING,
        labels: true,
      });
    }
  });

  it("finds each tag list the rules refuse", () => {
    const refused: string[][] = [
      ["Prod"],
      ["sec filings"],
      ["-prod"],
      ["x".repeat(51)],
      ["prod", "prod"],
      Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    ];
    for (const tags of refused) {
      expect(labelTagFindings("agent", bytes(agent({ tags }))), tags.join(",").slice(0, 80)).toEqual({
        ...NOTHING,
        tags: true,
      });
    }
  });

  it("finds stored annotations as the unknown field they ride as", () => {
    expect(labelTagFindings("agent", withStoredAnnotations(agent()))).toEqual({ ...NOTHING, annotations: true });
  });

  it("reads no row of a kind with no entry, and throws on bytes that do not decode", () => {
    expect(labelTagFindings("retired_kind", new Uint8Array([0x0a, 0x01, 0x61]))).toBeUndefined();
    expect(() => labelTagFindings("agent", new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
  });
});

describe("LabelTagTally", () => {
  function recording() {
    const lines: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    return {
      lines,
      logger: {
        debug() {},
        info() {},
        warn(message: string, fields?: Record<string, unknown>) {
          lines.push({ message, fields });
        },
      },
    };
  }

  it("logs one warning per kind with its counts and at most ten ids", () => {
    const tally = new LabelTagTally("agent");
    tally.add("agt_clean", bytes(agent({ labels: { team: "support" } })));
    tally.add("agt_label", bytes(agent({ labels: { "-team": "x" } })));
    tally.add("agt_both", bytes(agent({ labels: { "-team": "x" }, tags: ["Prod"] })));
    tally.add("agt_note", withStoredAnnotations(agent()));
    tally.add("agt_bad", new Uint8Array([0xff, 0xff, 0xff]));
    for (let i = 0; i < LABEL_TAG_REPORT_SAMPLE; i++) {
      tally.add(`agt_tag_${i}`, bytes(agent({ tags: ["Prod"] })));
    }
    const { lines, logger } = recording();
    tally.log(logger);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.fields).toEqual({
      kind: "agent",
      labels: 2,
      tags: 1 + LABEL_TAG_REPORT_SAMPLE,
      annotations: 1,
      unreadable: 1,
      ids: ["agt_label", "agt_both", "agt_note", "agt_bad", ...Array.from({ length: 6 }, (_, i) => `agt_tag_${i}`)],
    });
    expect(lines[0]!.message).toMatch(/nothing was changed/);
  });

  it("logs nothing for a kind whose rows hold nothing", () => {
    const tally = new LabelTagTally("agent");
    tally.add("agt_clean", bytes(agent()));
    const { lines, logger } = recording();
    tally.log(logger);
    expect(lines).toEqual([]);
  });
});
