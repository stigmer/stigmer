/**
 * The server half of the cross-edition file-digest corpus
 * (apis/testdata/hitl/file-digest): every vector's file_digest and every
 * aggregate's aggregate_digest, computed by ../digest.ts, equals the
 * pinned value. The runner reads the same file, so a drift fails one of
 * the two suites.
 */
import path from "node:path";

import { fromJson } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { CapturedFileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";

import { aggregateDigest, fileDigest } from "../digest.js";
import { hitlCorpusDir, readCorpusJson } from "../../approval/__tests__/corpus-support.js";

interface FileDigestCase {
  name: string;
  path_before: string;
  path_after: string;
  kind: string;
  before_sha256: string;
  after_sha256: string;
  file_digest: string;
}

interface FileDigestAggregate {
  name: string;
  change_names: string[];
  aggregate_digest: string;
}

describe("shared file-digest corpus", () => {
  const doc = readCorpusJson(
    path.join(hitlCorpusDir(), "file-digest", "vectors.json"),
  ) as unknown as {
    cases: FileDigestCase[];
    aggregates: FileDigestAggregate[];
  };

  const changeOf = (c: FileDigestCase) =>
    fromJson(CapturedFileChangeSchema, {
      pathBefore: c.path_before,
      pathAfter: c.path_after,
      kind: c.kind,
      beforeSha256: c.before_sha256,
      afterSha256: c.after_sha256,
    } as never);

  it("discovers the corpus", () => {
    expect(doc.cases.length).toBeGreaterThanOrEqual(4);
    expect(doc.aggregates.length).toBeGreaterThanOrEqual(3);
  });

  for (const c of doc.cases) {
    it(`file_digest: ${c.name}`, () => {
      expect(fileDigest(changeOf(c))).toBe(c.file_digest);
    });
  }

  for (const agg of doc.aggregates) {
    it(`aggregate_digest: ${agg.name}`, () => {
      const byName = new Map(doc.cases.map((c) => [c.name, c]));
      const changes = agg.change_names.map((name) =>
        changeOf(byName.get(name) as FileDigestCase),
      );
      expect(aggregateDigest(changes)).toBe(agg.aggregate_digest);
    });
  }
});
