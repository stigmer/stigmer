/**
 * What was given to a conversation, over its Files: every File no turn
 * returned, newest first as listed, each at the place the conversation's
 * `file` resources settle (an attached folder's path, a uniquified name),
 * else at its filename; its document key sits under the uploads folder, so
 * it never aliases an output's.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { deriveSessionGivenFiles, givenKey } from "../useSessionGivenFiles";
import { outputKey } from "../useSessionOutputs";

function file(id: string, filename: string, runId = "", outputPath = "") {
  return create(FileSchema, {
    metadata: { id },
    spec: { filename },
    status: { sessionId: "ses_1", runId, outputPath },
  });
}

function mounted(fileId: string, mountPath: string) {
  return create(SessionResourceSchema, { resource: { case: "file", value: { fileId, mountPath } } });
}

describe("deriveSessionGivenFiles", () => {
  it("lists every File no turn returned, in the listed order, and leaves the outputs out", () => {
    const files = [
      file("file_new", "shot.png"),
      file("file_out", "report.md", "run_1", "report.md"),
      file("file_old", "brief.pdf"),
    ];
    const { given, givenCount } = deriveSessionGivenFiles(files, []);
    expect(given.map((e) => e.file.metadata?.id)).toEqual(["file_new", "file_old"]);
    expect(givenCount).toBe(2);
  });

  it("names each File by the place its resource settled, else by its filename", () => {
    const files = [file("file_a", "a.csv"), file("file_b", "a.csv"), file("file_c", "report.pdf"), file("file_d", "notes.txt")];
    const resources = [
      mounted("file_a", "q3/a.csv"),
      mounted("file_b", "q4/a.csv"),
      mounted("file_c", "report-2.pdf"),
      create(SessionResourceSchema, {
        name: "repo",
        resource: { case: "gitRepository", value: { url: "https://github.com/acme/repo" } },
      }),
    ];
    const { given } = deriveSessionGivenFiles(files, resources);
    expect(given.map((e) => e.place)).toEqual(["q3/a.csv", "q4/a.csv", "report-2.pdf", "notes.txt"]);
  });

  it("keys a given File's document under the uploads folder, apart from any output's key", () => {
    const [entry] = deriveSessionGivenFiles([file("file_a", "report.md")], []).given;
    const output = file("file_o", "report.md", "run_1", "report.md");
    expect(givenKey(entry!)).toBe(".stigmer/uploads/report.md");
    expect(givenKey(entry!)).not.toBe(outputKey(output));
  });
});
