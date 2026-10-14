/**
 * The access-history export (access-history.ts): it follows every page
 * oldest first after the caller's last entry, asks with the same request
 * each time, and writes each entry as one canonical proto JSON line; it
 * tells the caller once, before the first entry and from the first page
 * alone, which entries the server's retention removed after the caller's.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  AccessChange,
  AccessChangeCause,
  AccessHistoryEntrySchema,
  AccessHistoryPageSchema,
  type AccessHistoryPage,
  type ListAccessHistoryInput,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";

import { accessHistoryJsonLine, exportAccessHistory } from "../access-history";
import type { RemovedAccessHistory } from "../access-history";

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

describe("exportAccessHistory and retention", () => {
  function pagesClient(pages: AccessHistoryPage[]) {
    let asked = 0;
    return {
      listAccessHistory: () => Promise.resolve(pages[asked++]!),
    };
  }

  it("tells the caller once, before the first entry, which entries were removed after the one it holds", async () => {
    const client = pagesClient([
      create(AccessHistoryPageSchema, {
        entries: [entry(12n), entry(13n)],
        nextPageToken: "t1",
        oldestSequence: 12n,
        retentionDays: 365,
      }),
      create(AccessHistoryPageSchema, { entries: [entry(14n)], oldestSequence: 14n, retentionDays: 365 }),
    ]);
    const events: Array<bigint | RemovedAccessHistory> = [];
    for await (const exported of exportAccessHistory(client, "org_acme", {
      after: 7n,
      onRemoved: (removed) => events.push(removed),
    })) {
      events.push(exported.sequence);
    }
    expect(events).toEqual([{ first: 8n, last: 11n, retentionDays: 365 }, 12n, 13n, 14n]);
  });

  it("tells the caller its whole run was removed when the organization holds no entry any more", async () => {
    const client = pagesClient([create(AccessHistoryPageSchema, { oldestSequence: 101n, retentionDays: 365 })]);
    const removed: RemovedAccessHistory[] = [];
    for await (const _ of exportAccessHistory(client, "org_acme", { after: 42n, onRemoved: (run) => removed.push(run) })) {
      throw new Error("an organization with every entry removed exports nothing");
    }
    expect(removed).toEqual([{ first: 43n, last: 100n, retentionDays: 365 }]);
  });

  it("says nothing when the oldest kept entry follows the caller's, or the history is empty", async () => {
    for (const [after, oldestSequence] of [
      [7n, 8n],
      [7n, 3n],
      [0n, 1n],
      [0n, 0n],
      [7n, 0n],
    ] as const) {
      const removed: RemovedAccessHistory[] = [];
      const client = pagesClient([create(AccessHistoryPageSchema, { oldestSequence, retentionDays: 30 })]);
      for await (const _ of exportAccessHistory(client, "org_acme", { after, onRemoved: (run) => removed.push(run) })) {
        throw new Error("these pages hold no entries");
      }
      expect(removed, `after ${after}, oldest ${oldestSequence}`).toEqual([]);
    }
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
