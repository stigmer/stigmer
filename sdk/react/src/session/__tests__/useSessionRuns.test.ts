import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  RunSchema,
  type Run,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { sortChronologically } from "../useSessionRuns";

function exec(id: string): Run {
  const e = create(RunSchema);
  const metadata = create(ApiResourceMetadataSchema);
  metadata.id = id;
  e.metadata = metadata;
  return e;
}

function ids(list: readonly Run[]): string[] {
  return list.map((e) => e.metadata?.id ?? "");
}

describe("sortChronologically", () => {
  it("orders executions oldest-first by their ULID id", () => {
    // Real ids from the pilot session, returned by the server in scrambled
    // heap order — the afternoon turns (…vk…) interleaved with the evening
    // turns (…w3…/…w4…). Chronological order is ascending ULID.
    const scrambled = [
      exec("run_01kyw3zeq8cre6cc8gznf31y13"),
      exec("run_01kyvk1hxyrhch1q23p5j177pb"),
      exec("run_01kyw416w9mg6ezzpkc6q9y71x"),
      exec("run_01kyvk2sh0vjc69c7z3q4c9r1m"),
      exec("run_01kyw45qkf88x28pf9bxmrr3bf"),
      exec("run_01kyw3y0rfx9vd7dhnawgqgnb0"),
      exec("run_01kyvk3v34vh9phedx2ezajxtr"),
    ];

    expect(ids(sortChronologically(scrambled))).toEqual([
      "run_01kyvk1hxyrhch1q23p5j177pb",
      "run_01kyvk2sh0vjc69c7z3q4c9r1m",
      "run_01kyvk3v34vh9phedx2ezajxtr",
      "run_01kyw3y0rfx9vd7dhnawgqgnb0",
      "run_01kyw3zeq8cre6cc8gznf31y13",
      "run_01kyw416w9mg6ezzpkc6q9y71x",
      "run_01kyw45qkf88x28pf9bxmrr3bf",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [exec("run_02"), exec("run_01")];
    const before = ids(input);
    sortChronologically(input);
    expect(ids(input)).toEqual(before);
  });

  it("sorts entries missing an id last", () => {
    const list = [exec("run_02"), exec(""), exec("run_01")];
    expect(ids(sortChronologically(list))).toEqual(["run_01", "run_02", ""]);
  });

  it("returns an empty array unchanged", () => {
    expect(sortChronologically([])).toEqual([]);
  });
});
