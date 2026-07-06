import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import { ArtifactDocument } from "../ArtifactDocument";

function fileArtifact(name: string) {
  return create(ExecutionArtifactSchema, {
    name,
    kind: ExecutionArtifactKind.FILE,
    sizeBytes: 64n,
    storageKey: `artifacts/aex_1/${name}`,
    contentHash: "hash-1",
  });
}

function dirArtifact(name: string) {
  return create(ExecutionArtifactSchema, {
    name,
    kind: ExecutionArtifactKind.DIRECTORY,
    sizeBytes: 512n,
    storageKey: `artifacts/aex_1/${name}`,
    entries: ["a.txt", "b.txt"],
  });
}

function stigmerReturning(text: string): Stigmer {
  return {
    agentExecution: {
      getArtifactContent: vi.fn().mockResolvedValue({
        content: new TextEncoder().encode(text),
        contentType: "text/plain",
        truncated: false,
      }),
    },
  } as unknown as Stigmer;
}

function renderDoc(stigmer: Stigmer, artifact = fileArtifact("notes.txt")) {
  return render(
    <StigmerContext.Provider value={stigmer}>
      <ArtifactDocument
        artifact={artifact}
        executionId="aex_1"
        org="acme"
        isTerminal
      />
    </StigmerContext.Provider>,
  );
}

const AGENT_YAML = [
  "apiVersion: agentic.stigmer.ai/v1",
  "kind: Agent",
  "metadata:",
  "  name: my-agent",
  "spec: {}",
  "",
].join("\n");

afterEach(cleanup);

describe("ArtifactDocument", () => {
  it("renders the toolbar (name + Download) and the fetched content", async () => {
    renderDoc(stigmerReturning("hello document"));

    expect(screen.getByRole("article", { name: "Artifact notes.txt" })).toBeTruthy();
    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(screen.getByText("Download")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/hello document/)).toBeTruthy());
    expect(screen.getByText("Copy")).toBeTruthy();
  });

  it("surfaces resource detection and an Apply CTA for a detected Agent", async () => {
    renderDoc(stigmerReturning(AGENT_YAML), fileArtifact("agent.yaml"));

    await waitFor(() => expect(screen.getByText("Agent detected")).toBeTruthy());
    expect(screen.getByText("Apply to acme")).toBeTruthy();
  });

  it("renders a directory artifact with a Download ZIP action and no Copy", () => {
    render(
      <StigmerContext.Provider value={stigmerReturning("")}>
        <ArtifactDocument
          artifact={dirArtifact("pack")}
          executionId="aex_1"
          org="acme"
          isTerminal
        />
      </StigmerContext.Provider>,
    );

    expect(screen.getByText("Download ZIP")).toBeTruthy();
    expect(screen.queryByText("Copy")).toBeNull();
    expect(screen.getByText("Files (2)")).toBeTruthy();
  });
});
