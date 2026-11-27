/**
 * Single construction point for LangChain chat models in the runner.
 *
 * This is the only place that translates a Stigmer registry model ID
 * (dot-notation, e.g. "claude-haiku-4.5") into the provider's API model ID
 * (e.g. "claude-haiku-4-5-20251001") before a client is built — so no
 * activity can bypass the translation and 404 the provider.
 *
 * Layering: `llm-proxy.ts` and `llm-backend.ts` stay pure routing utilities
 * (no LangChain dependency); this module is the LangChain-aware layer above
 * them that owns the resolve -> infer-provider -> strip-prefix ->
 * proxy-or-backend-wire -> construct sequence once, for every LLM activity.
 *
 * In the agent host, a direct-mode client keeps its shape and swaps only
 * its transport: its base URL is a provider lane of the runner's local
 * proxy and its credential the host's token (`model-lanes.ts`). Nothing
 * else here knows the difference.
 *
 * Where a call goes and what it carries is decided once, for every
 * provider ({@link transportFor}); each provider then has one constructor
 * ({@link buildAnthropic}, {@link buildOpenAi}, {@link buildGoogle}), chosen
 * by an exhaustive switch, so a provider added to `llm-proxy.ts` is a
 * compile error here until it has one.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { FailedAttemptHandler } from "@langchain/core/utils/async_caller";
import { ServiceTier } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import {
  inferProvider,
  stripProviderPrefix,
  resolveProxyBaseUrl,
  buildProxyHeaders,
  LLM_PROVIDERS,
  type LlmProvider,
} from "./llm-proxy.js";
import {
  resolveAnthropicBackend,
  resolveAnthropicBaseUrl,
  checkVertexPrerequisites,
  checkBedrockPrerequisites,
  checkFoundryPrerequisites,
  toVertexModelId,
  toBedrockModelId,
  toFoundryDeploymentName,
  type AnthropicBackend,
} from "./llm-backend.js";
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_AWS_BEDROCK,
  PROVIDER_AZURE_AI_INFERENCE,
  PROVIDER_GCP_GEMINI,
  PROVIDER_GCP_VERTEX_AI,
  PROVIDER_OPENAI,
} from "../gen-ai-conventions.js";
import { GEMINI_API_ENDPOINT, GEMINI_API_VERSION, googleTransport } from "./google-transport.js";
import { toAnthropicThinking, toGoogleThinking, type ThinkingRequest } from "./thinking-mode.js";
import { resolveToApiModelId } from "./model-registry.js";
import { recordChatModelFacts } from "./model-facts.js";
import {
  toAnthropicServiceTier,
  toOpenAiServiceTier,
  type EffectiveServiceTier,
} from "./service-tier.js";
import { getRunnerSecret } from "./runner-credential-store.js";
import { VERTEX_LANE_PROJECT, modelLaneUrl, modelLanes, type ModelLanes } from "./model-lanes.js";
import { MODEL_REQUEST_RETRIES, modelRequestFailed, modelRequestFailedWholeReplyBound } from "./model-retry.js";

export interface BuildChatModelOptions {
  /** Registry id ("claude-haiku-4.5"), "provider:model", or a provider API id. */
  readonly modelName: string;
  /** When set, requests route through the Stigmer proxy at the provider path. */
  readonly proxyEndpoint?: string;
  readonly stigmerToken?: string;
  /** Scope headers for proxy FGA/billing attribution. */
  readonly headerScope?: {
    executionId?: string;
    mcpServerId?: string;
  };
  /**
   * Defaults to 0. `null` sends no sampling override at all, so the
   * provider's default applies: the Stigmer harness's execution turn passes it,
   * because current Anthropic models refuse a temperature other than their
   * default (claude-opus-4.7 and later, claude-sonnet-5, claude-fable-5;
   * @langchain/anthropic throws before the request for some of them)
   * (stigmer/stigmer#1341). Utility
   * calls keep their deterministic 0.
   */
  readonly temperature?: number | null;
  /**
   * Pass-through only; intentionally no default. Anthropic requires a value,
   * but callers differ (the execution turn reads the registry row's
   * maxOutputTokens, structured extraction uses 4096), so the default
   * stays the caller's decision to avoid silently changing behavior.
   */
  readonly maxTokens?: number;
  /**
   * Stream every request. The Anthropic SDK refuses a non-streaming request
   * whose max_tokens implies more than ten minutes (about 21k tokens) unless
   * a timeout is set, and STIGMER_LLM_REQUEST_TIMEOUT_MS is unset by default;
   * a caller that raises maxTokens to a model's full output ceiling sets
   * this so no call path (a middleware's own invoke, a summary) can meet
   * that refusal. The agent loop already streams through streamEvents.
   */
  readonly streaming?: boolean;
  /**
   * Per-attempt bound: the SDKs arm it around the fetch and clear it when
   * the response headers arrive. A streamed reply's headers come first, so
   * there it bounds only the wait for the reply to begin, and a timed-out
   * attempt is retried like any other dropped connection; a reply that does
   * not stream sends its headers after the whole generation, so there it
   * bounds the whole reply, and a timed-out attempt is not retried
   * (`model-retry.ts` `modelRequestFailedWholeReplyBound`). When omitted,
   * defaults to the operator's STIGMER_LLM_REQUEST_TIMEOUT_MS — resolved
   * HERE, not per caller, so no call site can drop the bound by forgetting
   * to plumb it (the sub-agent factory did exactly that;
   * stigmer/stigmer#468). An explicit value wins.
   */
  readonly timeoutMs?: number;
  /**
   * The execution's EFFECTIVE service tier (stigmer/stigmer#361) — already
   * resolved by the caller (resolveEffectiveServiceTier), never
   * UNSPECIFIED. When set, every provider request pins its tier explicitly
   * (OpenAI `service_tier`; Anthropic `service_tier` via invocationKwargs)
   * so the provider ACCOUNT's default can never pick the price — the #357
   * contract, held on the Stigmer harness. Deliberately optional:
   * platform-internal utility calls (tool-approval classification, session
   * subjects, structured extraction) are not the
   * execution's own turns and send no tier — the provider treats an absent
   * parameter as its standard behavior, and those calls' models are
   * platform-chosen economy models.
   */
  readonly serviceTier?: EffectiveServiceTier;
  /**
   * The execution's effective thinking mode and the model's Stigmer
   * registry row, mapped here to the provider's own parameter
   * (thinking-mode.ts): Anthropic's `thinking`, sent on every Anthropic
   * backend alike (both forms exist on the public API, Vertex, Bedrock and
   * Foundry, unlike the tier), and Google's `thinkingConfig`. A request that
   * would ask an OpenAI model to think is refused rather than dropped: OpenAI
   * has no thinking mapping on the Stigmer harness, and a silently ignored
   * mode is the #357 class of defect. Omitted, the request carries no
   * thinking parameter (utility calls).
   */
  readonly thinking?: ThinkingRequest;
}

/**
 * The operator's request-timeout bound. Only a positive integer means
 * "bound the request" — unset, non-numeric, zero, and negative all
 * normalize to no bound. Deployment-static env, read here the same way
 * provider API keys are.
 */
function resolveDefaultTimeoutMs(): number | undefined {
  const parsed = Number.parseInt(process.env.STIGMER_LLM_REQUEST_TIMEOUT_MS ?? "", 10);
  return parsed > 0 ? parsed : undefined;
}

export interface BuiltChatModel {
  readonly model: BaseChatModel;
  readonly provider: LlmProvider;
  /**
   * The canonical provider API id the registry resolved to — what pricing
   * and usage metrics key on. A backend adapter may translate it for the
   * wire (Vertex separates the snapshot date with `@`), but the translated
   * form never leaves the adapter: this field stays canonical.
   */
  readonly apiModelId: string;
}

/**
 * Build a configured chat model, resolving the registry id to a provider API
 * id first. The resolution MUST precede provider inference and prefix
 * stripping — that ordering is the invariant each per-site copy kept dropping,
 * surfacing as `404 model: claude-haiku-4.5` at the provider.
 */
export async function buildChatModel(opts: BuildChatModelOptions): Promise<BuiltChatModel> {
  const resolved = await resolveToApiModelId(opts.modelName);
  const provider = inferProvider(resolved);
  const apiModelId = stripProviderPrefix(resolved);
  const timeoutMs = opts.timeoutMs ?? resolveDefaultTimeoutMs();

  // Lanes stand in for every direct-mode credential; never with a proxy,
  // which carries its own (`model-lanes.ts`).
  const lanes = opts.proxyEndpoint ? undefined : modelLanes();

  // LangChain's client retry is the one loop for a request that fails,
  // with the runner's classification in place of LangChain's
  // (`model-retry.ts`), bound or no bound. Every model built here carries
  // it: the turn's, each sub-agent's, structured extraction's and session
  // subjects'. Under a bound, a model whose reply does not stream stops on a
  // timed-out attempt (the `timeoutMs` field says why).
  const retry: RetryFields = {
    maxRetries: MODEL_REQUEST_RETRIES,
    onFailedAttempt: timeoutMs !== undefined && !opts.streaming ? modelRequestFailedWholeReplyBound : modelRequestFailed,
  };
  const context: BuildContext = { opts, apiModelId, timeoutMs, lanes, retry };

  let built: { readonly model: BaseChatModel; readonly providerName: string };
  switch (provider) {
    case "anthropic":
      built = await buildAnthropic(context);
      break;
    case "openai":
      built = buildOpenAi(context);
      break;
    case "google":
      built = await buildGoogle(context);
      break;
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no provider reaches it */
    default: {
      const exhaustive: never = provider;
      throw new Error(`buildChatModel: no constructor for provider ${String(exhaustive)}`);
    }
    /* v8 ignore stop */
  }

  recordChatModelFacts(built.model, {
    providerName: built.providerName,
    requestModel: opts.modelName,
    responseModel: apiModelId,
  });
  return { model: built.model, provider, apiModelId };
}

/** LangChain's own retry knobs, constructor-level on every wrapper. */
interface RetryFields {
  readonly maxRetries: number;
  readonly onFailedAttempt: FailedAttemptHandler;
}

/** What every provider's constructor is built from. */
interface BuildContext {
  readonly opts: BuildChatModelOptions;
  readonly apiModelId: string;
  readonly timeoutMs: number | undefined;
  readonly lanes: ModelLanes | undefined;
  readonly retry: RetryFields;
}

/** Where a model's requests go and what they carry. */
interface Transport {
  /** The provider client's base URL; `undefined` keeps the client's own. */
  readonly baseUrl: string | undefined;
  /** Headers every request carries beside the credential: the Stigmer scope headers. */
  readonly headers: Record<string, string> | undefined;
  /** The client's credential: the run's Stigmer token, the host's lane token, or the operator's key. */
  readonly apiKey: string;
  /** Whether the request goes to a Stigmer endpoint (the platform's proxy or a local lane) rather than the provider. */
  readonly viaStigmer: boolean;
}

/**
 * Where one provider's requests go, for every provider alike:
 *
 *  - Through the platform's proxy (`proxyEndpoint`): the provider's proxy
 *    path, the run's Stigmer token and the scope headers. A proxied call
 *    never consults a backend: the proxy owns provider routing (the
 *    factories' preflight warns when both are configured).
 *  - Through a lane of the runner's local proxy, in the agent host: the
 *    provider's lane and the host's token, except an Anthropic cloud
 *    backend, whose adapter reaches its own lane (`buildAnthropic`).
 *  - To the provider: the operator's key, resolved from the credential
 *    store (the boot capture moved it out of process.env, #508). Only the
 *    public Anthropic backend takes an operator-set address
 *    (ANTHROPIC_BASE_URL: a gateway in front of Anthropic, or the install
 *    journeys' fake model); the backend adapters reach their own cloud
 *    endpoints, OpenAI keeps its default, and Google's client is always
 *    handed its API's address, which keeps it from rerouting itself through
 *    a gateway named in the environment.
 */
function transportFor(provider: LlmProvider, anthropicBackend: AnthropicBackend, context: BuildContext): Transport {
  const { opts, lanes } = context;
  const scope = opts.headerScope ?? {};
  if (opts.proxyEndpoint) {
    return {
      baseUrl: resolveProxyBaseUrl(opts.proxyEndpoint, provider),
      headers: opts.stigmerToken ? buildProxyHeaders(opts.stigmerToken, scope) : undefined,
      apiKey: opts.stigmerToken ?? "proxy-managed",
      viaStigmer: true,
    };
  }
  const providerServed = provider !== "anthropic" || anthropicBackend === "public";
  if (lanes) {
    return {
      baseUrl: providerServed ? modelLaneUrl(lanes, provider) : undefined,
      headers: providerServed ? buildProxyHeaders(lanes.token, scope) : undefined,
      apiKey: lanes.token,
      viaStigmer: true,
    };
  }
  return {
    baseUrl: provider === "google" ? GEMINI_API_ENDPOINT : provider === "anthropic" && anthropicBackend === "public" ? resolveAnthropicBaseUrl() : undefined,
    headers: undefined,
    apiKey: getRunnerSecret(LLM_PROVIDERS[provider].keyVariable) ?? "",
    viaStigmer: false,
  };
}

/** The constructor fields every wrapper shares: sampling, credential, output ceiling, streaming, retries. */
function commonFields(context: BuildContext, apiKey: string, maxTokens: number | undefined) {
  const { opts, retry } = context;
  return {
    ...(opts.temperature === null ? {} : { temperature: opts.temperature ?? 0 }),
    apiKey,
    ...(maxTokens ? { maxTokens } : {}),
    ...(opts.streaming ? { streaming: true } : {}),
    ...retry,
  };
}

async function buildAnthropic(context: BuildContext): Promise<{ readonly model: BaseChatModel; readonly providerName: string }> {
  const { opts, apiModelId, timeoutMs, lanes } = context;
  // Backend precedence by construction: a proxied call never consults the
  // backend var (`transportFor`). Selection is deployment-static and read
  // here the same way provider API keys are, not plumbed through Config.
  const anthropicBackend = !opts.proxyEndpoint ? resolveAnthropicBackend() : "public";
  const laneHeaders = lanes ? buildProxyHeaders(lanes.token, opts.headerScope ?? {}) : undefined;

  // Backend SDKs (and their auth subtrees: google-auth-library, AWS smithy)
  // load lazily so deployments that never configure a backend never
  // evaluate them — cheap cold starts stay cheap, and bundle-slim's CJS
  // output preserves exactly this deferred evaluation (see
  // scripts/bundle-slim.mjs). The factory is invoked lazily by
  // ChatAnthropic once per cached client (batch + streaming), so the class
  // is captured here, in async context.
  //
  // Each factory MUST honor options.maxRetries and options.timeout:
  // LangChain owns retrying and hands the factory maxRetries: 0 — a factory
  // that drops it nests the SDK's default 2 retries inside LangChain's
  // retry loop, multiplying every transient failure — and `timeout` arrives
  // through the same options object (ChatAnthropic spreads clientOptions
  // into it), so a factory that drops it silently unbounds
  // STIGMER_LLM_REQUEST_TIMEOUT_MS on that backend. Pinned by the seam
  // tests. Prerequisites are re-checked here (not only in
  // the factories' preflight) so paths that construct models without a
  // runner factory still fail at dispatch with the catalog message instead
  // of mid-request. Ambient credentials are read natively by each SDK from
  // its standard conventions (GCP: CLOUD_ML_REGION + ADC; AWS: AWS_REGION +
  // the credential chain); runner-held keys (AWS_BEARER_TOKEN_BEDROCK,
  // ANTHROPIC_FOUNDRY_API_KEY) are passed explicitly from the credential
  // store because the boot capture empties their env slots (#508).
  let backendCreateClient:
    | ((options: { maxRetries?: number; timeout?: number }) => unknown)
    | undefined;
  let wireModelId = apiModelId;
  let maxTokens = opts.maxTokens;
  if (anthropicBackend === "vertex") {
    const prereq = checkVertexPrerequisites();
    if (prereq !== null) throw new Error(prereq);
    const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
    const vertexLane = lanes ? vertexLaneOptions(lanes, laneHeaders!) : {};
    backendCreateClient = (options) =>
      new AnthropicVertex({ maxRetries: options.maxRetries, timeout: options.timeout, ...vertexLane });
    wireModelId = toVertexModelId(apiModelId);
  } else if (anthropicBackend === "bedrock") {
    const prereq = checkBedrockPrerequisites();
    if (prereq !== null) throw new Error(prereq);
    const { AnthropicBedrock } = await import("@anthropic-ai/bedrock-sdk");
    // The SDK's own default for `apiKey` is process.env.AWS_BEARER_TOKEN_BEDROCK,
    // which the boot capture has emptied (#508) — hand it the stored value
    // explicitly. `undefined` when absent preserves the SDK's fallthrough to
    // the ambient AWS credential chain (env keys, IRSA, config files).
    // Through a lane the client signs nothing (`skipAuth`): the lane adds
    // the bearer token or the SigV4 signature for the real host.
    const bedrockAuth = lanes
      ? { skipAuth: true, baseURL: modelLaneUrl(lanes, "bedrock"), defaultHeaders: laneHeaders }
      : { apiKey: getRunnerSecret("AWS_BEARER_TOKEN_BEDROCK") };
    backendCreateClient = (options) =>
      new AnthropicBedrock({
        ...bedrockAuth,
        maxRetries: options.maxRetries,
        timeout: options.timeout,
      });
    wireModelId = toBedrockModelId(apiModelId);
    if (maxTokens === undefined) {
      // LangChain's per-model maxTokens table prefix-matches the model
      // name. Vertex's translated ids still match their canonical prefix;
      // Bedrock's `anthropic.…` ids match nothing and silently fall back
      // to 4096 — a silent output cap. Probe the CANONICAL id with a
      // throwaway construction (pure field assignment, no I/O; the key is
      // never used) so bedrock inherits exactly the default the public API
      // and vertex get for the same model — including models the table
      // doesn't know yet, where all backends agree on the fallback.
      // Pinned by the canonical-parity test in bedrock-adapter.test.ts.
      maxTokens = new ChatAnthropic({ model: apiModelId, apiKey: "max-tokens-probe" }).maxTokens;
    }
  } else if (anthropicBackend === "foundry") {
    const prereq = checkFoundryPrerequisites();
    if (prereq !== null) throw new Error(prereq);
    const { AnthropicFoundry } = await import("@anthropic-ai/foundry-sdk");
    // Auth is an explicit either/or (the Foundry constructor throws when
    // given both a key and a token provider): ANTHROPIC_FOUNDRY_API_KEY if
    // present, otherwise keyless Microsoft Entra ID through the Azure
    // credential chain (env service principal -> workload identity ->
    // managed identity -> az CLI) — the Azure analogue of Vertex ADC and
    // the AWS chain, resolved at request time. The provider is built once
    // here (getBearerTokenProvider caches tokens until near-expiry) and
    // shared by both cached clients; the SDK still consults it per request,
    // so refreshed tokens flow without reconstruction (pinned by
    // foundry-seam.test.ts). Endpoint (resource or base URL) and the key
    // are read natively by the SDK from its own env vars.
    // The SDK's own default for `apiKey` is process.env.ANTHROPIC_FOUNDRY_API_KEY,
    // which the boot capture has emptied (#508) — resolve it from the store
    // and hand it over explicitly. The either/or stays intact: exactly one of
    // apiKey / azureADTokenProvider reaches the constructor.
    const foundryApiKey = lanes ? lanes.token : getRunnerSecret("ANTHROPIC_FOUNDRY_API_KEY")?.trim() || undefined;
    // Through a lane the endpoint is the lane's; an empty resource keeps the
    // SDK from reading ANTHROPIC_FOUNDRY_RESOURCE, which beside a base URL it
    // refuses as ambiguous.
    const foundryLane = lanes ? { baseURL: modelLaneUrl(lanes, "foundry"), resource: "", defaultHeaders: laneHeaders } : {};
    let azureADTokenProvider: (() => Promise<string>) | undefined;
    if (!foundryApiKey) {
      const { DefaultAzureCredential, getBearerTokenProvider } = await import("@azure/identity");
      azureADTokenProvider = getBearerTokenProvider(
        new DefaultAzureCredential(),
        "https://ai.azure.com/.default",
      );
    }
    backendCreateClient = (options) =>
      new AnthropicFoundry({
        maxRetries: options.maxRetries,
        timeout: options.timeout,
        ...foundryLane,
        ...(foundryApiKey ? { apiKey: foundryApiKey } : { azureADTokenProvider }),
      });
    // Unlike the vertex/bedrock ids, the deployment name needs no maxTokens
    // handling: stripping the snapshot date preserves LangChain's per-model
    // default (probed 2026-08-11 across the full catalog; pinned by the
    // parity test in foundry-adapter.test.ts).
    wireModelId = toFoundryDeploymentName(apiModelId);
  }

  const { baseUrl, headers, apiKey } = transportFor("anthropic", anthropicBackend, context);
  const common = commonFields(context, apiKey, maxTokens);
  const thinking = opts.thinking ? toAnthropicThinking(opts.thinking.mode, opts.thinking.profile) : undefined;
  const thinkingField = thinking !== undefined ? { thinking } : {};

  // The request timeout lives in a different slot per wrapper: ChatOpenAI
  // reads `timeout` as a constructor field, but ChatAnthropic ignores it
  // there — its slot is `clientOptions.timeout`, which the wrapper spreads
  // into the createClient factory options and (on the default factory) the
  // SDK constructor. This split is what makes STIGMER_LLM_REQUEST_TIMEOUT_MS
  // bound every path; putting `timeout` in the shared constructor spread is
  // the exact regression that made it inert for Anthropic.
  // The retry fields stay constructor-level for every wrapper: they are
  // LangChain's own retry knobs, distinct from the SDK-level maxRetries
  // the factories receive (always 0, so the SDK never retries beneath it).
  const clientOptions = {
    ...(timeoutMs ? { timeout: timeoutMs } : {}),
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    ...(headers ? { defaultHeaders: headers } : {}),
  };
  const clientOptionsField = Object.keys(clientOptions).length > 0 ? { clientOptions } : {};

  if (backendCreateClient) {
    // Backend adapter: the translated id is wire detail only — each
    // client moves it from the JSON body into its URL path. The waiver
    // in ChatAnthropic (an API key is not required when createClient is
    // provided) is what lets this construct with no ANTHROPIC_API_KEY.
    // (Backend mode never has a proxy — see `transportFor` — so the
    // clientOptions here carry at most the timeout.)
    //
    // service_tier deliberately does NOT ride backend requests:
    // standard/priority tiers are an Anthropic-FIRST-PARTY billing
    // concept, and Vertex/Bedrock/Foundry bill through the cloud
    // provider with no tier dimension — an unknown body param there is
    // a request refusal waiting to happen. The account-default price
    // hole this parameter closes does not exist on those backends.
    const model = new ChatAnthropic({
      model: wireModelId,
      ...common,
      ...thinkingField,
      ...clientOptionsField,
      createClient: backendCreateClient,
    });
    return { model, providerName: providerNameOf(anthropicBackend) };
  }

  // The tier rides the request body per provider dialect (#361):
  // ChatAnthropic has no tier field, so it rides `invocationKwargs`, which
  // the wrapper spreads into every request body, through the shared mapping
  // so no construction site can invent another spelling.
  const serviceTierField = opts.serviceTier !== undefined
    ? { invocationKwargs: { service_tier: toAnthropicServiceTier(opts.serviceTier) } }
    : {};
  const model = new ChatAnthropic({
    model: apiModelId,
    ...common,
    ...thinkingField,
    ...serviceTierField,
    ...clientOptionsField,
  });
  return { model, providerName: providerNameOf(anthropicBackend) };
}

function buildOpenAi(context: BuildContext): { readonly model: BaseChatModel; readonly providerName: string } {
  const { opts, apiModelId, timeoutMs } = context;
  if (opts.thinking && toAnthropicThinking(opts.thinking.mode, opts.thinking.profile) !== undefined) {
    throw new Error(
      `buildChatModel: thinking was asked of ${opts.modelName}, an openai model; ` +
        "OpenAI models have no thinking mapping on the Stigmer harness",
    );
  }
  const { baseUrl, headers, apiKey } = transportFor("openai", "public", context);
  // OpenAI takes `service_tier` as a first-class constructor field (#361),
  // through the shared mapping.
  const serviceTierField = opts.serviceTier !== undefined
    ? { service_tier: toOpenAiServiceTier(opts.serviceTier) }
    : {};
  // The SDKs name the transport-override block differently (OpenAI:
  // `configuration`, Anthropic: `clientOptions`) — encapsulating that here
  // is the whole point, since the shape mismatch is where bugs hide.
  const model = new ChatOpenAI({
    model: apiModelId,
    ...commonFields(context, apiKey, opts.maxTokens),
    ...serviceTierField,
    ...(timeoutMs ? { timeout: timeoutMs } : {}),
    ...(baseUrl || headers
      ? {
          configuration: {
            ...(baseUrl ? { baseURL: baseUrl } : {}),
            ...(headers ? { defaultHeaders: headers } : {}),
          },
        }
      : {}),
  });
  return { model, providerName: PROVIDER_OPENAI };
}

/**
 * Gemini, through LangChain's Google client on the runner's own transport
 * (`google-transport.ts`): the credential and the per-attempt bound are the
 * transport's, so the client never reads the environment (no
 * `GOOGLE_API_KEY`, no Google Cloud identity, no gateway). The package loads
 * lazily, like the Anthropic backend SDKs, and only its main entry, which
 * never loads Google's auth library.
 *
 * Google receives no tier: its default is its standard tier, and the run's
 * create-time check refuses FAST for a model whose catalog row prices no
 * fast variant, which no Gemini row does; a FAST that arrives anyway is
 * refused here rather than silently served at the standard rate.
 */
async function buildGoogle(context: BuildContext): Promise<{ readonly model: BaseChatModel; readonly providerName: string }> {
  const { opts, apiModelId, timeoutMs } = context;
  if (opts.serviceTier === ServiceTier.FAST) {
    throw new Error(
      `buildChatModel: the fast service tier was asked of ${opts.modelName}, a google model; ` +
        "Google models are served on the standard tier only",
    );
  }
  const { baseUrl, headers, apiKey, viaStigmer } = transportFor("google", "public", context);
  const thinking = opts.thinking ? toGoogleThinking(opts.thinking.mode, opts.thinking.profile) : undefined;
  const { ChatGoogle } = await import("@langchain/google");
  const GoogleModel = stigmerGoogleModelOf(ChatGoogle);
  const model = new GoogleModel({
    model: apiModelId,
    // The transport carries the credential (the module header). An empty key
    // keeps the constructor from reading GOOGLE_API_KEY into the instance.
    apiKey: "",
    apiClient: googleTransport({
      credential: viaStigmer ? { kind: "stigmer", headers: headers ?? buildProxyHeaders(apiKey, opts.headerScope ?? {}) } : { kind: "google-key", key: apiKey },
      ...(timeoutMs ? { timeoutMs } : {}),
    }),
    platformType: "gai",
    endpoint: baseUrl ?? GEMINI_API_ENDPOINT,
    apiVersion: GEMINI_API_VERSION,
    ...(opts.temperature === null ? {} : { temperature: opts.temperature ?? 0 }),
    ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
    // `streaming: false` would also turn off the client's streamed path for
    // good (`disableStreaming`); only `true` is ever passed.
    ...(opts.streaming ? { streaming: true } : {}),
    ...thinking,
    ...context.retry,
  });
  return { model, providerName: PROVIDER_GCP_GEMINI };
}

/**
 * `ChatGoogle` with three corrections the agent loop needs from LangChain's
 * Google client, each deleted once the library or deepagents makes it
 * (`__tests__/google-client.test.ts` and
 * `activities/execute-deep-agent/__tests__/gemini-graph-profile.test.ts`
 * pin them). The class keeps the library's name: nothing else differs.
 *
 *  - Its event stream starts inside LangChain's retry caller. The agent loop
 *    streams through `streamEvents`, which asks a model for its events
 *    (`_streamChatModelEvents`). The client fetches that stream outside its
 *    caller (`@langchain/google` 0.2.12
 *    `GenerateContentApiHandler.streamChatModelEvents`; its chunk and
 *    whole-reply paths fetch inside it), so a Google 429 or 503 would skip
 *    the runner's request loop (`model-retry.ts`), the one loop for a
 *    request that fails before its reply begins. Here the stream is started
 *    inside the caller, with the model's own retries and `onFailedAttempt`,
 *    until its first event: an attempt that fails before then is a new
 *    request, and nothing of it has reached the loop. Core's own default
 *    (events bridged from the chunk path) is no answer: it carries the
 *    client's function calls as the client's own content blocks, not as tool
 *    calls, so the agent would stop after a tool call (measured on core
 *    1.2.20).
 *  - Its usage counts the thinking. On that event stream the client reports
 *    `output_tokens` as Google's `candidatesTokenCount`, without
 *    `thoughtsTokenCount`, which Google bills as output; its chunk path counts
 *    both. Google's `totalTokenCount` is the prompt, the answer and the
 *    thinking (and the prompts of Google's built-in tools, which the runner
 *    never sends), so the output is the total less the input. Cached input
 *    is not reported on that stream at all, so it is priced at the input
 *    rate: over, never under.
 *  - It names itself `google:<id>` (`modelName`), deepagents' own
 *    `provider:model` form. deepagents places a model's harness profile by its
 *    class, from a table of three names that does not hold `ChatGoogle`
 *    (deepagents 1.14.1 to 1.17.1), and falls back to that identifier; without
 *    it a Gemini graph would get deepagents' own `general-purpose` sub-agent,
 *    outside the approval gate, and the `delete` tool
 *    (`deepagents-profiles.ts`).
 */
function stigmerGoogleModelOf(base: typeof import("@langchain/google").ChatGoogle) {
  return class ChatGoogle extends base {
    static override lc_name(): string {
      return "ChatGoogle";
    }

    /** The model's `provider:model` name, which deepagents places a harness profile by. */
    get modelName(): string {
      return `google:${this.model}`;
    }

    override async *_streamChatModelEvents(
      ...args: Parameters<BaseChatModel["_streamChatModelEvents"]>
    ): ReturnType<BaseChatModel["_streamChatModelEvents"]> {
      const [, options] = args;
      const started = await this.caller.callWithOptions({ signal: options.signal }, async () => {
        const events = super._streamChatModelEvents(...args);
        return { events, first: await events.next() };
      });
      if (started.first.done === true) return;
      yield withThinkingCounted(started.first.value);
      for await (const event of started.events) yield withThinkingCounted(event);
    }
  };
}

type ChatModelStreamEvent = Awaited<ReturnType<ReturnType<BaseChatModel["_streamChatModelEvents"]>["next"]>> extends IteratorResult<infer E> ? E : never;

/** An event whose usage counts the thinking as output (`stigmerGoogleModelOf`). */
function withThinkingCounted(event: ChatModelStreamEvent): ChatModelStreamEvent {
  const usage = (event as { usage?: { input_tokens: number; output_tokens: number; total_tokens: number } }).usage;
  if (usage === undefined || usage.total_tokens <= usage.input_tokens + usage.output_tokens) return event;
  return { ...event, usage: { ...usage, output_tokens: usage.total_tokens - usage.input_tokens } } as ChatModelStreamEvent;
}

/** The conventions' provider name for where an Anthropic model is served from. */
function providerNameOf(anthropicBackend: AnthropicBackend): string {
  switch (anthropicBackend) {
    case "public":
      return PROVIDER_ANTHROPIC;
    case "vertex":
      return PROVIDER_GCP_VERTEX_AI;
    case "bedrock":
      return PROVIDER_AWS_BEDROCK;
    case "foundry":
      return PROVIDER_AZURE_AI_INFERENCE;
  }
}

/**
 * A Vertex client bound to its lane. The client cannot acquire a Google
 * token (the host has no Google identity), so its auth client is a stub
 * that adds nothing and names a placeholder project; the lane adds the
 * runner's token and its real project (`agent-proxy/lanes.ts`). The
 * Vertex client reads exactly `projectId` and `getRequestHeaders()` off its
 * auth client, so the stub is the SDK's documented `authClient` seam.
 */
function vertexLaneOptions(lanes: ModelLanes, headers: Record<string, string>): VertexLaneOptions {
  const authClient = { projectId: VERTEX_LANE_PROJECT, getRequestHeaders: async () => new Headers() };
  return {
    baseURL: modelLaneUrl(lanes, "vertex"),
    projectId: VERTEX_LANE_PROJECT,
    defaultHeaders: headers,
    authClient: authClient as unknown as VertexAuthClient,
  };
}

type VertexClientOptions = NonNullable<ConstructorParameters<typeof import("@anthropic-ai/vertex-sdk").AnthropicVertex>[0]>;
type VertexAuthClient = NonNullable<VertexClientOptions["authClient"]>;
type VertexLaneOptions = Pick<VertexClientOptions, "baseURL" | "projectId" | "defaultHeaders" | "authClient">;
