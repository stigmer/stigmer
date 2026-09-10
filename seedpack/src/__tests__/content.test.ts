// The declarative-apply contract, guarded at the content source.
//
// Every YAML file in the canonical content set (`SEEDPACK_ENTRIES`) is a
// Stigmer resource and must carry a top-level `kind`. The bootstrap feeds the
// whole set through the CLI's strict `loadDocuments`, which rejects a kind-less
// document, so a non-resource YAML (the CI canary manifest, a tool's config)
// must never live among the embedded content: it belongs beside it
// (`seedpack/canary/`, `seedpack/tools/`), which every delivery path excludes
// by omission. This is the upstream guard for that whole bug class; it runs on
// every seedpack/** PR (ci.seedpack-static) and fails before a kind-less file
// can break the bootstrap.
//
// Replaces `seedpack/content_test.go` (TestContent_AllYAMLHaveKind).
// Structural validity beyond `kind` (apiVersion, spec shape, protovalidate
// rules) is `make check-docs-yaml`'s job, not this suite's.

import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parseAllDocuments } from "yaml";
import { describe, expect, it } from "vitest";
import { contentDir, listContentFiles } from "../index.js";

describe("seedpack content", () => {
  const root = contentDir();
  const yamlFiles = listContentFiles(root).filter(
    (f) => extname(f) === ".yaml" || extname(f) === ".yml",
  );

  it("ships YAML resources at all (the guard below is not vacuous)", () => {
    expect(yamlFiles.length).toBeGreaterThan(0);
  });

  it("every YAML document under the canonical entries carries a top-level kind", () => {
    const offenders: string[] = [];
    for (const rel of yamlFiles) {
      const docs = parseAllDocuments(readFileSync(join(root, rel), "utf8"));
      docs.forEach((doc, index) => {
        if (doc.errors.length > 0) {
          offenders.push(
            `${rel} (doc ${index}): YAML parse error: ${doc.errors[0]?.message}`,
          );
          return;
        }
        const value = doc.toJS() as unknown;
        // An empty document (a trailing `---`) is not a resource and not an error.
        if (value === null || value === undefined) return;
        const kind =
          typeof value === "object"
            ? (value as Record<string, unknown>).kind
            : undefined;
        if (typeof kind !== "string" || kind === "") {
          offenders.push(
            `${rel} (doc ${index}): missing top-level 'kind' — non-resource files must live outside the content set (seedpack/canary/ or seedpack/tools/)`,
          );
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
