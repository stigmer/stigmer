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
  planArtifactName,
  isPlanArtifactName,
  PLAN_ARTIFACT_NAME,
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

describe("planArtifactName", () => {
  it("derives a <slug>.plan.md name from the plan's leading # H1", () => {
    expect(planArtifactName("# Plan Card UX Cleanup\n\nBody")).toBe(
      "plan_card_ux_cleanup.plan.md",
    );
  });

  it("collapses runs of punctuation/whitespace and trims edge underscores", () => {
    expect(planArtifactName("#  Fix: the (download) UX!! \nx")).toBe(
      "fix_the_download_ux.plan.md",
    );
  });

  it("unwraps a ```markdown fenced plan before reading the title (SDK parity)", () => {
    const text = "```markdown\n# Named Plan\n\nbody\n```";
    expect(planArtifactName(text)).toBe("named_plan.plan.md");
  });

  it("unwraps a bare ``` fenced plan before reading the title (SDK parity)", () => {
    const text = "```\n# Bare Fenced Plan\n\nbody\n```";
    expect(planArtifactName(text)).toBe("bare_fenced_plan.plan.md");
  });

  it("caps the slug length so filenames stay bounded", () => {
    const longTitle = "# " + "word ".repeat(40); // ~200 chars of words
    const name = planArtifactName(longTitle);
    const slug = name.slice(0, -".plan.md".length);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(name.endsWith(".plan.md")).toBe(true);
    expect(slug.endsWith("_")).toBe(false);
  });

  it("falls back to plan.md when there is no leading H1", () => {
    expect(planArtifactName("No title here\n\nbody")).toBe(PLAN_ARTIFACT_NAME);
    // An H1 further down is body content, not the title.
    expect(planArtifactName("intro\n\n# Later Heading")).toBe(PLAN_ARTIFACT_NAME);
  });

  it("falls back to plan.md when the title has no alphanumerics", () => {
    expect(planArtifactName("# ---\n\nbody")).toBe(PLAN_ARTIFACT_NAME);
  });
});

describe("isPlanArtifactName", () => {
  it("accepts the legacy exact name and any *.plan.md", () => {
    expect(isPlanArtifactName("plan.md")).toBe(true);
    expect(isPlanArtifactName("feature_x.plan.md")).toBe(true);
  });

  it("rejects non-plan filenames", () => {
    expect(isPlanArtifactName("notes.md")).toBe(false);
    expect(isPlanArtifactName("plan.md.bak")).toBe(false);
    expect(isPlanArtifactName("myplan.md")).toBe(false);
  });
});

describe("publishPlanArtifact", () => {
  it("uploads the named plan and registers a FILE artifact on the status", async () => {
    const status = create(AgentExecutionStatusSchema, {});
    const storage = fakeStorage();

    await publishPlanArtifact({
      status,
      executionId: "aex_123",
      planText: "# Plan Card UX Cleanup\n1. step one\n2. step two\n",
      artifactStorage: storage,
    });

    expect(storage.uploads).toHaveLength(1);
    expect(storage.uploads[0].key).toBe(
      "artifacts/aex_123/plan_card_ux_cleanup.plan.md",
    );
    expect(storage.uploads[0].contentType).toBe("text/markdown");

    expect(status.artifacts).toHaveLength(1);
    const artifact = status.artifacts[0];
    expect(artifact.name).toBe("plan_card_ux_cleanup.plan.md");
    expect(artifact.sandboxPath).toBe(
      ".stigmer/plans/plan_card_ux_cleanup.plan.md",
    );
    expect(artifact.kind).toBe(ExecutionArtifactKind.FILE);
    expect(artifact.storageKey).toBe(
      "artifacts/aex_123/plan_card_ux_cleanup.plan.md",
    );
    expect(artifact.sizeBytes).toBeGreaterThan(0n);
    expect(artifact.contentHash).toHaveLength(64);
  });

  it("uses the legacy plan.md name for a titleless plan", async () => {
    const status = create(AgentExecutionStatusSchema, {});
    const storage = fakeStorage();

    await publishPlanArtifact({
      status,
      executionId: "aex_notitle",
      planText: "just a paragraph, no heading",
      artifactStorage: storage,
    });

    expect(status.artifacts[0].name).toBe(PLAN_ARTIFACT_NAME);
    expect(storage.uploads[0].key).toBe("artifacts/aex_notitle/plan.md");
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

  it("replaces an existing plan rather than appending a duplicate", async () => {
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

  it("replaces a prior plan even when the derived name changed (predicate match)", async () => {
    const status = create(AgentExecutionStatusSchema, {});
    const storage = fakeStorage();

    await publishPlanArtifact({
      status,
      executionId: "aex_rename",
      planText: "# First Title\n\nbody",
      artifactStorage: storage,
    });
    await publishPlanArtifact({
      status,
      executionId: "aex_rename",
      planText: "# Second Title\n\nbody",
      artifactStorage: storage,
    });

    expect(status.artifacts).toHaveLength(1);
    expect(status.artifacts[0].name).toBe("second_title.plan.md");
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
