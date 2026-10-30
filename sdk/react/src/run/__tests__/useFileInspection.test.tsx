/**
 * useFileInspection reads an output File's text, detects a Stigmer
 * resource in it, and offers to apply it into an organization: the call names
 * the org by id, the label by slug. A binary File is never read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { StigmerContext } from "@stigmer/react-core";
import { useFileInspection } from "../useFileInspection";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

// The id derives from the name: the hook runs per render, and a File's id is
// its identity (a new id is a new File to read).
function outputFile(filename: string, mimeType = "") {
  return create(FileSchema, {
    metadata: { id: `file_${filename.replace(/\W/g, "_")}` },
    spec: { filename, mimeType },
    status: { sizeBytes: 64n, runId: "run_1", outputPath: filename },
  });
}

function contentResult(text: string) {
  return { data: new TextEncoder().encode(text), truncated: false };
}

function wrapperFor(stigmer: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

const AGENT_YAML = [
  "apiVersion: agentic.stigmer.ai/v1",
  "kind: Agent",
  "metadata:",
  "  name: my-agent",
  "spec: {}",
  "",
].join("\n");

describe("useFileInspection — content + copy", () => {
  it("fetches text content and copies it to the clipboard on demand", async () => {
    const getContent = vi.fn().mockResolvedValue(contentResult("hello world"));
    const stigmer = { file: { getContent } } as unknown as Stigmer;

    const { result } = renderHook(
      () => useFileInspection(outputFile("notes.txt"), "acme"),
      { wrapper: wrapperFor(stigmer) },
    );

    await waitFor(() => expect(result.current.content).toBe("hello world"));
    expect(result.current.isDetected).toBe(false);
    expect(result.current.ctaLabel).toBeNull();

    act(() => {
      result.current.copy();
    });
    expect(writeText).toHaveBeenCalledWith("hello world");
    await waitFor(() => expect(result.current.copied).toBe(true));
  });

  it("does not read a binary File", () => {
    const getContent = vi.fn().mockReturnValue(new Promise(() => {}));
    const stigmer = { file: { getContent } } as unknown as Stigmer;

    const { result } = renderHook(
      () => useFileInspection(outputFile("photo.png", "image/png"), "acme"),
      { wrapper: wrapperFor(stigmer) },
    );

    expect(getContent).not.toHaveBeenCalled();
    expect(result.current.content).toBeNull();
    expect(result.current.isDetecting).toBe(false);
  });
});

describe("useFileInspection — detection + apply", () => {
  it("applies nothing when the content is not a Stigmer resource", async () => {
    const getContent = vi.fn().mockResolvedValue(contentResult("just some notes"));
    const apply = vi.fn();
    const stigmer = { file: { getContent }, manifest: { apply } } as unknown as Stigmer;
    const onApplied = vi.fn();

    const { result } = renderHook(
      () => useFileInspection(outputFile("notes.txt"), "acme", { onApplied }),
      { wrapper: wrapperFor(stigmer) },
    );
    await waitFor(() => expect(result.current.content).toBe("just some notes"));

    await act(async () => {
      await result.current.apply();
    });

    expect(apply).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    expect(result.current.applyResult).toBeNull();
  });

  it("labels a detected Agent YAML and offers an Apply CTA", async () => {
    const getContent = vi.fn().mockResolvedValue(contentResult(AGENT_YAML));
    const stigmer = { file: { getContent } } as unknown as Stigmer;

    const { result } = renderHook(
      () => useFileInspection(outputFile("agent.yaml"), "acme"),
      { wrapper: wrapperFor(stigmer) },
    );

    await waitFor(() => expect(result.current.isDetected).toBe(true));
    expect(result.current.detectionLabel).toBe("Agent detected");
    expect(result.current.ctaLabel).toBe("Apply to acme");
  });

  it("applies a detected Agent and fires onApplied with the result", async () => {
    const getContent = vi.fn().mockResolvedValue(contentResult(AGENT_YAML));
    // The apply path routes through the kind-agnostic manifest engine:
    // the hook parses the YAML into a ManifestDocument and hands it to
    // stigmer.manifest.apply.
    const apply = vi.fn().mockResolvedValue({
      yamlKind: "Agent",
      displayName: "Agent",
      name: "my-agent",
      org: "acme",
      slug: "my-agent",
      id: "agt_01",
    });
    const stigmer = {
      file: { getContent },
      manifest: { apply },
    } as unknown as Stigmer;
    const onApplied = vi.fn();

    const { result } = renderHook(
      () =>
        useFileInspection(outputFile("agent.yaml"), "acme", {
          onApplied,
        }),
      { wrapper: wrapperFor(stigmer) },
    );

    await waitFor(() => expect(result.current.isDetected).toBe(true));

    await act(async () => {
      await result.current.apply();
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].name).toBe("my-agent");
    expect(apply.mock.calls[0][0].handler.yamlKind).toBe("Agent");
    expect(apply.mock.calls[0][0].org).toBe("acme");
    await waitFor(() => expect(result.current.applyResult?.kind).toBe("Agent"));
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied.mock.calls[0][0].name).toBe("my-agent");
  });
});

describe("useFileInspection — the organization by slug and by id", () => {
  it("labels the Apply CTA with the org's slug and applies into its id", async () => {
    const getContent = vi.fn().mockResolvedValue(contentResult(AGENT_YAML));
    const apply = vi.fn().mockResolvedValue({
      yamlKind: "Agent",
      displayName: "Agent",
      name: "my-agent",
      org: ACME_ID,
      slug: "my-agent",
      id: "agt_01",
    });

    const { result } = renderHook(
      () => useFileInspection(outputFile("agent.yaml"), ACME_ID),
      { wrapper: orgWrapper({ file: { getContent }, manifest: { apply } }) },
    );

    await waitFor(() => expect(result.current.ctaLabel).toBe("Apply to acme"));
    await act(async () => {
      await result.current.apply();
    });
    expect(apply.mock.calls[0][0].org).toBe(ACME_ID);
  });
});
