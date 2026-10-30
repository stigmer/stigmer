// Pins the generator's target dispatch: a name no target holds is refused
// with the one message the CLI prints (main.ts's catch writes it and exits
// 1), and nothing is generated for it.
import { describe, expect, it } from "vitest";

import { runGenerationTarget } from "../targets.js";

describe("runGenerationTarget", () => {
  it("refuses a target no generator holds, naming it", () => {
    expect(() =>
      runGenerationTarget("sdk-client-cobol", {
        schemaDir: "tools/codegen/schemas",
        outputDir: "",
        apisDir: "",
      }),
    ).toThrow('Unknown --target "sdk-client-cobol"');
  });
});
