/**
 * Tier-2 structured-output extraction for the Cursor harness.
 *
 * When tier-1 text extraction (shared/extract-json.ts) cannot find JSON in
 * the agent's free-text response, this tier asks an economy-tier LLM to
 * extract it via withStructuredOutput (function-calling), which guarantees
 * schema-conformant output through the API's tool-use mechanism.
 *
 * Lives in its own module (rather than inside execute-cursor/index.ts) so
 * the LangChain construction path stays out of the Cursor activity's module
 * graph until a run actually needs tier 2 — index.ts imports this module
 * lazily at the call site, mirroring its tier-1 import, which is what
 * bundle-slim's deferred evaluation preserves.
 */

import type { Config } from "../../config.js";
import { getEconomyModel } from "../../shared/model-registry.js";
import { buildChatModel } from "../../shared/model-client.js";
import { checkDirectCredentials } from "../../shared/llm-backend.js";
import { tryInferProvider } from "../../shared/llm-proxy.js";
import { jsonSchemaToZod } from "../../shared/json-schema-to-zod.js";

/**
 * Extract structured data from an agent's free-text response using an
 * economy-tier LLM with withStructuredOutput (function-calling).
 *
 * Construction (registry-id resolution, provider inference, proxy wiring) is
 * delegated to the shared buildChatModel so the economy model's registry id
 * is always resolved to a provider API id before the call.
 *
 * Throws when no LLM is reachable (no proxy and no credential path for the
 * extraction model's provider) — the caller treats any throw here as "tier 2
 * unavailable", logs it, and returns the agent's text without structured
 * output, so the failure mode is a diagnosable log line, never a lost run.
 */
export async function extractStructuredOutput(
  agentResponse: string,
  schema: Record<string, unknown>,
  config: Config,
  primaryModel: string,
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
    stigmerToken: config.stigmerToken ?? undefined,
    maxTokens: 4096,
  });

  const zodSchema = jsonSchemaToZod(schema);
  const structured = llm.withStructuredOutput(zodSchema);

  const result = await structured.invoke([
    { role: "system", content: "Extract the structured data from the agent's response. Return only the data that matches the schema." },
    { role: "user", content: agentResponse },
  ]);

  return result ?? null;
}
