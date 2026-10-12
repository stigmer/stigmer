// Cross-edition parity lock for the file-review projection.
//
// The Go (`FileChangeSetProjector` / project.go) and Java (`FileChangeSetProjector`)
// projectors replay the shared corpus at apis/testdata/hitl/file-review/*.json.
// This test replays the SAME corpus against the TypeScript fold, so a drift
// between the SDK and either backend fails here rather than shipping.
//
// The corpus `expected` is the server projection, which does not depend on the
// run's phase (a finished turn keeps its change sets: a turn never waits for
// review). The SDK's fold has no phase gate either, so every vector, the
// finished run's included, is the fold of its stream.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { create, fromJson, type JsonValue } from "@bufbuild/protobuf";
import {
  FileReviewEventSchema,
  FileReviewEventStreamSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeSetStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { foldFileReviewEventStream } from "../file-review-fold";

const here = dirname(fileURLToPath(import.meta.url));
// sdk/typescript/src/execution/__tests__ -> repo root is five levels up.
const corpusDir = resolve(here, "../../../../../apis/testdata/hitl/file-review");

/** The `expected` summary shape each vector pins (see the corpus README). */
interface ExpectedSet {
  id: string;
  status: string; // full proto enum name, e.g. FILE_CHANGE_SET_STATUS_DECIDED
  change_ids?: string[];
  decision_count?: number;
  aggregate_digest?: string;
  has_approved_snapshot?: boolean;
}

interface Vector {
  name: string;
  description?: string;
  run_id: string;
  phase: string;
  events: JsonValue[];
  expected: ExpectedSet[];
}

function statusFromName(name: string): FileChangeSetStatus {
  const key = name.replace(
    /^FILE_CHANGE_SET_STATUS_/,
    "",
  ) as keyof typeof FileChangeSetStatus;
  const value = FileChangeSetStatus[key];
  if (typeof value !== "number") {
    throw new Error(`unknown FileChangeSetStatus in corpus: ${name}`);
  }
  return value;
}

const vectorFiles = readdirSync(corpusDir).filter(
  (f) => f.endsWith(".json") && f !== "schema.json",
);

describe("file-review fold — cross-edition corpus parity", () => {
  it("finds the corpus vectors", () => {
    expect(vectorFiles.length).toBeGreaterThan(0);
  });

  for (const file of vectorFiles) {
    const vector = JSON.parse(
      readFileSync(resolve(corpusDir, file), "utf8"),
    ) as Vector;

    it(`${file}: ${vector.name}`, () => {
      // Decode each event with the generated schema so a malformed fixture fails
      // loudly (matching the backend corpus drivers), then build the stream.
      const events = vector.events.map((ev) =>
        fromJson(FileReviewEventSchema, ev),
      );
      const stream = create(FileReviewEventStreamSchema, {
        runId: vector.run_id,
        events,
      });

      const projected = foldFileReviewEventStream(stream);

      const actual = projected.map((set) => ({
        id: set.id,
        status: set.status,
        change_ids: set.changes.map((c) => c.id),
        decision_count: set.decisions.length,
        aggregate_digest: set.aggregateDigest,
        has_approved_snapshot: set.approvedSnapshot !== undefined,
      }));

      const expected = vector.expected.map((e) => ({
        id: e.id,
        status: statusFromName(e.status),
        change_ids: e.change_ids ?? [],
        decision_count: e.decision_count ?? 0,
        aggregate_digest: e.aggregate_digest ?? "",
        has_approved_snapshot: e.has_approved_snapshot ?? false,
      }));

      expect(actual).toEqual(expected);
    });
  }
});
