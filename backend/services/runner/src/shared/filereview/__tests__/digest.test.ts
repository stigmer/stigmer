/**
 * The TypeScript driver of the cross-edition file-digest corpus
 * (`apis/testdata/hitl/file-digest/vectors.json`). The Go (`digest_test.go`) and
 * Java (`FileDigestTest`) suites replay the SAME vectors, so a passing run in all
 * three proves the runner computes byte-identical `file_digest` /
 * `aggregate_digest` to both backends — the load-bearing parity contract for the
 * producer.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { aggregateDigest, fileChangeKindName, fileDigest, type FileDigestInput } from "../digest.js";

interface VectorCase {
  name: string;
  path_before: string;
  path_after: string;
  kind: string;
  before_sha256: string;
  after_sha256: string;
  file_digest: string;
}

interface VectorAggregate {
  name: string;
  change_names: string[];
  aggregate_digest: string;
}

interface Vectors {
  cases: VectorCase[];
  aggregates: VectorAggregate[];
}

/** Walk up from this file until the shared HITL fixtures are found. */
function findVectorsFile(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "apis", "testdata", "hitl", "file-digest", "vectors.json");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("could not locate apis/testdata/hitl/file-digest/vectors.json");
}

/** Map the proto enum value name in the corpus back to the TS enum member. */
function kindFromName(name: string): FileChangeKind {
  for (const k of [
    FileChangeKind.UNSPECIFIED,
    FileChangeKind.ADD,
    FileChangeKind.MODIFY,
    FileChangeKind.DELETE,
    FileChangeKind.RENAME,
    FileChangeKind.BINARY_CHANGE,
  ]) {
    if (fileChangeKindName(k) === name) return k;
  }
  throw new Error(`unknown FileChangeKind name in corpus: ${name}`);
}

const vectors: Vectors = JSON.parse(readFileSync(findVectorsFile(), "utf8"));

function toInput(c: VectorCase): FileDigestInput {
  return {
    pathBefore: c.path_before,
    pathAfter: c.path_after,
    kind: kindFromName(c.kind),
    beforeSha256: c.before_sha256,
    afterSha256: c.after_sha256,
  };
}

describe("file-digest cross-edition corpus", () => {
  it("loads the shared corpus (guard against an empty/missing file)", () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(4);
    expect(vectors.aggregates.length).toBeGreaterThanOrEqual(3);
  });

  for (const c of vectors.cases) {
    it(`file_digest matches for "${c.name}"`, () => {
      expect(fileDigest(toInput(c))).toBe(c.file_digest);
    });
  }

  const byName = new Map(vectors.cases.map((c) => [c.name, c]));
  for (const agg of vectors.aggregates) {
    it(`aggregate_digest matches for "${agg.name}"`, () => {
      const inputs = agg.change_names.map((n) => {
        const c = byName.get(n);
        if (!c) throw new Error(`aggregate references unknown case ${n}`);
        return toInput(c);
      });
      expect(aggregateDigest(inputs)).toBe(agg.aggregate_digest);
    });
  }
});
