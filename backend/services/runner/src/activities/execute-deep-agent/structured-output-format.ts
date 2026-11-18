/**
 * The response format a Stigmer turn hands `createDeepAgent` when its message
 * asks for structured output (`spec.structured_output_schema`).
 *
 * Structured output takes one of langchain's two strategies, chosen here
 * explicitly. A graph that thinks uses the provider strategy: Anthropic's
 * own JSON output (`output_config.format`), which forces no tool, because
 * forced tool use and thinking do not combine on every platform and
 * model. Its schema goes through the SDK's own transform (the one
 * @langchain/anthropic's withStructuredOutput applies): Anthropic accepts
 * only closed objects, and the runner's zod keeps them open. A graph that
 * does not think keeps the tool strategy, the raw zod, unchanged.
 */

import { providerStrategy } from "langchain";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { jsonSchemaToZod } from "../../shared/json-schema-to-zod.js";

/**
 * A JSON object schema, the shape langchain's provider strategy takes for a
 * plain schema (its own type for it is not exported). An execution's
 * structured output schema is an object schema; the SDK's transform keeps
 * its root `type`.
 */
type ObjectJsonSchema = { type: "object"; [key: string]: unknown };

/** The `responseFormat` for `createDeepAgent`, or undefined when the message asks for none. */
export function structuredOutputFormat(
  outputSchema: Record<string, unknown> | undefined,
  graphThinks: boolean,
) {
  if (outputSchema === undefined) return undefined;
  return graphThinks
    ? providerStrategy({ schema: transformJSONSchema(outputSchema) as ObjectJsonSchema })
    : jsonSchemaToZod(outputSchema);
}
