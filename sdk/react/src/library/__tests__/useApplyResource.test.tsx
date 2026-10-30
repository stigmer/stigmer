/**
 * useApplyResource's skill path: pushSkillFromFile asks the server to push a
 * File holding the skill's archive (file id, tag defaulting to empty) and
 * returns the skill's metadata as an apply result; a refused push sets the
 * hook's error, rethrows it, and clears isApplying. Its YAML path applies one
 * resource document at a time: a file of several is refused, before anything
 * reaches the server, with the sentence that sends the person to the
 * Library's Apply YAML.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { useApplyResource } from "../useApplyResource";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>;
  };
}

describe("useApplyResource.pushSkillFromFile", () => {
  it("pushes the File as a skill and returns its metadata", async () => {
    const pushFromFile = vi
      .fn()
      .mockResolvedValue({ metadata: { name: "Code Review", org: "acme", slug: "code-review" } });
    const { result } = renderHook(() => useApplyResource(), {
      wrapper: wrapper({ skill: { pushFromFile } }),
    });

    let applied: unknown;
    await act(async () => {
      applied = await result.current.pushSkillFromFile({
        org: "acme",
        fileId: "file_1",
      });
    });

    expect(pushFromFile.mock.calls[0]![0]).toMatchObject({
      org: "acme",
      fileId: "file_1",
      tag: "",
    });
    expect(applied).toEqual({ kind: "Skill", name: "Code Review", org: "acme", slug: "code-review" });
    expect(result.current.isApplying).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("falls back to the requested org and empty names when the skill has no metadata", async () => {
    const pushFromFile = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useApplyResource(), {
      wrapper: wrapper({ skill: { pushFromFile } }),
    });

    let applied: unknown;
    await act(async () => {
      applied = await result.current.pushSkillFromFile({
        org: "acme",
        fileId: "file_1",
        tag: "stable",
      });
    });

    expect(pushFromFile.mock.calls[0]![0]).toMatchObject({ tag: "stable" });
    expect(applied).toEqual({ kind: "Skill", name: "", org: "acme", slug: "" });
  });

  it("sets and rethrows the error when the push is refused", async () => {
    const refusal = new Error("the File is not a skill archive");
    const pushFromFile = vi.fn().mockRejectedValue(refusal);
    const { result } = renderHook(() => useApplyResource(), {
      wrapper: wrapper({ skill: { pushFromFile } }),
    });

    await act(async () => {
      await expect(
        result.current.pushSkillFromFile({ org: "acme", fileId: "file_1" }),
      ).rejects.toBe(refusal);
    });

    expect(result.current.error?.message).toBe("the File is not a skill archive");
    expect(result.current.isApplying).toBe(false);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

describe("useApplyResource.applyYamlResource", () => {
  it("refuses a file of several resource documents without applying any", async () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useApplyResource(), {
      wrapper: wrapper({ manifest: { apply } }),
    });
    const content = [
      "apiVersion: agentic.stigmer.ai/v1",
      "kind: Agent",
      "metadata:",
      "  name: Reviewer",
      "  slug: reviewer",
      "spec:",
      "  description: Reviews",
      "---",
      "apiVersion: agentic.stigmer.ai/v1",
      "kind: Agent",
      "metadata:",
      "  name: Writer",
      "  slug: writer",
      "spec:",
      "  description: Writes",
      "",
    ].join("\n");

    await act(async () => {
      await expect(result.current.applyYamlResource(content, "acme")).rejects.toThrow(
        "This file contains multiple resource documents. " +
          "Use Apply YAML in the Library to apply multi-document manifests.",
      );
    });

    expect(apply).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBe(
      "This file contains multiple resource documents. " +
        "Use Apply YAML in the Library to apply multi-document manifests.",
    );
    expect(result.current.isApplying).toBe(false);
  });
});
