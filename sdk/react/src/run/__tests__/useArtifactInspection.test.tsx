/**
 * useArtifactInspection reads a run artifact's content, detects a
 * Stigmer resource or skill package in it, and offers to apply or push it
 * into an organization: the call names the org by id, the label by slug.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { RunArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/artifact_pb";
import { RunArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { StigmerContext } from "../../context";
import { useArtifactInspection } from "../useArtifactInspection";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

function fileArtifact(name: string) {
  return create(RunArtifactSchema, {
    name,
    kind: RunArtifactKind.FILE,
    sizeBytes: 64n,
    sandboxPath: `.stigmer/${name}`,
    storageKey: `artifacts/aex_1/${name}`,
    contentHash: "hash-1",
  });
}

function dirArtifact(name: string) {
  return create(RunArtifactSchema, {
    name,
    kind: RunArtifactKind.DIRECTORY,
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
    const stigmer = { agentRun: { getArtifactContent } } as unknown as Stigmer;

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
    const stigmer = { agentRun: { getArtifactContent } } as unknown as Stigmer;

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
    const stigmer = { agentRun: { getArtifactContent } } as unknown as Stigmer;

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
      agentRun: { getArtifactContent },
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

describe("useArtifactInspection — the organization by slug and by id", () => {
  it("labels the Apply CTA with the org's slug and applies into its id", async () => {
    const getArtifactContent = vi.fn().mockResolvedValue(contentResult(AGENT_YAML));
    const apply = vi.fn().mockResolvedValue({
      yamlKind: "Agent",
      displayName: "Agent",
      name: "my-agent",
      org: ACME_ID,
      slug: "my-agent",
      id: "agt_01",
    });

    const { result } = renderHook(
      () => useArtifactInspection(fileArtifact("agent.yaml"), "aex_1", ACME_ID),
      { wrapper: orgWrapper({ agentRun: { getArtifactContent }, manifest: { apply } }) },
    );

    await waitFor(() => expect(result.current.ctaLabel).toBe("Apply to acme"));
    await act(async () => {
      await result.current.apply();
    });
    expect(apply.mock.calls[0][0].org).toBe(ACME_ID);
  });

  it("labels the Push Skill CTA of a skill package with the org's slug", async () => {
    const getArtifactContent = vi
      .fn()
      .mockResolvedValue(contentResult("---\nname: triage\ndescription: Triage notes\n---\n# Triage\n"));

    const { result } = renderHook(
      () => useArtifactInspection(dirArtifact("skill-pack"), "aex_1", ACME_ID),
      { wrapper: orgWrapper({ agentRun: { getArtifactContent } }) },
    );

    await waitFor(() => expect(result.current.ctaLabel).toBe("Push Skill to acme"));
    expect(result.current.detectionLabel).toBe("Skill \u00B7 2 files");
  });
});
