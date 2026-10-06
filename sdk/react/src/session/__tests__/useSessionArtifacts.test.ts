import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/artifact_pb";
import {
  RunArtifactKind,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { useSessionArtifacts, artifactKey } from "../useSessionArtifacts";

function artifact(opts: { name: string; sandboxPath?: string }) {
  return create(RunArtifactSchema, {
    name: opts.name,
    kind: RunArtifactKind.FILE,
    sizeBytes: 8n,
    ...(opts.sandboxPath ? { sandboxPath: opts.sandboxPath } : {}),
    storageKey: `artifacts/aex/${opts.name}`,
  });
}

afterEach(cleanup);

describe("artifactKey", () => {
  it("uses sandbox_path when present (its filesystem identity)", () => {
    expect(artifactKey(artifact({ name: "a.md", sandboxPath: "/w/dir/a.md" }))).toBe(
      "/w/dir/a.md",
    );
  });

  it("falls back to name for artifacts without a sandbox path", () => {
    expect(artifactKey(artifact({ name: "a.md" }))).toBe("a.md");
  });

  it("is the key useSessionArtifacts dedups on (same key → latest wins)", () => {
    const older = create(AgentRunSchema, {
      metadata: { id: "aex_1" },
      status: {
        phase: RunPhase.RUN_COMPLETED,
        artifacts: [artifact({ name: "a.md", sandboxPath: "/w/a.md" })],
      },
    });
    const newer = create(AgentRunSchema, {
      metadata: { id: "aex_2" },
      status: {
        phase: RunPhase.RUN_COMPLETED,
        artifacts: [artifact({ name: "a.md", sandboxPath: "/w/a.md" })],
      },
    });

    const { result } = renderHook(() => useSessionArtifacts([older, newer]));
    expect(result.current.artifacts).toHaveLength(1);
    // The later run's version wins for a shared key.
    expect(result.current.artifacts[0].runId).toBe("aex_2");
    expect(artifactKey(result.current.artifacts[0].artifact)).toBe("/w/a.md");
  });
});
