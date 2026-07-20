import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import { useArtifactInspection } from "../useArtifactInspection";

function fileArtifact(name: string) {
  return create(ExecutionArtifactSchema, {
    name,
    kind: ExecutionArtifactKind.FILE,
    sizeBytes: 64n,
    sandboxPath: `.stigmer/${name}`,
    storageKey: `artifacts/aex_1/${name}`,
    contentHash: "hash-1",
  });
}

function dirArtifact(name: string) {
  return create(ExecutionArtifactSchema, {
    name,
    kind: ExecutionArtifactKind.DIRECTORY,
    sizeBytes: 512n,
    sandboxPath: `.stigmer/${name}`,
    storageKey: `artifacts/aex_1/${name}`,
    entries: ["SKILL.md", "run.sh"],
  });
}

function contentResult(text: string) {
  return {
    content: new TextEncoder().encode(text),
    contentType: "text/plain",
    truncated: false,
  };
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

describe("useArtifactInspection — content + copy", () => {
  it("fetches text content and copies it to the clipboard on demand", async () => {
    const getArtifactContent = vi.fn().mockResolvedValue(contentResult("hello world"));
    const stigmer = { agentExecution: { getArtifactContent } } as unknown as Stigmer;

    const { result } = renderHook(
      () => useArtifactInspection(fileArtifact("notes.txt"), "aex_1", "acme"),
      { wrapper: wrapperFor(stigmer) },
    );

    await waitFor(() => expect(result.current.content).toBe("hello world"));
    expect(result.current.isDirectory).toBe(false);
    expect(result.current.isDetected).toBe(false);
    expect(result.current.ctaLabel).toBeNull();

    act(() => {
      result.current.copy();
    });
    expect(writeText).toHaveBeenCalledWith("hello world");
    await waitFor(() => expect(result.current.copied).toBe(true));
  });

  it("does not fetch content for a directory artifact", () => {
    const getArtifactContent = vi.fn().mockReturnValue(new Promise(() => {}));
    const stigmer = { agentExecution: { getArtifactContent } } as unknown as Stigmer;

    const { result } = renderHook(
      () => useArtifactInspection(dirArtifact("skill-pack"), "aex_1", "acme"),
      { wrapper: wrapperFor(stigmer) },
    );

    expect(result.current.isDirectory).toBe(true);
    // Directory content is not fetched via the text-content RPC (skill
    // detection uses its own entry-scoped fetch).
    expect(
      getArtifactContent.mock.calls.every(
        (call) => call[0]?.entryPath !== undefined,
      ),
    ).toBe(true);
  });
});

describe("useArtifactInspection — detection + apply", () => {
  it("labels a detected Agent YAML and offers an Apply CTA", async () => {
    const getArtifactContent = vi.fn().mockResolvedValue(contentResult(AGENT_YAML));
    const stigmer = { agentExecution: { getArtifactContent } } as unknown as Stigmer;

    const { result } = renderHook(
      () => useArtifactInspection(fileArtifact("agent.yaml"), "aex_1", "acme"),
      { wrapper: wrapperFor(stigmer) },
    );

    await waitFor(() => expect(result.current.isDetected).toBe(true));
    expect(result.current.detectionLabel).toBe("Agent detected");
    expect(result.current.ctaLabel).toBe("Apply to acme");
  });

  it("applies a detected Agent and fires onApplied with the result", async () => {
    const getArtifactContent = vi.fn().mockResolvedValue(contentResult(AGENT_YAML));
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
      agentExecution: { getArtifactContent },
      manifest: { apply },
    } as unknown as Stigmer;
    const onApplied = vi.fn();

    const { result } = renderHook(
      () =>
        useArtifactInspection(fileArtifact("agent.yaml"), "aex_1", "acme", {
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
