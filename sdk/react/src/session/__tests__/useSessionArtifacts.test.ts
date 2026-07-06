import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import {
  ExecutionArtifactKind,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useSessionArtifacts, artifactKey } from "../useSessionArtifacts";

function artifact(opts: { name: string; sandboxPath?: string }) {
  return create(ExecutionArtifactSchema, {
    name: opts.name,
    kind: ExecutionArtifactKind.FILE,
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
    const older = create(AgentExecutionSchema, {
      metadata: { id: "aex_1" },
      status: {
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        artifacts: [artifact({ name: "a.md", sandboxPath: "/w/a.md" })],
      },
    });
    const newer = create(AgentExecutionSchema, {
      metadata: { id: "aex_2" },
      status: {
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        artifacts: [artifact({ name: "a.md", sandboxPath: "/w/a.md" })],
      },
    });

    const { result } = renderHook(() => useSessionArtifacts([older, newer]));
    expect(result.current.artifacts).toHaveLength(1);
    // The later execution's version wins for a shared key.
    expect(result.current.artifacts[0].executionId).toBe("aex_2");
    expect(artifactKey(result.current.artifacts[0].artifact)).toBe("/w/a.md");
  });
});
