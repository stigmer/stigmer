import { createHash } from "node:crypto";
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

/** Mirrors the runner's content-hash discriminator so tests can assert exact names. */
function planId(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex").slice(0, 8);
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
  it("derives a hyphenated <slug>_<id>.plan.md name from the plan's leading # H1", () => {
    const text = "# Plan Card UX Cleanup\n\nBody";
    // "Plan Card…" has no label separator, so the genuine word "plan" survives.
    expect(planArtifactName(text)).toBe(`plan-card-ux-cleanup_${planId(text)}.plan.md`);
  });

  it("strips a leading 'Plan:' LABEL (colon/dash-anchored) from the slug", () => {
    const text = "# Plan: Fix the download UX\n\nbody";
    expect(planArtifactName(text)).toBe(`fix-the-download-ux_${planId(text)}.plan.md`);
  });

  it("collapses runs of punctuation/whitespace and trims edge hyphens", () => {
    const text = "#  Fix: the (download) UX!! \nx";
    expect(planArtifactName(text)).toBe(`fix-the-download-ux_${planId(text)}.plan.md`);
  });

  it("unwraps a ```markdown fenced plan before reading the title (SDK parity)", () => {
    const text = "```markdown\n# Named Plan\n\nbody\n```";
    expect(planArtifactName(text)).toBe(`named-plan_${planId(text)}.plan.md`);
  });

  it("unwraps a bare ``` fenced plan before reading the title (SDK parity)", () => {
    const text = "```\n# Bare Fenced Plan\n\nbody\n```";
    expect(planArtifactName(text)).toBe(`bare-fenced-plan_${planId(text)}.plan.md`);
  });

  it("caps the slug length so filenames stay bounded", () => {
    const longTitle = "# " + "word ".repeat(40); // ~200 chars of words
    const name = planArtifactName(longTitle);
    const match = /^(.+)_[0-9a-f]{8}\.plan\.md$/.exec(name);
    expect(match).not.toBeNull();
    const slug = match![1];
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to a bare <id>.plan.md when there is no leading H1", () => {
    const noTitle = "No title here\n\nbody";
    expect(planArtifactName(noTitle)).toBe(`${planId(noTitle)}.plan.md`);
    // An H1 further down is body content, not the title.
    const later = "intro\n\n# Later Heading";
    expect(planArtifactName(later)).toBe(`${planId(later)}.plan.md`);
  });

  it("falls back to a bare <id>.plan.md when the title is only the 'Plan:' label", () => {
    const text = "# Plan:\n\nbody";
    expect(planArtifactName(text)).toBe(`${planId(text)}.plan.md`);
  });

  it("falls back to a bare <id>.plan.md when the title has no alphanumerics", () => {
    const text = "# ---\n\nbody";
    expect(planArtifactName(text)).toBe(`${planId(text)}.plan.md`);
  });

  it("never freshly emits the legacy plan.md name", () => {
    for (const text of ["# A Title\n\nbody", "no heading", "# Plan:\n\nx"]) {
      expect(planArtifactName(text)).not.toBe(PLAN_ARTIFACT_NAME);
    }
  });
});

describe("isPlanArtifactName", () => {
  it("accepts the legacy exact name and any *.plan.md", () => {
    expect(isPlanArtifactName("plan.md")).toBe(true);
    expect(isPlanArtifactName("feature_x.plan.md")).toBe(true);
    expect(isPlanArtifactName("fix-the-download-ux_a1b2c3d4.plan.md")).toBe(true);
    expect(isPlanArtifactName("a1b2c3d4.plan.md")).toBe(true);
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

    const planText = "# Plan Card UX Cleanup\n1. step one\n2. step two\n";
    const name = `plan-card-ux-cleanup_${planId(planText)}.plan.md`;
    await publishPlanArtifact({
      status,
      executionId: "aex_123",
      planText,
      artifactStorage: storage,
    });

    expect(storage.uploads).toHaveLength(1);
    expect(storage.uploads[0].key).toBe(`artifacts/aex_123/${name}`);
    expect(storage.uploads[0].contentType).toBe("text/markdown");

    expect(status.artifacts).toHaveLength(1);
    const artifact = status.artifacts[0];
    expect(artifact.name).toBe(name);
    expect(artifact.sandboxPath).toBe(`.stigmer/plans/${name}`);
    expect(artifact.kind).toBe(ExecutionArtifactKind.FILE);
    expect(artifact.storageKey).toBe(`artifacts/aex_123/${name}`);
    expect(artifact.sizeBytes).toBeGreaterThan(0n);
    expect(artifact.contentHash).toHaveLength(64);
    // The filename's <id> is the leading 8 hex of the full content hash.
    expect(artifact.contentHash.startsWith(planId(planText))).toBe(true);
  });

  it("uses a bare <id>.plan.md name for a titleless plan (never the legacy plan.md)", async () => {
    const status = create(AgentExecutionStatusSchema, {});
    const storage = fakeStorage();

    const planText = "just a paragraph, no heading";
    const name = `${planId(planText)}.plan.md`;
    await publishPlanArtifact({
      status,
      executionId: "aex_notitle",
      planText,
      artifactStorage: storage,
    });

    expect(status.artifacts[0].name).toBe(name);
    expect(status.artifacts[0].name).not.toBe(PLAN_ARTIFACT_NAME);
    expect(storage.uploads[0].key).toBe(`artifacts/aex_notitle/${name}`);
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

    // Replacement is at the STATUS level, matched by the *.plan.md predicate:
    // exactly one plan artifact survives. Because names are content-derived,
    // the two differing-content writes land under DIFFERENT keys (the first is
    // an orphan blob) — but this synthetic double-publish never happens in
    // production, where publishPlanArtifact runs once per execution finalization
    // and a same-content retry re-writes the same key.
    expect(status.artifacts).toHaveLength(1);
    expect(storage.uploads).toHaveLength(2);
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
    const secondText = "# Second Title\n\nbody";
    await publishPlanArtifact({
      status,
      executionId: "aex_rename",
      planText: secondText,
      artifactStorage: storage,
    });

    expect(status.artifacts).toHaveLength(1);
    expect(status.artifacts[0].name).toBe(`second-title_${planId(secondText)}.plan.md`);
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
