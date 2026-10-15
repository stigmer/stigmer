// Pins the eval suites' fixtures (support/evals.ts): the working agent's
// evals/ folder reads, rooted at the folder, through the library's own
// pushed-eval reader (`readEvalFolder`, the server's push) as exactly the
// cases the suites name, with nothing it cannot read; the one-case folder
// reads as one loadable case; the archive is deterministic, so one file
// map is one digest, and the digest is the archive's SHA-256. Nothing here
// starts a server.
import { createHash } from "node:crypto";
import { readEvalFolder } from "@stigmer/plugin-package";
import { inMemoryPluginFiles } from "@stigmer/plugin-package/testing";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  WORKING_AGENT_EVAL_CASES,
  digestOf,
  evalArchive,
  oneCaseEvalArchive,
  workingAgentEvalFiles,
} from "../evals";

/** The folder an archive holds, as the server's reader sees it. */
function readArchive(archive: Uint8Array): ReturnType<typeof readEvalFolder> {
  return readEvalFolder(inMemoryPluginFiles(new Map(Object.entries(unzipSync(archive)))));
}

describe("the eval fixtures", () => {
  it("read the working agent's folder as the cases the suites name, rooted at the folder", () => {
    const suite = readEvalFolder(inMemoryPluginFiles(new Map(Object.entries(workingAgentEvalFiles()))));
    expect(suite.dir).toBe("");
    expect(suite.findings).toEqual([]);
    expect(suite.cases.map((evalCase) => evalCase.name)).toEqual([...WORKING_AGENT_EVAL_CASES]);
    expect(readArchive(evalArchive(workingAgentEvalFiles())).cases).toHaveLength(WORKING_AGENT_EVAL_CASES.length);
  });

  it("make a one-case folder that loads, its prompt as given", () => {
    const suite = readArchive(oneCaseEvalArchive("What is the refund window?"));
    expect(suite.findings).toEqual([]);
    expect(suite.cases.map((evalCase) => [evalCase.dir, evalCase.prompt.trim()])).toEqual([
      ["answers", "What is the refund window?"],
    ]);
  });

  it("archive one file map to one digest, the archive's SHA-256", () => {
    const first = oneCaseEvalArchive("Same.");
    const again = oneCaseEvalArchive("Same.");
    expect(digestOf(first)).toBe(digestOf(again));
    expect(digestOf(first)).toBe(createHash("sha256").update(first).digest("hex"));
    expect(digestOf(oneCaseEvalArchive("Other."))).not.toBe(digestOf(first));
  });
});
