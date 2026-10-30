// Pins the generator's target dispatch: each target name reaches its own
// generator (proven by the generator's own failure on a schema directory
// that does not exist), and a name no target holds is refused with the one
// message the CLI prints (main.ts's catch writes it and exits 1).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGenerationTarget } from "../targets.js";

describe("runGenerationTarget", () => {
  let scratch = "";

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "codegen-targets-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it.each(["mcp-ts", "sdk-client-ts", "sdk-client-python", "sdk-client-java", "sdk-client", "sdk-docs"])(
    "dispatches %s to its generator",
    (target) => {
      const absent = join(scratch, "absent");
      expect(() =>
        runGenerationTarget(target, { schemaDir: absent, outputDir: join(scratch, "out"), apisDir: absent }),
      ).toThrow(/no such file or directory|ENOENT/);
    },
  );

  it("refuses a target no generator holds, naming it", () => {
    expect(() =>
      runGenerationTarget("sdk-client-cobol", { schemaDir: scratch, outputDir: join(scratch, "out"), apisDir: "" }),
    ).toThrow('Unknown --target "sdk-client-cobol"');
  });
});
