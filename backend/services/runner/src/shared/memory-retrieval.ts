/**
 * Semantic selection of recalled memories (stigmer/stigmer#293 Phase 3a,
 * DD-008): when a subject's confirmed-fact set outgrows what wholesale
 * injection should carry, select the most relevant facts for THIS
 * execution instead of injecting everything.
 *
 * Sibling of recalled-memories.ts (which owns presentation) — this module
 * owns SELECTION: which subset of the server-composed candidate set
 * (`spec.recalled_memories`, the auditable snapshot both editions' compose
 * steps stamp) actually rides the prompt. The compose steps never change;
 * selection is a runner concern because the runner owns prompt assembly,
 * provider credentials, and the metered proxy lane (DD-008 D1 — the
 * titling-convergence doctrine: control-plane-adjacent LLM work runs once,
 * in the shared runner, for both editions).
 *
 * Mechanism (DD-008 D2/D3): embed-on-read, no stored vectors anywhere.
 * Selection activates ONLY above RETRIEVAL_K candidates; below that,
 * top-k degenerates to wholesale, so no embeddings call is made and the
 * shipped Phase 2 path runs untouched. When active: ONE batched
 * embeddings call (query + all candidates), in-process cosine ranking,
 * top-k by relevance, presented in snapshot order (relevance order would
 * carry no information the model needs and would churn the prompt prefix).
 * The query is the execution's `spec.message` — the current turn.
 *
 * The audit contract (DD-008 D5): the selection outcome is recorded in a
 * runner-owned `RecalledMemoriesReport` on the execution status (the
 * streaming_usage posture — one writer, written at prompt build). A report
 * is returned whenever facts are injected, wholesale or selected; when
 * nothing is injected (recall absent/disabled/empty) there is no report —
 * absent report = wholesale, true by construction, so pre-3a executions
 * read identically.
 *
 * Written-once across re-invocations: the same execution's prompt is
 * rebuilt on approval resume (native) and fresh-agent recovery (cursor).
 * Re-running selection there could pick a DIFFERENT subset mid-execution —
 * so when the loaded execution already carries a report, this module
 * REPLAYS it (selected ids resolved against the snapshot, or wholesale
 * for a selection_active=false report) instead of re-embedding. Selection
 * is computed at most once per execution, by construction.
 *
 * Failure posture: selection is an optimization. ANY failure — no
 * embedder, HTTP error, timeout, malformed response — degrades to
 * wholesale injection with a selection_active=false report, never a
 * failed or degraded execution (DD-008 D3). Deployments with no
 * embeddings-capable credential (Anthropic-only, Cursor-only OSS) run
 * Phase 2 behavior unchanged, forever.
 */

import { create } from "@bufbuild/protobuf";
import type { RecalledMemories } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  RecalledMemoriesReportSchema,
  type RecalledMemoriesReport,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { RecalledMemoriesContent } from "./recalled-memories.js";
import { resolveProxyBaseUrl, buildProxyHeaders } from "./llm-proxy.js";
import { checkDirectCredentials } from "./llm-backend.js";
import { getRunnerSecret } from "./runner-credential-store.js";

/**
 * Selection activates only when the candidate set EXCEEDS this many facts;
 * at or below it, top-k degenerates to wholesale and no embeddings call is
 * made. 20 is comfortably above the dozens-scale where wholesale is fine
 * (activation is rare) and comfortably below the 100-record cap (activation
 * is meaningful): at 500-char facts, 20 facts ≈ 10KB of prompt. One
 * constant, one place, deliberately not adaptive or per-org configurable
 * in v1 (DD-008 D3).
 */
export const RETRIEVAL_K = 20;

/**
 * The v1 embedder (DD-008 D4). OpenAI-only: resolved through the Stigmer
 * proxy when one is configured (cloud — platform key, metered), else the
 * operator's direct OpenAI key (OSS). NOTE: llm-proxy's `inferProvider`
 * does not know the `text-*` prefix — this module never infers; the
 * provider is fixed alongside the model.
 */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Upper bound on the query text sent to the embedder. Facts are write-time
 * capped at 500 chars, but the query is `spec.message` — unbounded. A giant
 * pasted message would blow the embedder's per-input token limit (8192 for
 * text-embedding-3-small) and 400 the WHOLE batched call, silently forcing
 * wholesale on exactly the executions where selection matters. 20K chars
 * sits safely under the limit at worst-case chars-per-token; selection
 * intent is dominated by the message head, and a truncated query beats no
 * selection.
 */
export const QUERY_MAX_CHARS = 20_000;

/**
 * Bound on the single embeddings round trip. Generous relative to the
 * observed 200–400ms typical latency: this exists to keep a hung
 * connection from stalling prompt build, not to race the provider.
 */
const EMBED_TIMEOUT_MS = 15_000;

/** The OpenAI SDK-default base, used only in direct (unproxied) mode. */
const DIRECT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * One batched embeddings call: one vector per input, in input order.
 * The seam unit tests inject through, and the boundary a stored-vector
 * optimization would slot behind if caps ever grow (DD-008 D2).
 */
export type EmbedFn = (inputs: readonly string[]) => Promise<number[][]>;

export interface MemoryRetrievalOptions {
  /** Null/undefined when the deployment has no proxy (direct mode). */
  readonly proxyEndpoint: string | null | undefined;
  /** Bearer for proxy mode; unused in direct mode. */
  readonly stigmerToken: string | null | undefined;
  /** Scopes the proxied call for FGA authorization and billing attribution. */
  readonly executionId: string;
  /**
   * The report a PREVIOUS invocation of this same execution recorded, if
   * any (`execution.status.recalled_memories_report`). Presence replays
   * the recorded outcome instead of re-selecting — the written-once rule.
   */
  readonly priorReport?: RecalledMemoriesReport;
  /** Test seam; defaults to the proxy/direct embedder resolution. */
  readonly embed?: EmbedFn;
}

export interface MemorySelectionResult {
  /**
   * The facts to inject, in snapshot order — undefined when recall is
   * absent, disabled, or empty (render nothing, exactly the
   * readRecalledMemories contract).
   */
  readonly content: RecalledMemoriesContent | undefined;
  /**
   * The injection outcome to stamp on the execution status. Undefined
   * exactly when `content` is undefined: no injection, no report.
   */
  readonly report: RecalledMemoriesReport | undefined;
}

/** A candidate fact: the snapshot entry with its audit identity intact. */
interface Candidate {
  readonly memoryId: string;
  readonly content: string;
}

/**
 * Select the facts to inject for one execution.
 *
 * This is the ONE entry point both harnesses call at prompt build, replacing
 * their direct `readRecalledMemories` reads on the injection path (the read
 * function remains the presentation-side authority; this module reads the
 * proto itself because selection needs `memory_id`, which the render
 * boundary deliberately strips).
 *
 * Never throws: every failure path returns wholesale.
 */
export async function selectRecalledFacts(
  recalled: RecalledMemories | undefined,
  queryText: string,
  options: MemoryRetrievalOptions,
): Promise<MemorySelectionResult> {
  const candidates = readCandidates(recalled);
  if (candidates.length === 0) {
    return { content: undefined, report: undefined };
  }

  // Written-once: a prior invocation of this execution already decided.
  if (options.priorReport !== undefined) {
    const replayed = replayReport(candidates, options.priorReport);
    if (replayed !== undefined) {
      return replayed;
    }
    // Unreplayable (recorded ids missing from the immutable snapshot —
    // structurally impossible, defended anyway): fall through and select
    // fresh rather than inject nothing.
    log(
      `prior report for execution ${options.executionId} did not resolve ` +
      `against the snapshot; re-selecting`,
    );
  }

  if (candidates.length <= RETRIEVAL_K) {
    return wholesale(candidates);
  }

  const embed = options.embed ?? resolveEmbedder(options);
  if (embed === undefined) {
    // No embeddings-capable credential: the recorded no-embedder posture
    // (DD-008 D4) — Phase 2 behavior, honestly reported.
    return wholesale(candidates);
  }

  try {
    const query = queryText.slice(0, QUERY_MAX_CHARS);
    const vectors = await embed([query, ...candidates.map((c) => c.content)]);
    if (vectors.length !== candidates.length + 1) {
      throw new Error(
        `embedder returned ${vectors.length} vectors for ` +
        `${candidates.length + 1} inputs`,
      );
    }
    const [queryVector, ...factVectors] = vectors;
    const selected = topKBySimilarity(queryVector, factVectors, RETRIEVAL_K);
    return {
      content: { facts: selected.map((i) => candidates[i].content) },
      report: create(RecalledMemoriesReportSchema, {
        selectionActive: true,
        injectedMemoryIds: selected.map((i) => candidates[i].memoryId),
        embeddingModel: EMBEDDING_MODEL,
      }),
    };
  } catch (err) {
    log(
      `selection failed for execution ${options.executionId}, degrading to ` +
      `wholesale: ${err instanceof Error ? err.message : String(err)}`,
    );
    return wholesale(candidates);
  }
}

/**
 * The snapshot's renderable candidates, in snapshot order. Same semantics
 * as readRecalledMemories (disabled → none; blank contents dropped
 * defensively) but keeping `memory_id` — the report's audit link.
 */
function readCandidates(recalled: RecalledMemories | undefined): Candidate[] {
  if (!recalled?.enabled) {
    return [];
  }
  return (recalled.facts ?? [])
    .map((fact) => ({
      memoryId: fact.memoryId ?? "",
      content: fact.content?.trim() ?? "",
    }))
    .filter((c) => c.content !== "");
}

/**
 * Replay a previously recorded outcome so a re-invocation injects exactly
 * what the first invocation did. A selection_active=false report replays
 * as wholesale (including the case where a transient embed failure was
 * recorded — retrying could select a subset and diverge the prompt).
 * Returns undefined when a recorded id no longer resolves.
 */
function replayReport(
  candidates: Candidate[],
  prior: RecalledMemoriesReport,
): MemorySelectionResult | undefined {
  if (!prior.selectionActive) {
    return wholesale(candidates);
  }
  const byId = new Map(candidates.map((c) => [c.memoryId, c.content]));
  const facts: string[] = [];
  for (const id of prior.injectedMemoryIds) {
    const content = byId.get(id);
    if (content === undefined) {
      return undefined;
    }
    facts.push(content);
  }
  if (facts.length === 0) {
    return undefined;
  }
  return { content: { facts }, report: prior };
}

/** Wholesale injection of the full candidate set, honestly reported. */
function wholesale(candidates: Candidate[]): MemorySelectionResult {
  return {
    content: { facts: candidates.map((c) => c.content) },
    report: create(RecalledMemoriesReportSchema, { selectionActive: false }),
  };
}

/**
 * The credential lanes, in the platform's standing precedence (the
 * titling-lane idiom): proxy when configured — the runner authenticates
 * with its Stigmer token and the proxy owns the provider key — else the
 * operator's direct OpenAI key, else no embedder.
 */
function resolveEmbedder(options: MemoryRetrievalOptions): EmbedFn | undefined {
  if (options.proxyEndpoint) {
    return fetchEmbedder(
      resolveProxyBaseUrl(options.proxyEndpoint, "openai"),
      buildProxyHeaders(options.stigmerToken ?? "", {
        executionId: options.executionId,
      }),
    );
  }
  if (checkDirectCredentials("openai") === null) {
    return fetchEmbedder(DIRECT_OPENAI_BASE_URL, {
      Authorization: `Bearer ${getRunnerSecret("OPENAI_API_KEY") ?? ""}`,
    });
  }
  return undefined;
}

/**
 * The real embedder: one POST {base}/embeddings. A plain typed fetch, not
 * LangChain's OpenAIEmbeddings — the SDK wrapper discards the response
 * `usage` block and adds nothing over a single request. Proxy-side
 * metering reads the JSON usage from the relayed body.
 */
function fetchEmbedder(baseUrl: string, headers: Record<string, string>): EmbedFn {
  return async (inputs) => {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `embeddings request failed: HTTP ${response.status} ${body.slice(0, 300)}`,
      );
    }
    const parsed = (await response.json()) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
    };
    if (!Array.isArray(parsed.data)) {
      throw new Error("embeddings response carries no data array");
    }
    // Place by the response's own index field — the API documents input
    // order, but the contract names the index as authoritative.
    const vectors: number[][] = new Array(inputs.length);
    for (const item of parsed.data) {
      const index = item.index ?? -1;
      if (index < 0 || index >= inputs.length || !Array.isArray(item.embedding)) {
        throw new Error("embeddings response entry is malformed");
      }
      vectors[index] = item.embedding;
    }
    if (vectors.some((v) => v === undefined)) {
      throw new Error("embeddings response is missing entries");
    }
    return vectors;
  };
}

/**
 * Indices of the top-k facts by cosine similarity to the query, returned
 * ASCENDING — i.e. re-sorted to snapshot order (DD-008 D3: selection is by
 * relevance, presentation stays oldest-first). Ties break toward the lower
 * snapshot index, so equal scores never reorder across invocations.
 */
function topKBySimilarity(
  queryVector: number[],
  factVectors: number[][],
  k: number,
): number[] {
  return factVectors
    .map((vector, index) => ({ index, score: cosineSimilarity(queryVector, vector) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, k)
    .map((entry) => entry.index)
    .sort((a, b) => a - b);
}

/**
 * Plain cosine. OpenAI embeddings arrive unit-normalized (a dot product
 * would suffice today), but normalizing here keeps ranking correct under
 * any future embedder without a silent provider assumption.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function log(msg: string): void {
  console.warn(`[memory-retrieval] ${msg}`);
}
