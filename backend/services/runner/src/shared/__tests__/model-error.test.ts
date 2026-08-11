/**
 * Tests for the shared model-call error unwrapping and classification
 * (stigmer/stigmer#330).
 *
 * The scenarios mirror the production incident: the platform proxy rewrites
 * a platform-account billing rejection into a 503 carrying the sentinel
 * code, LangChain wraps the SDK error in a MiddlewareError whose message is
 * copied verbatim and whose `cause` is the original — and the runner must
 * (a) attribute platform faults to the platform, (b) attribute direct-mode
 * billing faults to the user's own provider account, and (c) never relabel
 * a non-model error.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PLATFORM_CAPACITY_SENTINEL,
  classifyModelCallError,
  describeExecutionError,
  unwrapModelError,
} from "../model-error.js";

/**
 * Mimic LangChain's MiddlewareError: message copied from the inner error,
 * original preserved on `cause` (langchain dist/agents/errors.js:50-57).
 */
function middlewareWrap(inner: Error): Error {
  const wrapped = new Error(inner.message);
  wrapped.cause = inner;
  return wrapped;
}

/** Mimic a provider SDK APIError: message + numeric `.status`. */
function sdkError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/** The exact message shape the incident produced on the Anthropic arm. */
const ANTHROPIC_BILLING_MESSAGE =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low' +
  ' to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';

/** The rewritten message the cloud proxy now returns for platform faults. */
const PLATFORM_REWRITE_MESSAGE =
  "The Stigmer platform's model capacity for anthropic is temporarily unavailable." +
  ` [code: ${PLATFORM_CAPACITY_SENTINEL}]`;

describe("unwrapModelError", () => {
  it("returns the error itself when there is no cause", () => {
    const err = new Error("plain");
    expect(unwrapModelError(err)).toBe(err);
  });

  it("walks a MiddlewareError-style cause chain to the root SDK error", () => {
    const root = sdkError(400, ANTHROPIC_BILLING_MESSAGE);
    const wrapped = middlewareWrap(root);
    expect(unwrapModelError(wrapped)).toBe(root);
  });

  it("walks nested cause chains", () => {
    const root = sdkError(503, "boom");
    const wrapped = middlewareWrap(middlewareWrap(root));
    expect(unwrapModelError(wrapped)).toBe(root);
  });

  it("survives a pathological cause cycle via the depth cap", () => {
    const a = new Error("a");
    const b = new Error("b");
    a.cause = b;
    b.cause = a;
    // Any chain member is acceptable; the point is it terminates.
    expect(unwrapModelError(a)).toBeInstanceOf(Error);
  });

  it("passes non-Error values through", () => {
    expect(unwrapModelError("string error")).toBe("string error");
  });
});

describe("classifyModelCallError — platform sentinel", () => {
  it("classifies the platform rewrite as non-retryable platform capacity", () => {
    const err = middlewareWrap(sdkError(503, PLATFORM_REWRITE_MESSAGE));

    const classified = classifyModelCallError(err, { proxyMode: true, provider: "anthropic" });

    expect(classified?.code).toBe("LLM_PLATFORM_CAPACITY");
    expect(classified?.retryable).toBe(false);
    expect(classified?.message).toContain("platform-side issue");
    expect(classified?.message).toContain("credits were not charged");
  });

  it("sentinel wins over status mapping (a 503 would otherwise be retryable)", () => {
    const classified = classifyModelCallError(
      sdkError(503, PLATFORM_REWRITE_MESSAGE),
      { proxyMode: true },
    );
    expect(classified?.code).toBe("LLM_PLATFORM_CAPACITY");
    expect(classified?.retryable).toBe(false);
  });
});

describe("classifyModelCallError — provider billing prose", () => {
  it("in direct mode, attributes billing to the user's own provider account", () => {
    const err = middlewareWrap(sdkError(400, ANTHROPIC_BILLING_MESSAGE));

    const classified = classifyModelCallError(err, { proxyMode: false, provider: "anthropic" });

    expect(classified?.code).toBe("LLM_PROVIDER_BILLING");
    expect(classified?.retryable).toBe(false);
    expect(classified?.message).toContain("Your Anthropic account");
    // Direct mode keeps the provider message — it IS the user's account.
    expect(classified?.message).toContain("credit balance is too low");
  });

  it("in proxy mode, raw billing prose (version-skewed proxy) attributes to the platform", () => {
    const err = sdkError(400, ANTHROPIC_BILLING_MESSAGE);

    const classified = classifyModelCallError(err, { proxyMode: true, provider: "anthropic" });

    expect(classified?.code).toBe("LLM_PLATFORM_CAPACITY");
    expect(classified?.message).not.toContain("Plans & Billing");
  });

  it("recognizes OpenAI quota exhaustion wordings", () => {
    for (const msg of [
      "429 You have no credits remaining. Add credits to continue using the API.",
      "429 You exceeded your current quota, please check your plan and billing details.",
      '429 {"error":{"type":"insufficient_quota"}}',
    ]) {
      const classified = classifyModelCallError(
        sdkError(429, msg),
        { proxyMode: false, provider: "openai" },
      );
      expect(classified?.code).toBe("LLM_PROVIDER_BILLING");
    }
  });
});

describe("classifyModelCallError — status mapping", () => {
  it("maps statuses to the stable codes with call-llm's retryability policy", () => {
    const cases: Array<[number, string, boolean]> = [
      [401, "LLM_AUTHENTICATION_ERROR", false],
      [403, "LLM_PERMISSION_DENIED", false],
      [404, "LLM_MODEL_NOT_FOUND", false],
      [400, "LLM_BAD_REQUEST", false],
      [422, "LLM_UNPROCESSABLE_REQUEST", false],
      [429, "LLM_RATE_LIMIT", false],
      [500, "LLM_PROVIDER_ERROR", true],
      [529, "LLM_PROVIDER_ERROR", true],
      [418, "LLM_API_ERROR", false],
    ];
    for (const [status, code, retryable] of cases) {
      const classified = classifyModelCallError(
        sdkError(status, `HTTP ${status}`),
        { proxyMode: false, provider: "openai", modelId: "gpt-4o" },
      );
      expect(classified?.code, `status ${status}`).toBe(code);
      expect(classified?.retryable, `status ${status}`).toBe(retryable);
    }
  });

  it("proxy-mode 401/403 wording points at the platform session, not a user API key", () => {
    const classified = classifyModelCallError(
      sdkError(401, "unauthorized"),
      { proxyMode: true, provider: "anthropic" },
    );
    expect(classified?.message).toContain("Stigmer platform");
    expect(classified?.message).not.toContain("your API key");
  });

  it("unwraps before duck-typing status (the incident shape end-to-end)", () => {
    const classified = classifyModelCallError(
      middlewareWrap(sdkError(429, "Too many requests")),
      { proxyMode: false, provider: "openai" },
    );
    expect(classified?.code).toBe("LLM_RATE_LIMIT");
  });
});

describe("classifyModelCallError — connection heuristics and no-signal", () => {
  it("always recognizes the SDKs' own APIConnection* classes as retryable", () => {
    class APIConnectionTimeoutError extends Error {}
    class APIConnectionError extends Error {}
    expect(
      classifyModelCallError(new APIConnectionTimeoutError("timed out"), { proxyMode: false })?.code,
    ).toBe("LLM_CONNECTION_TIMEOUT");
    expect(
      classifyModelCallError(new APIConnectionError("refused"), { proxyMode: false })?.code,
    ).toBe("LLM_CONNECTION_ERROR");
  });

  it("loose Timeout/Connection names classify only when the caller vouches assumeModelCall", () => {
    class ConnectTimeoutError extends Error {}

    // A model-call-only catch (call-llm) keeps the loose heuristics.
    expect(
      classifyModelCallError(new ConnectTimeoutError("undici timeout"), {
        proxyMode: false,
        assumeModelCall: true,
      })?.code,
    ).toBe("LLM_CONNECTION_TIMEOUT");

    // A broad catch must not relabel arbitrary *TimeoutError classes.
    expect(
      classifyModelCallError(new ConnectTimeoutError("undici timeout"), { proxyMode: false }),
    ).toBeUndefined();
  });

  it("returns undefined for errors with no model-call signal", () => {
    expect(classifyModelCallError(new Error("ENOSPC: disk full"), { proxyMode: true })).toBeUndefined();
    expect(classifyModelCallError("not even an error", { proxyMode: false })).toBeUndefined();
  });
});

describe("classifyModelCallError — vertex backend", () => {
  // The Vertex arms activate only for direct-mode Anthropic calls under
  // STIGMER_ANTHROPIC_BACKEND=vertex (resolved from env, deployment-static).
  // Every other test in this file runs with the var unset and pins that the
  // public wordings are untouched.
  function stubVertexEnv() {
    vi.stubEnv("STIGMER_ANTHROPIC_BACKEND", "vertex");
    vi.stubEnv("CLOUD_ML_REGION", "asia-south1");
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const vertexCtx = {
    proxyMode: false,
    provider: "anthropic" as const,
    modelId: "claude-sonnet-4-6",
  };

  it("classifies google-auth credential failures as non-retryable with the GCP fix", () => {
    stubVertexEnv();
    for (const raw of [
      "Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.",
      "Unable to detect a Project Id in the current environment.",
      "No projectId was given and it could not be resolved from credentials. The client should be instantiated with the `projectId` option or the `ANTHROPIC_VERTEX_PROJECT_ID` environment variable should be set.",
      "invalid_grant: Invalid JWT Signature.",
    ]) {
      const classified = classifyModelCallError(middlewareWrap(new Error(raw)), vertexCtx);
      expect(classified?.code, raw).toBe("LLM_BACKEND_CREDENTIALS");
      expect(classified?.retryable, raw).toBe(false);
      expect(classified?.message, raw).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    }
  });

  it("does NOT classify credential prose when the backend is not vertex (no relabeling drift)", () => {
    // Same message, backend unset: google-auth prose can only mean vertex —
    // without it, there is no positive model-call signal, so no classification.
    const classified = classifyModelCallError(
      new Error("Could not load the default credentials"),
      vertexCtx,
    );
    expect(classified).toBeUndefined();
  });

  it("words 401 around Google credentials, not an API key", () => {
    stubVertexEnv();
    const classified = classifyModelCallError(sdkError(401, "unauthorized"), vertexCtx);
    expect(classified?.code).toBe("LLM_AUTHENTICATION_ERROR");
    expect(classified?.message).toContain("Google rejected this Vertex AI call");
    expect(classified?.message).not.toContain("API key");
  });

  it("words 403 around the service account's Vertex AI role", () => {
    stubVertexEnv();
    const classified = classifyModelCallError(sdkError(403, "forbidden"), vertexCtx);
    expect(classified?.code).toBe("LLM_PERMISSION_DENIED");
    expect(classified?.message).toContain("Vertex AI User");
    expect(classified?.message).toContain("aiplatform.endpoints.predict");
  });

  it("words 404 around Model Garden enablement and the configured region", () => {
    stubVertexEnv();
    const classified = classifyModelCallError(sdkError(404, "not found"), vertexCtx);
    expect(classified?.code).toBe("LLM_MODEL_NOT_FOUND");
    expect(classified?.message).toContain("Model Garden");
    expect(classified?.message).toContain('region "asia-south1"');
  });

  it("stays inert in proxy mode even with the backend var set (proxy owns routing)", () => {
    stubVertexEnv();
    const classified = classifyModelCallError(
      sdkError(401, "unauthorized"),
      { proxyMode: true, provider: "anthropic" },
    );
    expect(classified?.message).toContain("Stigmer platform");
    expect(classified?.message).not.toContain("Vertex");
  });

  it("stays inert for OpenAI failures with the Anthropic backend var set", () => {
    stubVertexEnv();
    const classified = classifyModelCallError(
      sdkError(404, "not found"),
      { proxyMode: false, provider: "openai", modelId: "gpt-4.1" },
    );
    expect(classified?.message).not.toContain("Vertex");
  });

  it("never throws on an invalid backend value — classification reads it as public", () => {
    vi.stubEnv("STIGMER_ANTHROPIC_BACKEND", "verteks");
    const classified = classifyModelCallError(sdkError(401, "unauthorized"), vertexCtx);
    expect(classified?.code).toBe("LLM_AUTHENTICATION_ERROR");
    expect(classified?.message).toContain("API key");
  });
});

describe("classifyModelCallError — bedrock backend", () => {
  // The Bedrock arms activate only for direct-mode Anthropic calls under
  // STIGMER_ANTHROPIC_BACKEND=bedrock, mirroring the vertex suite above.
  function stubBedrockEnv() {
    vi.stubEnv("STIGMER_ANTHROPIC_BACKEND", "bedrock");
    vi.stubEnv("AWS_REGION", "ap-south-1");
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const bedrockCtx = {
    proxyMode: false,
    provider: "anthropic" as const,
    modelId: "claude-sonnet-4-6",
  };

  it("classifies AWS credential-chain failures as non-retryable with the AWS fix", () => {
    stubBedrockEnv();
    for (const raw of [
      "Could not load credentials from any providers",
      "Resolved credential object is not valid",
    ]) {
      const classified = classifyModelCallError(middlewareWrap(new Error(raw)), bedrockCtx);
      expect(classified?.code, raw).toBe("LLM_BACKEND_CREDENTIALS");
      expect(classified?.retryable, raw).toBe(false);
      expect(classified?.message, raw).toContain("AWS");
      expect(classified?.message, raw).toContain("AWS_BEARER_TOKEN_BEDROCK");
    }
  });

  it("does NOT classify credential prose when the backend is not bedrock (no relabeling drift)", () => {
    const classified = classifyModelCallError(
      new Error("Could not load credentials from any providers"),
      bedrockCtx,
    );
    expect(classified).toBeUndefined();
  });

  it("translates the bare-id inference-profile rejection into the one-var remedy", () => {
    stubBedrockEnv();
    // AWS's actual ValidationException prose for newer Claude models
    // invoked by bare model id.
    const classified = classifyModelCallError(
      sdkError(
        400,
        "Invocation of model ID anthropic.claude-sonnet-4-6-v1:0 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.",
      ),
      bedrockCtx,
    );
    expect(classified?.code).toBe("LLM_BACKEND_MODEL_ROUTING");
    expect(classified?.retryable).toBe(false);
    expect(classified?.message).toContain("STIGMER_BEDROCK_INFERENCE_PREFIX");
    expect(classified?.message).toContain("STIGMER_BEDROCK_MODEL_MAP");
  });

  it("words 401 around AWS identity, not an API key", () => {
    stubBedrockEnv();
    const classified = classifyModelCallError(sdkError(401, "unauthorized"), bedrockCtx);
    expect(classified?.code).toBe("LLM_AUTHENTICATION_ERROR");
    expect(classified?.message).toContain("AWS rejected this Bedrock call");
    expect(classified?.message).not.toContain("API key");
  });

  it("words 403 around Bedrock model access and IAM, not an API key", () => {
    stubBedrockEnv();
    const classified = classifyModelCallError(sdkError(403, "forbidden"), bedrockCtx);
    expect(classified?.code).toBe("LLM_PERMISSION_DENIED");
    expect(classified?.message).toContain("Model access");
    expect(classified?.message).toContain("bedrock:InvokeModel");
    expect(classified?.message).not.toContain("API key");
  });

  it("words 404 around region availability and the id-resolution knobs", () => {
    stubBedrockEnv();
    const classified = classifyModelCallError(sdkError(404, "not found"), bedrockCtx);
    expect(classified?.code).toBe("LLM_MODEL_NOT_FOUND");
    expect(classified?.message).toContain('region "ap-south-1"');
    expect(classified?.message).toContain("STIGMER_BEDROCK_MODEL_MAP");
  });

  it("stays inert in proxy mode even with the backend var set (proxy owns routing)", () => {
    stubBedrockEnv();
    const classified = classifyModelCallError(
      sdkError(401, "unauthorized"),
      { proxyMode: true, provider: "anthropic" },
    );
    expect(classified?.message).toContain("Stigmer platform");
    expect(classified?.message).not.toContain("Bedrock");
  });

  it("keeps vertex wordings and bedrock wordings from cross-contaminating", () => {
    stubBedrockEnv();
    const classified = classifyModelCallError(sdkError(403, "forbidden"), bedrockCtx);
    expect(classified?.message).not.toContain("Vertex");
    expect(classified?.message).not.toContain("Model Garden");
  });
});

describe("classifyModelCallError — foundry backend", () => {
  // The Foundry arms activate only for direct-mode Anthropic calls under
  // STIGMER_ANTHROPIC_BACKEND=foundry, mirroring the vertex and bedrock
  // suites above.
  function stubFoundryEnv() {
    vi.stubEnv("STIGMER_ANTHROPIC_BACKEND", "foundry");
    vi.stubEnv("ANTHROPIC_FOUNDRY_RESOURCE", "my-foundry-resource");
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const foundryCtx = {
    proxyMode: false,
    provider: "anthropic" as const,
    modelId: "claude-sonnet-4-6",
  };

  it("classifies Entra token-acquisition failures as non-retryable with the Azure fix", () => {
    stubFoundryEnv();
    // The Foundry SDK wraps every token-provider failure in this one
    // prefix (pinned by foundry-seam.test.ts), so a single wording covers
    // the whole @azure/identity credential-chain family.
    const classified = classifyModelCallError(
      middlewareWrap(
        new Error(
          "Failed to get token from azureADTokenProvider: " +
          "ChainedTokenCredential authentication failed. CredentialUnavailableError: " +
          "ManagedIdentityCredential: no managed identity endpoint found.",
        ),
      ),
      foundryCtx,
    );
    expect(classified?.code).toBe("LLM_BACKEND_CREDENTIALS");
    expect(classified?.retryable).toBe(false);
    expect(classified?.message).toContain("Microsoft Entra ID");
    expect(classified?.message).toContain("ANTHROPIC_FOUNDRY_API_KEY");
  });

  it("does NOT classify credential prose when the backend is not foundry (no relabeling drift)", () => {
    const classified = classifyModelCallError(
      new Error("Failed to get token from azureADTokenProvider: boom"),
      foundryCtx,
    );
    expect(classified).toBeUndefined();
  });

  it("words 401 around the Foundry credential, not the Anthropic API key", () => {
    stubFoundryEnv();
    const classified = classifyModelCallError(sdkError(401, "unauthorized"), foundryCtx);
    expect(classified?.code).toBe("LLM_AUTHENTICATION_ERROR");
    expect(classified?.message).toContain("Azure rejected this Microsoft Foundry call");
    expect(classified?.message).toContain("ANTHROPIC_FOUNDRY_API_KEY");
    expect(classified?.message).not.toContain("your API key");
  });

  it("words 403 around the Foundry RBAC role", () => {
    stubFoundryEnv();
    const classified = classifyModelCallError(sdkError(403, "forbidden"), foundryCtx);
    expect(classified?.code).toBe("LLM_PERMISSION_DENIED");
    expect(classified?.message).toContain("Foundry User");
    expect(classified?.message).not.toContain("API key");
  });

  it("words 404 around deployment names, the resource, and the deployment map", () => {
    stubFoundryEnv();
    const classified = classifyModelCallError(sdkError(404, "not found"), foundryCtx);
    expect(classified?.code).toBe("LLM_MODEL_NOT_FOUND");
    expect(classified?.message).toContain("deployment name");
    expect(classified?.message).toContain('resource "my-foundry-resource"');
    expect(classified?.message).toContain("STIGMER_FOUNDRY_DEPLOYMENT_MAP");
  });

  it("stays inert in proxy mode even with the backend var set (proxy owns routing)", () => {
    stubFoundryEnv();
    const classified = classifyModelCallError(
      sdkError(401, "unauthorized"),
      { proxyMode: true, provider: "anthropic" },
    );
    expect(classified?.message).toContain("Stigmer platform");
    expect(classified?.message).not.toContain("Foundry");
  });

  it("keeps foundry wordings from cross-contaminating with the other backends", () => {
    stubFoundryEnv();
    const classified = classifyModelCallError(sdkError(404, "not found"), foundryCtx);
    expect(classified?.message).not.toContain("Vertex");
    expect(classified?.message).not.toContain("Bedrock");
  });
});

describe("describeExecutionError", () => {
  it("labels classified model errors with the stable code, not the wrapper class", () => {
    const { errorType, errorMessage } = describeExecutionError(
      middlewareWrap(sdkError(503, PLATFORM_REWRITE_MESSAGE)),
      { proxyMode: true },
    );
    expect(errorType).toBe("LLM_PLATFORM_CAPACITY");
    expect(errorMessage).toContain("credits were not charged");
    expect(errorMessage).not.toContain("MiddlewareError");
  });

  it("keeps the root error's identity for non-model failures", () => {
    class WorkspaceLockTimeoutError extends Error {}
    const root = new WorkspaceLockTimeoutError("workspace busy");

    const { errorType, errorMessage } = describeExecutionError(
      middlewareWrap(root),
      { proxyMode: true },
    );

    expect(errorType).toBe("WorkspaceLockTimeoutError");
    expect(errorMessage).toBe("workspace busy");
  });

  it("handles non-Error throwables", () => {
    const { errorType, errorMessage } = describeExecutionError("oops", { proxyMode: false });
    expect(errorType).toBe("UnknownError");
    expect(errorMessage).toBe("oops");
  });

  it("never surfaces provider billing-console prose in proxy mode", () => {
    const { errorMessage } = describeExecutionError(
      middlewareWrap(sdkError(400, ANTHROPIC_BILLING_MESSAGE)),
      { proxyMode: true },
    );
    expect(errorMessage).not.toContain("Plans & Billing");
    expect(errorMessage).toContain("platform-side issue");
  });
});
