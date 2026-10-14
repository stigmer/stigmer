/**
 * The access-history export (access-history.ts): it follows every page
 * oldest first after the caller's last entry, asks with the same request
 * each time, and writes each entry as one canonical proto JSON line.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  AccessChange,
  AccessChangeCause,
  AccessHistoryEntrySchema,
  AccessHistoryPageSchema,
  type ListAccessHistoryInput,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";

import { accessHistoryJsonLine, exportAccessHistory } from "../access-history";

function entry(sequence: bigint) {
  return create(AccessHistoryEntrySchema, {
    sequence,
    change: AccessChange.granted,
    cause: AccessChangeCause.grant,
    actorClass: "user",
  });
}

describe("exportAccessHistory", () => {
  it("follows every page oldest first, after the last entry the caller holds", async () => {
    const asked: ListAccessHistoryInput[] = [];
    const pages = [
      create(AccessHistoryPageSchema, { entries: [entry(8n), entry(9n)], nextPageToken: "t1" }),
      create(AccessHistoryPageSchema, { entries: [entry(10n)], nextPageToken: "" }),
    ];
    const client = {
      listAccessHistory: (input: ListAccessHistoryInput) => {
        asked.push(input);
        return Promise.resolve(pages[asked.length - 1]!);
      },
    };
    const seen: bigint[] = [];
    for await (const exported of exportAccessHistory(client, "org_acme", { after: 7n })) {
      seen.push(exported.sequence);
    }
    expect(seen).toEqual([8n, 9n, 10n]);
    expect(asked.map((input) => [input.org, input.afterSequence, input.pageSize, input.pageToken])).toEqual([
      ["org_acme", 7n, 100, ""],
      ["org_acme", 7n, 100, "t1"],
    ]);
  });

  it("starts at the first entry when the caller holds none", async () => {
    const asked: ListAccessHistoryInput[] = [];
    const client = {
      listAccessHistory: (input: ListAccessHistoryInput) => {
        asked.push(input);
        return Promise.resolve(create(AccessHistoryPageSchema));
      },
    };
    for await (const _ of exportAccessHistory(client, "org_acme")) {
      throw new Error("an empty history exports nothing");
    }
    expect(asked[0]?.afterSequence).toBe(0n);
  });
});

describe("accessHistoryJsonLine", () => {
  it("writes one canonical proto JSON line, the sequence as a string and enums by name", () => {
    const line = accessHistoryJsonLine(entry(42n));
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      sequence: "42",
      change: "granted",
      cause: "grant",
      actorClass: "user",
    });
  });
});
