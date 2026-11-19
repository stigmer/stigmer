/**
 * Tier-2 structured-output extraction for a harness turn.
 *
 * Harness-agnostic, and called from one place: the turn runtime's epilogue
 * (`harness/run-turn.ts` `extractStructuredOutputFromText`), so both
 * harnesses have it (pinned by the Stigmer hermetic `structured-output`
 * tier-2 arm).
 *
 * When tier-1 text extraction (shared/extract-json.ts) cannot find JSON in
 * the agent's free-text response, this tier asks an economy-tier LLM to
 * extract it by calling one tool whose input is the person's schema, whole
 * (`answer-form.ts`, the same form the graph's tool strategy binds). The
 * method is named, function calling, on both providers: left unnamed,
 * @langchain/openai would pick OpenAI's strict native output, which refuses
 * a schema with an optional field. The answer is then checked against the
 * schema with JSON Schema validation, so a tool call that does not fill the
 * form is a refusal here, never structured output.
 *
 * Lives in its own module so the LangChain construction path stays out of
 * the runtime's module graph until a run actually needs tier 2 — the
 * runtime imports this module lazily at the call site, mirroring its tier-1
 * import, which is what bundle-slim's deferred evaluation preserves.
 */

import type { Config } from "../config.js";
import { getEconomyModel } from "./model-registry.js";
import { buildChatModel } from "./model-client.js";
import { checkDirectCredentials } from "./llm-backend.js";
import { tryInferProvider } from "./llm-proxy.js";
import { ANSWER_TOOL_NAME, answerFormErrors, answerFormOf } from "./answer-form.js";

/**
 * Extract structured data from an agent's free-text response using an
 * economy-tier LLM that calls the answer form's tool.
 *
 * Construction (registry-id resolution, provider inference, proxy wiring) is
 * delegated to the shared buildChatModel so the economy model's registry id
 * is always resolved to a provider API id before the call.
 *
 * The call is scoped to the run it serves (`executionId`), as session
 * titling's is: a proxy that requires a run scope on every call refuses one
 * without it, and the scope is what meters the call to that run
 * (stigmer#2060).
 *
 * Throws when no LLM is reachable (no proxy and no credential path for the
 * extraction model's provider), or when the model's answer does not fill the
 * form — the caller treats any throw here as "tier 2 unavailable", logs it,
 * and returns the agent's text without structured output, so the failure
 * mode is a diagnosable log line, never a lost run.
 */
export async function extractStructuredOutput(
  agentResponse: string,
  schema: Record<string, unknown>,
  config: Config,
  primaryModel: string,
  executionId: string,
): Promise<unknown | null> {
  const extractionModel = await getEconomyModel(primaryModel);
  const proxyEndpoint = config.proxyEndpoint ?? undefined;

  if (!proxyEndpoint) {
    const provider = tryInferProvider(extractionModel);
    const missing = provider === null ? null : checkDirectCredentials(provider);
    if (missing !== null) {
      throw new Error(
        `Structured-output extraction needs the ${provider} model ` +
        `'${extractionModel}' but has no credential path. ${missing}`,
      );
    }
  }

  const { model: llm } = await buildChatModel({
    modelName: extractionModel,
    proxyEndpoint,
    stigmerToken: config.stigmerTokenRef.current ?? undefined,
    headerScope: { executionId },
    maxTokens: 4096,
  });

  const form = answerFormOf(schema);
  const structured = llm.withStructuredOutput(form, { name: ANSWER_TOOL_NAME, method: "functionCalling" });

  const result = await structured.invoke([
    { role: "system", content: "Extract the structured data from the agent's response. Return only the data that matches the schema." },
    { role: "user", content: agentResponse },
  ]);

  if (result == null) return null;
  const errors = answerFormErrors(form, result);
  if (errors.length > 0) {
    throw new Error(`Structured-output extraction answered outside the schema: ${errors.slice(0, 5).join("; ")}`);
  }
  return result;
}
