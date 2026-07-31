import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { sortChronologically } from "../useSessionExecutions";

function exec(id: string): AgentExecution {
  const e = create(AgentExecutionSchema);
  const metadata = create(ApiResourceMetadataSchema);
  metadata.id = id;
  e.metadata = metadata;
  return e;
}

function ids(list: readonly AgentExecution[]): string[] {
  return list.map((e) => e.metadata?.id ?? "");
}

describe("sortChronologically", () => {
  it("orders executions oldest-first by their ULID id", () => {
    // Real ids from the pilot session, returned by the server in scrambled
    // heap order — the afternoon turns (…vk…) interleaved with the evening
    // turns (…w3…/…w4…). Chronological order is ascending ULID.
    const scrambled = [
      exec("aex_01kyw3zeq8cre6cc8gznf31y13"),
      exec("aex_01kyvk1hxyrhch1q23p5j177pb"),
      exec("aex_01kyw416w9mg6ezzpkc6q9y71x"),
      exec("aex_01kyvk2sh0vjc69c7z3q4c9r1m"),
      exec("aex_01kyw45qkf88x28pf9bxmrr3bf"),
      exec("aex_01kyw3y0rfx9vd7dhnawgqgnb0"),
      exec("aex_01kyvk3v34vh9phedx2ezajxtr"),
    ];

    expect(ids(sortChronologically(scrambled))).toEqual([
      "aex_01kyvk1hxyrhch1q23p5j177pb",
      "aex_01kyvk2sh0vjc69c7z3q4c9r1m",
      "aex_01kyvk3v34vh9phedx2ezajxtr",
      "aex_01kyw3y0rfx9vd7dhnawgqgnb0",
      "aex_01kyw3zeq8cre6cc8gznf31y13",
      "aex_01kyw416w9mg6ezzpkc6q9y71x",
      "aex_01kyw45qkf88x28pf9bxmrr3bf",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [exec("aex_02"), exec("aex_01")];
    const before = ids(input);
    sortChronologically(input);
    expect(ids(input)).toEqual(before);
  });

  it("sorts entries missing an id last", () => {
    const list = [exec("aex_02"), exec(""), exec("aex_01")];
    expect(ids(sortChronologically(list))).toEqual(["aex_01", "aex_02", ""]);
  });

  it("returns an empty array unchanged", () => {
    expect(sortChronologically([])).toEqual([]);
  });
});
