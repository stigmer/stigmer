/**
 * LLM provider-backend utilities — pure routing helpers for serving a
 * provider's models through an alternative cloud backend (GCP Vertex AI,
 * and later AWS Bedrock / Azure OpenAI) instead of the provider's public API.
 *
 * Layering mirrors `llm-proxy.ts`: this module is pure string/config
 * utilities with no LangChain or SDK dependency. Consumers: the runner
 * factories run `preflightLlmBackends` at startup, and `model-client.ts`
 * resolves the backend and translates model ids at construction time; see
 * `__tests__/vertex-seam.test.ts` for the pinned seam behavior.
 *
 * Design decision record: stigmer-cloud
 * `_projects/2026-08/20260809.01.multi-cloud-llm-provider-endpoints/`
 * `design-decisions/001-provider-backends.md`.
 */

import type { LlmProvider } from "./llm-proxy.js";

// ─── Backend selection ───────────────────────────────────────────────────────

/** Env var selecting where Anthropic models are served. */
export const ANTHROPIC_BACKEND_ENV = "STIGMER_ANTHROPIC_BACKEND";
/** Env var selecting where OpenAI models are served. */
export const OPENAI_BACKEND_ENV = "STIGMER_OPENAI_BACKEND";

/** Operator guide for backend configuration; the single copy of this URL. */
export const BACKEND_DOC_URL = "https://docs.stigmer.ai/guides/runners/model-backends";

/**
 * Backends implemented in this build. The design vocabulary also reserves
 * `bedrock` (Anthropic) and `azure` (OpenAI); until those adapters land,
 * selecting them is a distinct "recognized but not implemented" failure —
 * never a silent fallback to the public API, which would quietly route
 * traffic outside the compliance boundary the operator asked for.
 */
export type AnthropicBackend = "public" | "vertex";
export type OpenAiBackend = "public";

/**
 * Result of parsing a backend env var. `message` is the operator-facing
 * text; it names the exact var, the bad value, and what is supported, and
 * is the single copy of that text (preflight, model construction, and any
 * future consumer all surface this same string).
 */
export type BackendParseResult<B> =
  | { readonly ok: true; readonly backend: B }
  | { readonly ok: false; readonly message: string };

/** Planned-but-unshipped values get a "not in this build" message. */
const PLANNED_ANTHROPIC = ["bedrock"];
const PLANNED_OPENAI = ["azure"];

function parseBackend<B extends string>(
  envVar: string,
  raw: string | undefined,
  supported: readonly B[],
  planned: readonly string[],
): BackendParseResult<B> {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") {
    // Unset means the provider's public API — the zero-config default.
    return { ok: true, backend: "public" as B };
  }
  if ((supported as readonly string[]).includes(value)) {
    return { ok: true, backend: value as B };
  }
  if (planned.includes(value)) {
    return {
      ok: false,
      message:
        `${envVar}="${value}" is not implemented in this build yet. ` +
        `Supported today: ${supported.join(", ")}. See ${BACKEND_DOC_URL}.`,
    };
  }
  return {
    ok: false,
    message:
      `${envVar}="${raw?.trim()}" is not a supported backend. ` +
      `Supported: ${supported.join(", ")}. See ${BACKEND_DOC_URL}.`,
  };
}

/** Parse `STIGMER_ANTHROPIC_BACKEND` (unset → `public`). */
export function parseAnthropicBackend(
  env: NodeJS.ProcessEnv = process.env,
): BackendParseResult<AnthropicBackend> {
  return parseBackend(
    ANTHROPIC_BACKEND_ENV,
    env[ANTHROPIC_BACKEND_ENV],
    ["public", "vertex"],
    PLANNED_ANTHROPIC,
  );
}

/** Parse `STIGMER_OPENAI_BACKEND` (unset → `public`). */
export function parseOpenAiBackend(
  env: NodeJS.ProcessEnv = process.env,
): BackendParseResult<OpenAiBackend> {
  return parseBackend(
    OPENAI_BACKEND_ENV,
    env[OPENAI_BACKEND_ENV],
    ["public"],
    // `vertex`/`bedrock` under the OpenAI var are wrong-provider values, not
    // planned ones — they fall through to the unsupported-value message.
    PLANNED_OPENAI,
  );
}

/**
 * Resolve the Anthropic backend for model construction, throwing the
 * parser's message on an invalid value.
 *
 * The runner factories run {@link preflightLlmBackends} at startup, so in a
 * normally-booted process this never throws — the throw is defense in depth
 * for paths that construct models without the factories (tests, direct
 * library use), keeping "invalid value" impossible to ride past silently.
 */
export function resolveAnthropicBackend(
  env: NodeJS.ProcessEnv = process.env,
): AnthropicBackend {
  const parsed = parseAnthropicBackend(env);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.backend;
}

/**
 * Static prerequisite check for the vertex backend, or null when satisfied.
 *
 * Region is the ONE hard requirement checkable without I/O: the Vertex SDK
 * throws without it. Project id and credentials are deliberately NOT
 * checked here — both are legitimately resolvable at request time from
 * Application Default Credentials (workload identity, metadata server,
 * gcloud login), so requiring env vars for them would reject perfectly
 * valid GCP deployments. Runtime credential failures get actionable
 * classification in `model-error.ts` instead.
 */
export function checkVertexPrerequisites(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.CLOUD_ML_REGION?.trim()) return null;
  return (
    `The vertex backend requires CLOUD_ML_REGION (e.g. "asia-south1", or ` +
    `"global" for the global endpoint). See ${BACKEND_DOC_URL}.`
  );
}

/**
 * Check that direct-mode (unproxied) calls to `provider` have a usable
 * credential path, or return the operator message describing what is
 * missing. Null means "a request can authenticate":
 *
 * - `anthropic`: a non-blank `ANTHROPIC_API_KEY`, or any non-public backend
 *   (vertex authenticates through Application Default Credentials, and
 *   `ChatAnthropic` waives its API-key requirement when `createClient` is
 *   supplied — pinned by vertex-seam.test.ts).
 * - `openai`: a non-blank `OPENAI_API_KEY`. The message deliberately offers
 *   no backend remedy until the azure adapter ships — advertising
 *   STIGMER_OPENAI_BACKEND today would point the operator at a value that
 *   fails with "not implemented in this build".
 *
 * An invalid backend value also returns null: `resolveAnthropicBackend` at
 * model construction owns that condition's precise catalog message, and
 * reporting it here too would create a second copy that can drift.
 *
 * This is the single copy of the "do we have a credential?" question. The
 * reaction stays with each caller, because the right one differs per site:
 * `call-llm.ts` raises a non-retryable LLM_MISSING_API_KEY, tool
 * classification fails closed (every tool gated), and Cursor tier-2
 * extraction skips to "no structured output". Callers consult it only when
 * no proxy is configured — a proxied deployment authenticates with
 * STIGMER_TOKEN and holds no provider credentials at all.
 */
export function checkDirectCredentials(
  provider: LlmProvider,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (provider === "openai") {
    if (env.OPENAI_API_KEY?.trim()) return null;
    return (
      `OPENAI_API_KEY is not set and no proxy is configured. Set the API ` +
      `key in your environment or connect to a Stigmer Cloud deployment. ` +
      `See ${BACKEND_DOC_URL}.`
    );
  }
  if (env.ANTHROPIC_API_KEY?.trim()) return null;
  const parsed = parseAnthropicBackend(env);
  if (!parsed.ok || parsed.backend !== "public") return null;
  return (
    `ANTHROPIC_API_KEY is not set, no model backend is configured, and no ` +
    `proxy is configured. Set the API key, configure a backend (e.g. ` +
    `${ANTHROPIC_BACKEND_ENV}=vertex), or connect to a Stigmer Cloud ` +
    `deployment. See ${BACKEND_DOC_URL}.`
  );
}

export interface LlmBackendPreflight {
  /** Fatal, actionable operator message; null when the config is usable. */
  readonly error: string | null;
  /** Non-fatal operator notices (e.g. proxy overrides backend selection). */
  readonly warnings: readonly string[];
}

/**
 * Validate the deployment's backend configuration once, at startup.
 *
 * Called by the runner factories (`createStigmerRunner` /
 * `createStigmerRunnerManager`) — the construction boundary every entry
 * path shares (static, pool, and manager modes in main.ts, plus in-process
 * embedders of `@stigmer/runner`) — so a misconfigured deployment refuses
 * to accept work instead of failing every execution mid-flight. Mirrors the
 * `preflightNodeRuntime` pattern: pure check in, operator message out.
 *
 * Precedence rule: when `STIGMER_PROXY_ENDPOINT` is set the proxy owns
 * provider routing and backend vars are inert, so they downgrade to
 * warnings (never silence, but never fail a proxied fleet over an ignored
 * var either). Without a proxy, invalid values and missing prerequisites
 * are fatal.
 */
export function preflightLlmBackends(
  env: NodeJS.ProcessEnv = process.env,
): LlmBackendPreflight {
  const proxySet = !!env.STIGMER_PROXY_ENDPOINT?.trim();

  if (proxySet) {
    const warnings: string[] = [];
    for (const envVar of [ANTHROPIC_BACKEND_ENV, OPENAI_BACKEND_ENV]) {
      const raw = env[envVar]?.trim();
      if (raw && raw.toLowerCase() !== "public") {
        warnings.push(
          `STIGMER_PROXY_ENDPOINT is set; ${envVar}=${raw} is ignored — ` +
          `the proxy owns provider routing.`,
        );
      }
    }
    return { error: null, warnings };
  }

  const errors: string[] = [];
  const anthropic = parseAnthropicBackend(env);
  if (!anthropic.ok) {
    errors.push(anthropic.message);
  } else if (anthropic.backend === "vertex") {
    const prereq = checkVertexPrerequisites(env);
    if (prereq !== null) errors.push(prereq);
  }
  const openai = parseOpenAiBackend(env);
  if (!openai.ok) errors.push(openai.message);

  return { error: errors.length > 0 ? errors.join("\n") : null, warnings: [] };
}

// ─── Model-id translation ────────────────────────────────────────────────────

/**
 * Matches a registry `apiModelId` that ends in a pre-4.6 snapshot date
 * (`-YYYYMMDD`), e.g. "claude-sonnet-4-5-20250929".
 */
const TRAILING_SNAPSHOT_DATE = /-(\d{8})$/;

/**
 * Translate a canonical Anthropic API model id into Vertex AI's form.
 *
 * The model registry serves two id shapes, and Vertex treats them
 * differently (platform.claude.com "Model IDs and versions"):
 *
 * - Pre-4.6 models carry a snapshot date, and Vertex separates it with `@`
 *   instead of `-`: "claude-sonnet-4-5-20250929" -> "claude-sonnet-4-5@20250929".
 * - 4.6-generation and later ids are dateless AND canonical on every
 *   platform: "claude-sonnet-4-6" is used verbatim on Vertex. Appending a
 *   date to them 404s — a real bug shipped by other integrations (Dify
 *   langgenius/dify-official-plugins#2905, Roo-Code #11625) — so dateless
 *   ids MUST pass through untouched.
 *
 * The translated id is Vertex wire detail only: it goes into the request
 * URL path and must never escape the adapter into usage metrics or pricing,
 * which key on the canonical id (the canonical-id invariant in the design
 * decision record).
 *
 * Already-translated ids (`name@date`) and Bedrock-shaped ids
 * (`anthropic.…-v1:0`) don't match the trailing-date pattern, so a second
 * pass is a no-op by construction.
 */
export function toVertexModelId(apiModelId: string): string {
  return apiModelId.replace(TRAILING_SNAPSHOT_DATE, "@$1");
}
