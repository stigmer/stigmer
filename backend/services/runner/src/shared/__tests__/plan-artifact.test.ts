import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionArtifactKind,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ArtifactStorage } from "../artifact-storage.js";
import { makeInMemoryArtifactStorage } from "../../__test-utils__/fake-artifact-storage.js";
import {
  extractFinalPlanText,
  publishPlanArtifact,
  PLAN_ARTIFACT_NAME,
  PLAN_ARTIFACT_SANDBOX_PATH,
} from "../plan-artifact.js";

/** Records uploads and returns deterministic download URLs (canonical double + shim). */
function fakeStorage(): ArtifactStorage & { uploads: { key: string; content: Buffer; contentType?: string }[] } {
  const { storage, blobs } = makeInMemoryArtifactStorage({ urlBase: "https://example.test/download/" });
  const uploads: { key: string; content: Buffer; contentType?: string }[] = [];
  storage.upload.mockImplementation(async (key: string, content: Buffer, contentType?: string) => {
    uploads.push({ key, content, contentType });
    blobs.set(key, Buffer.from(content));
    return key;
  });
  return Object.assign(storage, { uploads });
}

function statusWith(...messages: { type: MessageType; content: string }[]) {
  return create(AgentExecutionStatusSchema, {
    messages: messages.map((m) =>
      create(AgentMessageSchema, { type: m.type, content: m.content }),
    ),
  });
}

describe("extractFinalPlanText", () => {
  it("returns the last non-empty AI message content", () => {
    const status = statusWith(
      { type: MessageType.MESSAGE_HUMAN, content: "make a plan" },
      { type: MessageType.MESSAGE_AI, content: "first" },
      { type: MessageType.MESSAGE_AI, content: "the real plan" },
    );
    expect(extractFinalPlanText(status)).toBe("the real plan");
  });

  it("skips trailing empty AI messages (e.g. tool-call-only turns)", () => {
    const status = statusWith(
      { type: MessageType.MESSAGE_AI, content: "the plan body" },
      { type: MessageType.MESSAGE_AI, content: "   " },
    );
    expect(extractFinalPlanText(status)).toBe("the plan body");
  });

  it("returns undefined when there is no AI message with content", () => {
    const status = statusWith({ type: MessageType.MESSAGE_HUMAN, content: "hi" });
    expect(extractFinalPlanText(status)).toBeUndefined();
  });
});

describe("publishPlanArtifact", () => {
  it("uploads plan.md and registers a FILE artifact on the status", async () => {
    const status = create(AgentExecutionStatusSchema, {});
    const storage = fakeStorage();

    await publishPlanArtifact({
      status,
      executionId: "aex_123",
      planText: "# Plan\n1. step one\n2. step two\n",
      artifactStorage: storage,
    });

    expect(storage.uploads).toHaveLength(1);
    expect(storage.uploads[0].key).toBe("artifacts/aex_123/plan.md");
    expect(storage.uploads[0].contentType).toBe("text/markdown");

    expect(status.artifacts).toHaveLength(1);
    const artifact = status.artifacts[0];
    expect(artifact.name).toBe(PLAN_ARTIFACT_NAME);
    expect(artifact.sandboxPath).toBe(PLAN_ARTIFACT_SANDBOX_PATH);
    expect(artifact.kind).toBe(ExecutionArtifactKind.FILE);
    expect(artifact.storageKey).toBe("artifacts/aex_123/plan.md");
    expect(artifact.sizeBytes).toBeGreaterThan(0n);
    expect(artifact.contentHash).toHaveLength(64);
  });

  it("is a no-op for empty plan text (nothing to publish)", async () => {
    const status = create(AgentExecutionStatusSchema, {});
    const storage = fakeStorage();

    await publishPlanArtifact({
      status,
      executionId: "aex_empty",
      planText: "   \n  ",
      artifactStorage: storage,
    });

    expect(storage.uploads).toHaveLength(0);
    expect(status.artifacts).toHaveLength(0);
  });

  it("replaces an existing plan.md rather than appending a duplicate", async () => {
    const status = create(AgentExecutionStatusSchema, {});
    const storage = fakeStorage();

    await publishPlanArtifact({ status, executionId: "aex_re", planText: "v1", artifactStorage: storage });
    await publishPlanArtifact({ status, executionId: "aex_re", planText: "v2 longer plan", artifactStorage: storage });

    expect(status.artifacts).toHaveLength(1);
    expect(storage.uploads).toHaveLength(2);
    // The surviving artifact reflects the latest content hash.
    const latestHash = storage.uploads[1].content;
    expect(status.artifacts[0].sizeBytes).toBe(BigInt(latestHash.length));
  });

  it("never throws when the upload fails (publish is non-fatal)", async () => {
    const status = create(AgentExecutionStatusSchema, {});
    const { storage: failing } = makeInMemoryArtifactStorage();
    failing.upload.mockImplementation(async () => { throw new Error("network down"); });

    await expect(
      publishPlanArtifact({ status, executionId: "aex_fail", planText: "plan", artifactStorage: failing }),
    ).resolves.toBeUndefined();
    expect(status.artifacts).toHaveLength(0);
  });
});
