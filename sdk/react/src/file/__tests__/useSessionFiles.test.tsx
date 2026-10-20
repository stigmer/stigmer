/**
 * useSessionFiles lists a conversation's Files once and groups each turn's
 * outputs by run id: a person's upload (no run id) is among the Files but
 * never among a turn's outputs; a changed settled key re-reads the list;
 * without an org or a conversation it reads nothing.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { StigmerContext } from "../../context";
import { useSessionFiles } from "../useSessionFiles";

function file(id: string, runId = "") {
  return create(FileSchema, {
    metadata: { id },
    spec: { filename: `${id}.md` },
    status: { sessionId: "ses_1", runId, outputPath: runId ? `${id}.md` : "" },
  });
}

function stigmerListing(files: ReturnType<typeof file>[]) {
  const listAll = vi.fn(async function* () {
    yield* files;
  });
  const stigmer = { file: { listAll } } as unknown as Stigmer;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
  return { listAll, wrapper };
}

describe("useSessionFiles", () => {
  it("groups each turn's outputs by run id and leaves a person's upload out of them", async () => {
    const { listAll, wrapper } = stigmerListing([file("out_2", "r1"), file("upload"), file("out_1", "r1")]);
    const { result } = renderHook(() => useSessionFiles("acme", "ses_1", ""), { wrapper });

    await waitFor(() => expect(result.current.files).toHaveLength(3));
    expect(listAll).toHaveBeenCalledWith({ org: "acme", sessionId: "ses_1" });
    expect([...result.current.outputsByRun.keys()]).toEqual(["r1"]);
    expect(result.current.outputsByRun.get("r1")?.map((f) => f.metadata?.id)).toEqual(["out_2", "out_1"]);
  });

  it("re-reads the list when the settled key changes", async () => {
    const { listAll, wrapper } = stigmerListing([file("out_1", "r1")]);
    const { result, rerender } = renderHook(({ key }) => useSessionFiles("acme", "ses_1", key), {
      wrapper,
      initialProps: { key: "" },
    });
    await waitFor(() => expect(result.current.files).toHaveLength(1));
    expect(listAll).toHaveBeenCalledTimes(1);

    rerender({ key: "r1" });

    await waitFor(() => expect(listAll).toHaveBeenCalledTimes(2));
  });

  it("reads nothing without a conversation", () => {
    const { listAll, wrapper } = stigmerListing([]);
    const { result } = renderHook(() => useSessionFiles("acme", null, ""), { wrapper });

    expect(listAll).not.toHaveBeenCalled();
    expect(result.current.files).toEqual([]);
  });
});
