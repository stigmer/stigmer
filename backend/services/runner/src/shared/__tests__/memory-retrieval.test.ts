/**
 * Unit tests for the memory-retrieval module (stigmer/stigmer#293 Phase 3a,
 * DD-008). What is pinned here, path by path:
 *
 *  - The activation threshold: selection runs ONLY above RETRIEVAL_K
 *    candidates; at or below it there is NO embeddings call (most users
 *    never touch the embeddings API — the DD-008 D3 activation contract).
 *  - Top-k correctness and the presentation contract: selection is by
 *    relevance, presentation is snapshot order, ties break toward the
 *    lower snapshot index (deterministic across invocations).
 *  - The failure posture: every degraded path — no embedder, embed error,
 *    malformed response — injects wholesale with an honest
 *    selection_active=false report, never a throw into prompt build.
 *  - The written-once replay: a prior report (either polarity) replays
 *    without an embeddings call, so a re-invocation can never inject a
 *    different subset than the first invocation did.
 *  - The report contract: a report exists exactly when facts are injected;
 *    no injection, no report (absent report = wholesale by construction).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RecalledMemoriesSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { RecalledMemoriesReportSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import {
  selectRecalledFacts,
  RETRIEVAL_K,
  EMBEDDING_MODEL,
  QUERY_MAX_CHARS,
  type EmbedFn,
} from "../memory-retrieval.js";

const QUERY = "How should I deploy the payments service?";

/** Snapshot of `count` facts: mem_0..mem_{count-1}, "fact 0".."fact N". */
function snapshot(count: number) {
  return create(RecalledMemoriesSchema, {
    enabled: true,
    facts: Array.from({ length: count }, (_, i) => ({
      memoryId: `mem_${i}`,
      content: `fact ${i}`,
    })),
  });
}

/**
 * A deterministic embedder over 2D unit vectors: the query embeds to
 * [1, 0]; fact i embeds to an angle that grows with i, so relevance order
 * is exactly snapshot order (fact 0 most similar) unless a test overrides
 * per-input vectors.
 */
function angularEmbedder(overrides?: Map<string, number[]>): EmbedFn & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const fn: EmbedFn = async (inputs) => {
    calls.push([...inputs]);
    return inputs.map((input, position) => {
      const override = overrides?.get(input);
      if (override) return override;
      if (position === 0) return [1, 0];
      const angle = (position / (inputs.length + 1)) * (Math.PI / 2);
      return [Math.cos(angle), Math.sin(angle)];
    });
  };
  return Object.assign(fn, { calls });
}

function baseOptions(embed: EmbedFn) {
  return {
    proxyEndpoint: null,
    stigmerToken: null,
    executionId: "exec_test",
    embed,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("selectRecalledFacts — no injection, no report", () => {
  it("answers nothing for an absent snapshot (pre-Phase-2 executions)", async () => {
    const embed = angularEmbedder();
    const result = await selectRecalledFacts(undefined, QUERY, baseOptions(embed));
    expect(result.content).toBeUndefined();
    expect(result.report).toBeUndefined();
    expect(embed.calls).toHaveLength(0);
  });

  it("answers nothing when recall is disabled or enabled-with-zero-facts", async () => {
    const embed = angularEmbedder();
    const disabled = create(RecalledMemoriesSchema, {
      enabled: false,
      facts: [{ memoryId: "mem_0", content: "fact 0" }],
    });
    expect(
      (await selectRecalledFacts(disabled, QUERY, baseOptions(embed))).report,
    ).toBeUndefined();
    const empty = create(RecalledMemoriesSchema, { enabled: true });
    expect(
      (await selectRecalledFacts(empty, QUERY, baseOptions(embed))).report,
    ).toBeUndefined();
    expect(embed.calls).toHaveLength(0);
  });
});

describe("selectRecalledFacts — activation threshold (DD-008 D3)", () => {
  it("injects wholesale with NO embeddings call at exactly k candidates", async () => {
    const embed = angularEmbedder();
    const result = await selectRecalledFacts(
      snapshot(RETRIEVAL_K),
      QUERY,
      baseOptions(embed),
    );

    expect(embed.calls).toHaveLength(0);
    expect(result.content?.facts).toHaveLength(RETRIEVAL_K);
    expect(result.report?.selectionActive).toBe(false);
    expect(result.report?.injectedMemoryIds).toEqual([]);
    expect(result.report?.embeddingModel).toBe("");
  });

  it("activates selection at k+1: one batched call, k facts injected", async () => {
    const embed = angularEmbedder();
    const result = await selectRecalledFacts(
      snapshot(RETRIEVAL_K + 1),
      QUERY,
      baseOptions(embed),
    );

    expect(embed.calls).toHaveLength(1);
    expect(embed.calls[0]).toHaveLength(RETRIEVAL_K + 2); // query + all candidates
    expect(embed.calls[0][0]).toBe(QUERY);
    expect(result.content?.facts).toHaveLength(RETRIEVAL_K);
    expect(result.report?.selectionActive).toBe(true);
    expect(result.report?.injectedMemoryIds).toHaveLength(RETRIEVAL_K);
    expect(result.report?.embeddingModel).toBe(EMBEDDING_MODEL);
    // The angular embedder makes the LAST fact least relevant.
    expect(result.report?.injectedMemoryIds).not.toContain(`mem_${RETRIEVAL_K}`);
  });

  it("counts only renderable candidates toward the threshold (blank facts dropped, the read-boundary semantics)", async () => {
    const embed = angularEmbedder();
    const recalled = create(RecalledMemoriesSchema, {
      enabled: true,
      facts: [
        ...Array.from({ length: RETRIEVAL_K }, (_, i) => ({
          memoryId: `mem_${i}`,
          content: `fact ${i}`,
        })),
        { memoryId: "mem_blank", content: "   " },
      ],
    });

    const result = await selectRecalledFacts(recalled, QUERY, baseOptions(embed));

    expect(embed.calls).toHaveLength(0); // 20 renderable ≤ k → wholesale
    expect(result.content?.facts).toHaveLength(RETRIEVAL_K);
    expect(result.report?.selectionActive).toBe(false);
  });
});

describe("selectRecalledFacts — ranking and presentation", () => {
  it("selects by relevance but presents in snapshot order, ids parallel to facts", async () => {
    // Invert relevance: the LAST fact is the most similar, fact 0 the least.
    const count = RETRIEVAL_K + 5;
    const overrides = new Map<string, number[]>();
    for (let i = 0; i < count; i++) {
      const angle = ((count - i) / (count + 1)) * (Math.PI / 2);
      overrides.set(`fact ${i}`, [Math.cos(angle), Math.sin(angle)]);
    }
    const embed = angularEmbedder(overrides);

    const result = await selectRecalledFacts(
      snapshot(count),
      QUERY,
      baseOptions(embed),
    );

    // The 5 least relevant under inversion are the FIRST five snapshot facts.
    const expectedIndices = Array.from({ length: RETRIEVAL_K }, (_, i) => i + 5);
    expect(result.content?.facts).toEqual(expectedIndices.map((i) => `fact ${i}`));
    expect(result.report?.injectedMemoryIds).toEqual(
      expectedIndices.map((i) => `mem_${i}`),
    );
  });

  it("breaks ties toward the lower snapshot index — equal scores never reorder across invocations", async () => {
    // Every input embeds identically: all scores tie.
    const count = RETRIEVAL_K + 3;
    const overrides = new Map<string, number[]>([[QUERY, [1, 0]]]);
    for (let i = 0; i < count; i++) {
      overrides.set(`fact ${i}`, [1, 0]);
    }
    const embed = angularEmbedder(overrides);

    const first = await selectRecalledFacts(snapshot(count), QUERY, baseOptions(embed));
    const second = await selectRecalledFacts(snapshot(count), QUERY, baseOptions(embed));

    const expected = Array.from({ length: RETRIEVAL_K }, (_, i) => `mem_${i}`);
    expect(first.report?.injectedMemoryIds).toEqual(expected);
    expect(second.report?.injectedMemoryIds).toEqual(expected);
  });

  it("truncates the query at QUERY_MAX_CHARS — a giant paste must not 400 the whole batch", async () => {
    const embed = angularEmbedder();
    const giant = "x".repeat(QUERY_MAX_CHARS + 500);

    await selectRecalledFacts(snapshot(RETRIEVAL_K + 1), giant, baseOptions(embed));

    expect(embed.calls[0][0]).toHaveLength(QUERY_MAX_CHARS);
  });
});

describe("selectRecalledFacts — failure posture (never worse than Phase 2)", () => {
  it("degrades to wholesale with an honest report when the embedder throws", async () => {
    const embed: EmbedFn = async () => {
      throw new Error("connect ETIMEDOUT");
    };
    const result = await selectRecalledFacts(
      snapshot(RETRIEVAL_K + 1),
      QUERY,
      baseOptions(embed),
    );

    expect(result.content?.facts).toHaveLength(RETRIEVAL_K + 1);
    expect(result.report?.selectionActive).toBe(false);
    expect(result.report?.injectedMemoryIds).toEqual([]);
  });

  it("degrades to wholesale when the embedder answers the wrong vector count", async () => {
    const embed: EmbedFn = async () => [[1, 0]];
    const result = await selectRecalledFacts(
      snapshot(RETRIEVAL_K + 1),
      QUERY,
      baseOptions(embed),
    );

    expect(result.content?.facts).toHaveLength(RETRIEVAL_K + 1);
    expect(result.report?.selectionActive).toBe(false);
  });

  it("injects wholesale when no embedder resolves (no proxy, no OpenAI key — the Anthropic-only OSS posture)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const result = await selectRecalledFacts(snapshot(RETRIEVAL_K + 1), QUERY, {
      proxyEndpoint: null,
      stigmerToken: null,
      executionId: "exec_test",
      // No embed injected: the module resolves — and finds — nothing.
    });

    expect(result.content?.facts).toHaveLength(RETRIEVAL_K + 1);
    expect(result.report?.selectionActive).toBe(false);
  });
});

describe("selectRecalledFacts — written-once replay across re-invocations", () => {
  it("replays a selection-active prior report without an embeddings call", async () => {
    const embed = angularEmbedder();
    const prior = create(RecalledMemoriesReportSchema, {
      selectionActive: true,
      injectedMemoryIds: ["mem_1", "mem_3"],
      embeddingModel: EMBEDDING_MODEL,
    });

    const result = await selectRecalledFacts(snapshot(RETRIEVAL_K + 1), QUERY, {
      ...baseOptions(embed),
      priorReport: prior,
    });

    expect(embed.calls).toHaveLength(0);
    expect(result.content?.facts).toEqual(["fact 1", "fact 3"]);
    expect(result.report).toBe(prior);
  });

  it("replays a wholesale prior report as wholesale — a recorded embed failure is never retried into a different prompt", async () => {
    const embed = angularEmbedder();
    const prior = create(RecalledMemoriesReportSchema, { selectionActive: false });

    const result = await selectRecalledFacts(snapshot(RETRIEVAL_K + 1), QUERY, {
      ...baseOptions(embed),
      priorReport: prior,
    });

    expect(embed.calls).toHaveLength(0);
    expect(result.content?.facts).toHaveLength(RETRIEVAL_K + 1);
    expect(result.report?.selectionActive).toBe(false);
  });

  it("re-selects when a recorded id does not resolve against the snapshot (structurally impossible, defended anyway)", async () => {
    const embed = angularEmbedder();
    const prior = create(RecalledMemoriesReportSchema, {
      selectionActive: true,
      injectedMemoryIds: ["mem_1", "mem_never_existed"],
      embeddingModel: EMBEDDING_MODEL,
    });

    const result = await selectRecalledFacts(snapshot(RETRIEVAL_K + 1), QUERY, {
      ...baseOptions(embed),
      priorReport: prior,
    });

    expect(embed.calls).toHaveLength(1);
    expect(result.report?.selectionActive).toBe(true);
    expect(result.report?.injectedMemoryIds).toHaveLength(RETRIEVAL_K);
  });
});
