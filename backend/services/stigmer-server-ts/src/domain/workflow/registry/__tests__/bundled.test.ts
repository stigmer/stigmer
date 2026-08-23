/**
 * Byte-pin of the bundled registry data against the Go server's go:embed
 * sources — the "same artifact" promise (D2 §1). If Go's registry JSON
 * changes without this copy, this test fails and names the fix. Moved here
 * from the transport lane tests when the registry came home to the domain
 * (workflow-family DD-A).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("bundled artifacts are the Go server's embeds, byte for byte", () => {
  const goDataDir = join(
    import.meta.dirname,
    "../../../../../../stigmer-server/pkg/domain/workflow/registry/data",
  );
  const tsDataDir = join(import.meta.dirname, "../data");

  it.each(["task-kind-registry.json", "model-registry.json"])(
    "%s matches the Go embed source",
    (file) => {
      const goBytes = readFileSync(join(goDataDir, file));
      const tsBytes = readFileSync(join(tsDataDir, file));
      expect(
        tsBytes.equals(goBytes),
        `${file} drifted from the Go embed — re-copy it from ${goDataDir}`,
      ).toBe(true);
    },
  );
});
