/**
 * Shared-corpus test support: locates the cross-edition HITL corpus
 * (apis/testdata/hitl) through this file's compiled-in source path and
 * reads a corpus file as JSON (a malformed file fails loudly, never
 * silently skips).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { JsonValue } from "@bufbuild/protobuf";

/**
 * The corpus root: this file lives at
 * backend/services/stigmer-server/src/domain/run/approval/__tests__/,
 * eight directories above which is the repo root; the corpus lives under
 * apis/testdata/hitl.
 */
export function hitlCorpusDir(): string {
  return path.join(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../../../../../../..",
    "apis/testdata/hitl",
  );
}

export function readCorpusJson(filePath: string): JsonValue {
  return JSON.parse(readFileSync(filePath, "utf-8")) as JsonValue;
}
