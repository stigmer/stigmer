/**
 * What a conversation's agent saved, over its Files: identity is the output
 * path; the later turn wins a shared path whatever the list order, and the
 * earlier turns' Files at that path stay behind it, newest first; a person's
 * uploads (no run id) stay out; entries sort by filename and flag a shared
 * filename at two paths; a turn still running marks its entry not terminal.
 */

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { useSessionOutputs, outputKey } from "../useSessionOutputs";

function file(opts: { id: string; filename: string; runId?: string; outputPath?: string }) {
  return create(FileSchema, {
    metadata: { id: opts.id },
    spec: { filename: opts.filename },
    status: { sizeBytes: 8n, runId: opts.runId ?? "", outputPath: opts.outputPath ?? "" },
  });
}

function run(id: string, phase = RunPhase.RUN_COMPLETED) {
  return create(RunSchema, { metadata: { id }, status: { phase } });
}

afterEach(cleanup);

describe("outputKey", () => {
  it("uses the output path when present", () => {
    expect(outputKey(file({ id: "f", filename: "q3.md", runId: "r", outputPath: "reports/q3.md" }))).toBe(
      "reports/q3.md",
    );
  });

  it("falls back to the filename", () => {
    expect(outputKey(file({ id: "f", filename: "a.md" }))).toBe("a.md");
  });

  it("is the key useSessionOutputs dedups on (same key → latest turn wins)", () => {
    // The list is newest first, but the turn order decides, not the list.
    const files = [
      file({ id: "f_old", filename: "a.md", runId: "aex_1", outputPath: "w/a.md" }),
      file({ id: "f_new", filename: "a.md", runId: "aex_2", outputPath: "w/a.md" }),
    ];
    const { result } = renderHook(() => useSessionOutputs(files, [run("aex_1"), run("aex_2")]));
    expect(result.current.outputs).toHaveLength(1);
    expect(result.current.outputs[0].runId).toBe("aex_2");
    expect(result.current.outputs[0].file.metadata?.id).toBe("f_new");
  });
});

describe("useSessionOutputs", () => {
  it("lists only Files a turn returned, never a person's uploads", () => {
    const files = [
      file({ id: "up", filename: "brief.pdf" }),
      file({ id: "out", filename: "report.md", runId: "aex_1", outputPath: "report.md" }),
    ];
    const { result } = renderHook(() => useSessionOutputs(files, [run("aex_1")]));
    expect(result.current.outputs.map((e) => e.file.metadata?.id)).toEqual(["out"]);
    expect(result.current.outputCount).toBe(1);
  });

  it("sorts by filename and flags a filename shared by two output paths", () => {
    const files = [
      file({ id: "b", filename: "notes.md", runId: "aex_1", outputPath: "b/notes.md" }),
      file({ id: "a", filename: "notes.md", runId: "aex_1", outputPath: "a/notes.md" }),
      file({ id: "c", filename: "Alpha.txt", runId: "aex_1", outputPath: "Alpha.txt" }),
    ];
    const { result } = renderHook(() => useSessionOutputs(files, [run("aex_1")]));
    expect(result.current.outputs.map((e) => e.file.spec?.filename)).toEqual(["Alpha.txt", "notes.md", "notes.md"]);
    expect(result.current.outputs.map((e) => e.hasNameCollision)).toEqual([false, true, true]);
  });

  it("keeps the earlier turns' Files at a path behind the newest, newest first", () => {
    // Newest first, as the server lists; the turn order decides, not the list.
    const files = [
      file({ id: "v2", filename: "report.md", runId: "aex_2", outputPath: "report.md" }),
      file({ id: "v3", filename: "report.md", runId: "aex_3", outputPath: "report.md" }),
      file({ id: "other", filename: "notes.md", runId: "aex_1", outputPath: "notes.md" }),
      file({ id: "v1", filename: "report.md", runId: "aex_1", outputPath: "report.md" }),
    ];
    const { result } = renderHook(() =>
      useSessionOutputs(files, [run("aex_1"), run("aex_2"), run("aex_3")]),
    );
    const report = result.current.outputs.find((e) => e.file.spec?.filename === "report.md");
    expect(report?.file.metadata?.id).toBe("v3");
    expect(report?.earlier.map((f) => f.metadata?.id)).toEqual(["v2", "v1"]);
    const notes = result.current.outputs.find((e) => e.file.spec?.filename === "notes.md");
    expect(notes?.earlier).toEqual([]);
    expect(result.current.outputCount).toBe(2);
  });

  it("marks an output of a running turn as not terminal", () => {
    const files = [file({ id: "f", filename: "a.md", runId: "aex_1", outputPath: "a.md" })];
    const { result } = renderHook(() =>
      useSessionOutputs(files, [run("aex_1", RunPhase.RUN_IN_PROGRESS)]),
    );
    expect(result.current.outputs[0].isTerminal).toBe(false);
  });

  it("ignores a run with no id: its Files rank as an unloaded run's and count as ended", () => {
    const files = [
      file({ id: "late", filename: "a.md", runId: "aex_2", outputPath: "a.md" }),
      file({ id: "early", filename: "a.md", runId: "aex_1", outputPath: "a.md" }),
    ];
    const nameless = create(RunSchema, { status: { phase: RunPhase.RUN_IN_PROGRESS } });
    const { result } = renderHook(() => useSessionOutputs(files, [nameless, run("aex_2")]));

    // aex_1 is not among the loaded runs (the id-less run never stands in for
    // it), so aex_2's File wins the shared path; aex_1 still counts as ended.
    expect(result.current.outputs.map((e) => e.file.metadata?.id)).toEqual(["late"]);
    expect(result.current.outputs[0].isTerminal).toBe(true);
  });
});
