/**
 * LLM provider-backend utilities — pure routing helpers for serving a
 * provider's models through an alternative cloud backend (GCP Vertex AI,
 * AWS Bedrock, Microsoft Foundry) instead of the provider's public API.
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
import { runnerSecretsEnvView } from "./runner-credential-store.js";

// ─── Backend selection ───────────────────────────────────────────────────────

/** Env var selecting where Anthropic models are served. */
export const ANTHROPIC_BACKEND_ENV = "STIGMER_ANTHROPIC_BACKEND";
/** Env var selecting where OpenAI models are served. */
export const OPENAI_BACKEND_ENV = "STIGMER_OPENAI_BACKEND";

/** Operator guide for backend configuration; the single copy of this URL. */
export const BACKEND_DOC_URL = "https://docs.stigmer.ai/guides/runners/model-backends";

/**
 * Backends implemented in this build. Anthropic's values name the serving
 * SERVICE, not the cloud (`foundry` is Microsoft Foundry, the Azure
 * service that hosts Claude — "azure" would collide with the unrelated
 * Azure OpenAI service). The design vocabulary also reserves `azure`
 * (OpenAI); until that adapter lands — contingent on OpenAI models
 * entering the native catalog — selecting it is a distinct "recognized
 * but not implemented" failure, never a silent fallback to the public
 * API, which would quietly route traffic outside the compliance boundary
 * the operator asked for.
 */
export type AnthropicBackend = "public" | "vertex" | "bedrock" | "foundry";
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
const PLANNED_ANTHROPIC: string[] = [];
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
    ["public", "vertex", "bedrock", "foundry"],
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

/** Operator override map: canonical id -> exact Bedrock id, consulted first. */
export const BEDROCK_MODEL_MAP_ENV = "STIGMER_BEDROCK_MODEL_MAP";
/** Inference-profile geography prefix (`us`, `eu`, `global`, …), no default. */
export const BEDROCK_INFERENCE_PREFIX_ENV = "STIGMER_BEDROCK_INFERENCE_PREFIX";

/**
 * Static prerequisite check for the bedrock backend, or null when satisfied.
 *
 * AWS_REGION is REQUIRED even though the Bedrock SDK would default it to
 * us-east-1 (pinned by bedrock-seam.test.ts): for a deployment-controlled
 * data-residency feature, silently routing model traffic to a US region on
 * a missing var is exactly the failure backends exist to prevent. Same
 * shape as vertex's CLOUD_ML_REGION requirement. Credentials are
 * deliberately NOT checked — the AWS chain (env keys, IRSA / instance
 * metadata, config files, AWS_BEARER_TOKEN_BEDROCK) legitimately resolves
 * at request time; requiring env keys would reject valid deployments.
 * Runtime credential failures get actionable classification in
 * `model-error.ts` instead.
 *
 * A malformed STIGMER_BEDROCK_MODEL_MAP is also fatal here: it is
 * deployment-static, and finding out at the first model call would fail
 * executions a boot check could have refused.
 */
export function checkBedrockPrerequisites(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!env.AWS_REGION?.trim()) {
    return (
      `The bedrock backend requires AWS_REGION (e.g. "ap-south-1"). It is ` +
      `required even though the AWS SDK would default to us-east-1 — a ` +
      `deployment that chose Bedrock for data residency must never fall ` +
      `back to another region silently. See ${BACKEND_DOC_URL}.`
    );
  }
  const map = parseBedrockModelMap(env);
  if (!map.ok) return map.message;
  return null;
}

type ModelMapParseResult =
  | { readonly ok: true; readonly map: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly message: string };

/**
 * Shared parser for the per-backend override maps: comma-separated
 * `canonical=target` pairs. Unset or blank parses to an empty map (the
 * backend's deterministic rule serves every model). Each env var keeps its
 * own single copy of the malformed-entry text through `form`/`example` —
 * preflight and translation surface the same string.
 */
function parseModelMap(
  envVar: string,
  raw: string | undefined,
  form: string,
  example: string,
): ModelMapParseResult {
  const trimmed = raw?.trim();
  const map = new Map<string, string>();
  if (!trimmed) return { ok: true, map };

  for (const entry of trimmed.split(",")) {
    const pair = entry.trim();
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const canonical = eq === -1 ? "" : pair.slice(0, eq).trim();
    const target = eq === -1 ? "" : pair.slice(eq + 1).trim();
    if (!canonical || !target) {
      return {
        ok: false,
        message:
          `${envVar} entry "${pair}" is not of the form ${form} ` +
          `(e.g. "${example}"). Entries are comma-separated. ` +
          `See ${BACKEND_DOC_URL}.`,
      };
    }
    map.set(canonical, target);
  }
  return { ok: true, map };
}

/**
 * Parse `STIGMER_BEDROCK_MODEL_MAP`: comma-separated `canonical=bedrockId`
 * pairs, e.g. "claude-sonnet-4-6=us.anthropic.claude-sonnet-4-6-v1:0".
 */
export function parseBedrockModelMap(
  env: NodeJS.ProcessEnv = process.env,
): ModelMapParseResult {
  return parseModelMap(
    BEDROCK_MODEL_MAP_ENV,
    env[BEDROCK_MODEL_MAP_ENV],
    "canonical=bedrockId",
    "claude-sonnet-4-6=us.anthropic.claude-sonnet-4-6-v1:0",
  );
}

// ─── Microsoft Foundry (Azure) ───────────────────────────────────────────────

/**
 * Operator override map: canonical id -> Foundry deployment name, consulted
 * first. Named DEPLOYMENT_MAP, not MODEL_MAP, because the target is Azure's
 * term of art — the operator-chosen deployment name, not another model id.
 */
export const FOUNDRY_DEPLOYMENT_MAP_ENV = "STIGMER_FOUNDRY_DEPLOYMENT_MAP";
/** The Foundry resource name (SDK-native; builds the endpoint host). */
export const FOUNDRY_RESOURCE_ENV = "ANTHROPIC_FOUNDRY_RESOURCE";
/** Full endpoint override (SDK-native; mutually exclusive with resource). */
export const FOUNDRY_BASE_URL_ENV = "ANTHROPIC_FOUNDRY_BASE_URL";

/**
 * Parse `STIGMER_FOUNDRY_DEPLOYMENT_MAP`: comma-separated
 * `canonical=deploymentName` pairs, e.g.
 * "claude-sonnet-4-6=my-sonnet-deployment".
 */
export function parseFoundryDeploymentMap(
  env: NodeJS.ProcessEnv = process.env,
): ModelMapParseResult {
  return parseModelMap(
    FOUNDRY_DEPLOYMENT_MAP_ENV,
    env[FOUNDRY_DEPLOYMENT_MAP_ENV],
    "canonical=deploymentName",
    "claude-sonnet-4-6=my-sonnet-deployment",
  );
}

/**
 * Static prerequisite check for the foundry backend, or null when satisfied.
 *
 * The endpoint is the ONE hard requirement checkable without I/O: the
 * Foundry SDK's constructor throws without exactly one of the resource
 * name or a full base URL, so both halves of its contract (missing AND
 * both-set) are refused here at boot with catalog messages instead of at
 * the first model call. Credentials are deliberately NOT checked —
 * ANTHROPIC_FOUNDRY_API_KEY is optional by design (without it the adapter
 * authenticates through Microsoft Entra ID via the Azure credential chain,
 * which resolves at request time exactly like Vertex ADC and the AWS
 * chain), so requiring it would reject correctly-configured keyless
 * deployments. Runtime credential failures get actionable classification
 * in `model-error.ts` instead.
 *
 * A malformed STIGMER_FOUNDRY_DEPLOYMENT_MAP is also fatal here: it is
 * deployment-static, and finding out at the first model call would fail
 * executions a boot check could have refused.
 */
export function checkFoundryPrerequisites(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const resource = env[FOUNDRY_RESOURCE_ENV]?.trim();
  const baseUrl = env[FOUNDRY_BASE_URL_ENV]?.trim();
  if (!resource && !baseUrl) {
    return (
      `The foundry backend requires ${FOUNDRY_RESOURCE_ENV} (your Microsoft ` +
      `Foundry resource name, e.g. "my-foundry-resource") or ` +
      `${FOUNDRY_BASE_URL_ENV} (the full endpoint, e.g. ` +
      `"https://my-foundry-resource.services.ai.azure.com/anthropic/"). ` +
      `See ${BACKEND_DOC_URL}.`
    );
  }
  if (resource && baseUrl) {
    return (
      `${FOUNDRY_RESOURCE_ENV} and ${FOUNDRY_BASE_URL_ENV} are mutually ` +
      `exclusive — the base URL is derived from the resource name. Set ` +
      `exactly one. See ${BACKEND_DOC_URL}.`
    );
  }
  const map = parseFoundryDeploymentMap(env);
  if (!map.ok) return map.message;
  return null;
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
  // Credential keys live in the runner credential store after the boot
  // capture (#508), so the default is the store view, not bare process.env.
  // The other checks in this module keep the process.env default: they read
  // deployment CONFIG (backend selection, regions), which is deliberately
  // not captured.
  env: NodeJS.ProcessEnv = runnerSecretsEnvView(),
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
    `${ANTHROPIC_BACKEND_ENV}=vertex, bedrock, or foundry), or connect to ` +
    `a Stigmer Cloud deployment. See ${BACKEND_DOC_URL}.`
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
  } else if (anthropic.backend === "bedrock") {
    const prereq = checkBedrockPrerequisites(env);
    if (prereq !== null) errors.push(prereq);
  } else if (anthropic.backend === "foundry") {
    const prereq = checkFoundryPrerequisites(env);
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

/**
 * Translate a canonical Anthropic API model id into Bedrock's form, in
 * three layers (approved design, T04) — each a deployment-level knob:
 *
 * 1. `STIGMER_BEDROCK_MODEL_MAP` override, consulted first: the escape
 *    hatch for ids the deterministic rule cannot derive (Bedrock ids for
 *    dateless canonicals may carry AWS-side snapshot dates we cannot know).
 * 2. `STIGMER_BEDROCK_INFERENCE_PREFIX` (e.g. "us", "eu", "global"),
 *    applied to the derived id. Newer Claude models on Bedrock are invoked
 *    through geography-prefixed inference profiles (AWS lists the base id's
 *    in-region endpoint as N/A) — but WHICH geography is a deployment
 *    decision (data residency), underivable from the model id, and never
 *    defaulted: a missing prefix yields the bare id, and if AWS rejects it
 *    with its "use an inference profile" error, model-error.ts translates
 *    that into "set ${BEDROCK_INFERENCE_PREFIX_ENV}".
 * 3. Deterministic rule: `anthropic.{canonical}-v1:0` — verified against
 *    AWS's model catalog for the registry's dated ids (e.g.
 *    claude-sonnet-4-5-20250929 -> anthropic.claude-sonnet-4-5-20250929-v1:0).
 *
 * Like the Vertex translation, the result is wire detail only: it rides in
 * the request URL and must never escape the adapter into usage metrics or
 * pricing, which key on the canonical id (the canonical-id invariant).
 *
 * Throws the catalog message on a malformed map — defense in depth for
 * paths that construct models without the factories; a normally-booted
 * runner already refused to start in `checkBedrockPrerequisites`.
 */
export function toBedrockModelId(
  apiModelId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const parsed = parseBedrockModelMap(env);
  if (!parsed.ok) throw new Error(parsed.message);
  const mapped = parsed.map.get(apiModelId);
  if (mapped !== undefined) return mapped;

  // Lenient on a trailing dot ("us." and "us" both read as intent).
  const prefix = env[BEDROCK_INFERENCE_PREFIX_ENV]?.trim().replace(/\.$/, "");
  const derived = `anthropic.${apiModelId}-v1:0`;
  return prefix ? `${prefix}.${derived}` : derived;
}

/**
 * Translate a canonical Anthropic API model id into a Microsoft Foundry
 * deployment name, in two layers (approved design, T05):
 *
 * 1. `STIGMER_FOUNDRY_DEPLOYMENT_MAP` override, consulted first: Foundry
 *    routes by DEPLOYMENT NAME, and the portal lets operators name
 *    deployments anything ("my-sonnet-deployment"). This is the escape
 *    hatch for those custom names.
 * 2. Deterministic rule: strip a trailing `-YYYYMMDD` snapshot date —
 *    Foundry's DEFAULT deployment names are the dateless Claude ids
 *    (claude-sonnet-4-5-20250929 -> claude-sonnet-4-5; dateless ids pass
 *    through unchanged). Verified against Anthropic's published Foundry
 *    model table: every native-catalog id maps onto a real default
 *    deployment name. Note this is the INVERSE of toVertexModelId, which
 *    keeps the date and reseparates it with `@`.
 *
 * Like the other translations, the result is wire detail only: it rides in
 * the request body's `model` field (Foundry keeps it in the body — see
 * foundry-seam.test.ts — unlike Vertex/Bedrock, which move it into the URL
 * path) and must never escape the adapter into usage metrics or pricing,
 * which key on the canonical id (the canonical-id invariant).
 *
 * Throws the catalog message on a malformed map — defense in depth for
 * paths that construct models without the factories; a normally-booted
 * runner already refused to start in `checkFoundryPrerequisites`.
 */
export function toFoundryDeploymentName(
  apiModelId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const parsed = parseFoundryDeploymentMap(env);
  if (!parsed.ok) throw new Error(parsed.message);
  const mapped = parsed.map.get(apiModelId);
  if (mapped !== undefined) return mapped;

  return apiModelId.replace(TRAILING_SNAPSHOT_DATE, "");
}
