// Pins `runs to-eval-case` over a client double: the server builds the case
// (buildCaseFromRun gets the run, --name and --skill as written), and the
// command unzips it under --dir (evals by default) into the case directory
// the server named, printing where and each note the server returned;
// --eval adds the case to the eval it names instead (addCaseFromRun, by
// slug in the caller's organization or by id) and prints the new version.
// Refused before anything is written or sent: a bad --name, a bad --skill,
// --dir beside --eval, an --eval naming a version. Refused before anything
// is written: an archive that does not match its digest, one with an entry
// outside its case directory, an existing case directory.

import { create } from "@bufbuild/protobuf";
import { zipSync } from "fflate";
import { digestArchive } from "@stigmer/plugin-package/client";
import { EvalSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import {
  EvalCaseArchiveSchema,
  type AddEvalCaseFromRunRequest,
  type BuildEvalCaseFromRunRequest,
} from "@stigmer/apis/ai/stigmer/agentic/eval/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/client";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import { writeEvalCaseFromRun, type CaseFolderIo } from "../run-to-eval-case.js";

const encoder = new TextEncoder();

function caseArchive(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)])));
}

const FILES = {
  "finds-the-bug/prompt.md": "Look over my diff and find the bug.\n",
  "finds-the-bug/graders/criteria.md": "---\ntype: llm\n---\n\nFAIL if: missed the off-by-one\n",
};

interface Calls {
  builds: BuildEvalCaseFromRunRequest[];
  adds: AddEvalCaseFromRunRequest[];
}

async function fakeClient(
  options: { files?: Record<string, string>; notes?: string[]; digest?: string; caseName?: string } = {},
): Promise<{ client: Stigmer; calls: Calls }> {
  const artifact = caseArchive(options.files ?? FILES);
  const digest = options.digest ?? (await digestArchive(artifact));
  const calls: Calls = { builds: [], adds: [] };
  const client = {
    eval: {
      buildCaseFromRun: async (req: BuildEvalCaseFromRunRequest) => {
        calls.builds.push(req);
        return create(EvalCaseArchiveSchema, { caseName: options.caseName ?? "finds-the-bug", artifact, digest, notes: options.notes ?? [] });
      },
      addCaseFromRun: async (req: AddEvalCaseFromRunRequest) => {
        calls.adds.push(req);
        return create(EvalSchema, {
          metadata: { slug: "support-evals", version: { message: "case finds-the-bug from run run_1" } },
          status: { digest: "abcdef0123456789" },
        });
      },
    },
  } as unknown as Stigmer;
  return { client, calls };
}

function fakeFolder(existing: string[] = []) {
  const extracted: Array<{ dir: string; size: number }> = [];
  let stderr = "";
  const io: CaseFolderIo = {
    exists: async (path) => existing.includes(path),
    extract: (archive, dir) => {
      extracted.push({ dir, size: archive.length });
      return 2;
    },
    stderr: { write: (text) => void (stderr += text) },
  };
  return { io, extracted, err: () => stderr };
}

async function refusal(promise: Promise<unknown>): Promise<UsageError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UsageError);
  return error as UsageError;
}

describe("writeEvalCaseFromRun, writing the case here", () => {
  it("unzips the server's case under evals/<the case it named> and says where, with each note", async () => {
    const { client, calls } = await fakeClient({ notes: ["the message's files are not part of the case: file_report"] });
    const folder = fakeFolder();
    expect(await writeEvalCaseFromRun(client, "run_1", {}, folder.io, "acme")).toBe("evals/finds-the-bug");
    expect(calls.builds.map((req) => [req.runId, req.caseName, req.skill])).toEqual([["run_1", "", ""]]);
    expect(folder.extracted.map((entry) => entry.dir)).toEqual(["evals"]);
    expect(folder.err()).toContain("Wrote evals/finds-the-bug (2 files).");
    expect(folder.err()).toContain("Fill in the PASS line of evals/finds-the-bug/graders/criteria.md");
    expect(folder.err()).toContain("Note: the message's files are not part of the case: file_report\n");
  });

  it("hands --name and --skill to the server and honours --dir", async () => {
    const { client, calls } = await fakeClient({ caseName: "custom", files: { "custom/prompt.md": "Hi.\n" } });
    const folder = fakeFolder();
    expect(await writeEvalCaseFromRun(client, "run_2", { dir: "suite/", name: "custom", skill: " thermos : review " }, folder.io, "acme")).toBe(
      "suite/custom",
    );
    expect(calls.builds.map((req) => [req.caseName, req.skill])).toEqual([["custom", "thermos:review"]]);
    expect(folder.extracted.map((entry) => entry.dir)).toEqual(["suite"]);
  });

  it("refuses an archive that does not match its digest, one with an entry outside its case, and an existing case directory, writing nothing", async () => {
    const tampered = await fakeClient({ digest: "0".repeat(64) });
    const first = fakeFolder();
    expect((await refusal(writeEvalCaseFromRun(tampered.client, "run_1", {}, first.io, "acme"))).message).toContain("does not match its digest");
    const climbing = await fakeClient({ files: { ...FILES, "elsewhere/notes.md": "x" } });
    expect((await refusal(writeEvalCaseFromRun(climbing.client, "run_1", {}, first.io, "acme"))).message).toContain(
      "holds 'elsewhere/notes.md', outside its case directory 'finds-the-bug'",
    );
    const plain = await fakeClient();
    const taken = fakeFolder(["evals/finds-the-bug"]);
    expect((await refusal(writeEvalCaseFromRun(plain.client, "run_1", {}, taken.io, "acme"))).message).toBe(
      "evals/finds-the-bug already exists; choose another --name, or remove it first",
    );
    expect([first.extracted, taken.extracted]).toEqual([[], []]);
  });
});

describe("writeEvalCaseFromRun, adding the case to an eval", () => {
  it("adds it to the eval named by slug in the caller's organization, or by id, and prints the new version", async () => {
    const { client, calls } = await fakeClient();
    const folder = fakeFolder();
    expect(await writeEvalCaseFromRun(client, "run_1", { eval: "support-evals", name: "finds-the-bug" }, folder.io, "acme")).toBe(
      "abcdef0123456789",
    );
    await writeEvalCaseFromRun(client, "run_1", { eval: "evs_01abc" }, folder.io, "acme");
    expect(calls.adds.map((req) => [req.runId, req.eval?.kind, req.eval?.org, req.eval?.slug, req.eval?.id, req.caseName])).toEqual([
      ["run_1", ApiResourceKind.eval, "acme", "support-evals", "", "finds-the-bug"],
      ["run_1", ApiResourceKind.eval, "", "", "evs_01abc", ""],
    ]);
    expect(calls.builds).toEqual([]);
    expect(folder.extracted).toEqual([]);
    expect(folder.err()).toContain("Added the case to eval 'support-evals' as version sha256:abcdef012345 (case finds-the-bug from run run_1).");
  });

  it("prints no message when the version carries none", async () => {
    const { client } = await fakeClient();
    (client.eval as unknown as { addCaseFromRun: () => Promise<unknown> }).addCaseFromRun = async () =>
      create(EvalSchema, { metadata: { slug: "support-evals" }, status: { digest: "abcdef0123456789" } });
    const folder = fakeFolder();
    await writeEvalCaseFromRun(client, "run_1", { eval: "support-evals" }, folder.io, "acme");
    expect(folder.err()).toContain("as version sha256:abcdef012345.\n");
  });
});

describe("writeEvalCaseFromRun, refused before anything is sent", () => {
  it("refuses a bad --name, a bad --skill, --dir beside --eval and an --eval naming a version", async () => {
    const { client, calls } = await fakeClient();
    const folder = fakeFolder();
    expect((await refusal(writeEvalCaseFromRun(client, "run_1", { name: "Bad Name" }, folder.io, "acme"))).message).toContain(
      "--name 'Bad Name' is not a case name",
    );
    expect((await refusal(writeEvalCaseFromRun(client, "run_1", { skill: "review" }, folder.io, "acme"))).message).toContain(
      "--skill 'review' names no skill",
    );
    expect((await refusal(writeEvalCaseFromRun(client, "run_1", { eval: "support-evals", dir: "evals" }, folder.io, "acme"))).message).toContain(
      "with --eval the case goes into the eval instead",
    );
    expect((await refusal(writeEvalCaseFromRun(client, "run_1", { eval: "support-evals@stable" }, folder.io, "acme"))).message).toContain(
      "names a version",
    );
    expect([calls.builds, calls.adds, folder.extracted]).toEqual([[], [], []]);
  });
});
