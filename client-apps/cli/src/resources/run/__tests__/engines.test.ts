// The harness table the CLI reads every word and label from: each word keeps
// its wire spelling and carries the label docs/vocabulary.md ("Harness") gives
// it on every surface, and help and refusals show the two together.

import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { ENGINES, ENGINE_WORD_LIST, engineChoice } from "../engines.js";

describe("the harness table", () => {
  it("labels each word as the vocabulary does", () => {
    expect(Object.fromEntries(Object.entries(ENGINES).map(([word, entry]) => [word, entry.label]))).toEqual({
      native: "Stigmer",
      claude: "Claude Agent",
    });
    expect(ENGINES.native.harness).toBe(Harness.NATIVE);
    expect(ENGINES.claude.harness).toBe(Harness.CLAUDE);
  });

  it("shows a word beside its label", () => {
    expect(engineChoice("claude")).toBe('"claude" (Claude Agent)');
    expect(ENGINE_WORD_LIST).toBe('"native" (Stigmer) or "claude" (Claude Agent)');
  });
});
