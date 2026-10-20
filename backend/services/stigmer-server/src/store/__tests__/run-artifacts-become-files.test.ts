/**
 * Pins run-artifacts-become-files.ts: what one stored run becomes when the
 * files the native engine uploaded for it leave its status to become Files.
 *
 *   - each file entry is lifted as a conversion record naming the run's
 *     conversation, its position among the stored entries, its name and key
 *     and the run's spec creation instant, and a directory entry is dropped;
 *   - the run keeps everything else, and its etag is left as it was, since
 *     the etag covers only the spec;
 *   - a status field no release defined is kept beside the lifted files;
 *   - a run without the retired field is left alone (undefined);
 *   - bytes that do not decode throw, and the step's error names the row.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import { liftRunArtifacts, unreadableRunArtifactsRowError } from "../run-artifacts-become-files.js";
import {
  RUN_ARTIFACTS_STEP_CONVERSIONS,
  RUN_ARTIFACTS_STEP_EXPECTED,
  RUN_ARTIFACTS_STEP_ROWS,
  runRowWithArtifacts,
} from "./retired-run-artifact-rows.js";

describe("liftRunArtifacts", () => {
  it("lifts each file entry, drops a directory's, and leaves the run without them, its etag as it was", () => {
    const lifted = liftRunArtifacts(RUN_ARTIFACTS_STEP_ROWS[0]!.data);

    expect(lifted?.outputs).toEqual(RUN_ARTIFACTS_STEP_CONVERSIONS);
    expect(lifted?.data).toEqual(RUN_ARTIFACTS_STEP_EXPECTED.get("run_step"));
    expect(fromBinary(RunSchema, lifted!.data).metadata?.etag).toBe("kept-etag");
  });

  it("names no conversation or instant the run does not hold", () => {
    const bare = { metadata: { id: "run_2", org: "org_x" }, status: {} };
    const lifted = liftRunArtifacts(runRowWithArtifacts(bare, [{ name: "a.txt", kind: 1, storageKey: "artifacts/run_2/a.txt" }]));

    expect(lifted?.outputs.map((output) => [output.sessionId, output.createdAt])).toEqual([["", ""]]);
    expect(lifted?.data).toEqual(toBinary(RunSchema, create(RunSchema, bare)));
  });

  it("drops the field even when it held only directories", () => {
    const run = { metadata: { id: "run_3" }, status: {} };
    const lifted = liftRunArtifacts(runRowWithArtifacts(run, [{ name: "pkg", kind: 2, storageKey: "artifacts/run_3/pkg.zip" }]));

    expect(lifted?.outputs).toEqual([]);
    expect(lifted?.data).toEqual(toBinary(RunSchema, create(RunSchema, run)));
  });

  it("keeps a status field no release defined beside the lifted files", () => {
    const run = create(RunSchema, { metadata: { id: "run_4" }, status: {} });
    const future = { no: 9001, wireType: WireType.LengthDelimited, data: new BinaryWriter().string("later").finish() };
    run.status!.$unknown = [future];
    const lifted = liftRunArtifacts(
      runRowWithArtifacts(fromBinary(RunSchema, toBinary(RunSchema, run)), [
        { name: "a.txt", kind: 1, storageKey: "artifacts/run_4/a.txt" },
      ]),
    );

    expect(fromBinary(RunSchema, lifted!.data).status?.$unknown).toEqual([future]);
  });

  it("leaves a run without stored files alone", () => {
    expect(liftRunArtifacts(RUN_ARTIFACTS_STEP_ROWS[1]!.data)).toBeUndefined();
    expect(liftRunArtifacts(toBinary(RunSchema, create(RunSchema, { metadata: { id: "run_5" } })))).toBeUndefined();
  });

  it("throws on bytes that do not decode, and the step's error names the row", () => {
    let thrown: unknown;
    try {
      liftRunArtifacts(new Uint8Array([0xff, 0xff, 0xff]));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(unreadableRunArtifactsRowError("run_broken", thrown).message).toMatch(
      /^run 'run_broken' cannot be read to turn its stored files into Files: /,
    );
  });
});
