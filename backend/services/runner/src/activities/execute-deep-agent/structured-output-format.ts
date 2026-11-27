/**
 * The response format a Stigmer turn hands `createDeepAgent` when its message
 * asks for structured output (`spec.structured_output_schema`).
 *
 * The runner names the strategy itself; it never hands langchain a bare
 * schema, because langchain would then pick by the model's profile table
 * (`langchain` `transformResponseFormat`): OpenAI's strict native output for
 * most GPT models, a tool for Claude, a tool for a model with no profile.
 * That table moves with every langchain release, and OpenAI's strict mode
 * refuses a schema with an optional field, so the person's schema could not
 * reach a GPT model whole. Two strategies, chosen here:
 *
 * - A graph whose model may be forced to call a tool (one that does not
 *   think, or Google's, which takes a forced tool while thinking): the tool strategy,
 *   with the person's schema whole as the tool's input (`shared/answer-form.ts`
 *   says what the runner adds and why). The model calls the tool to answer;
 *   langchain checks the arguments against the schema and asks again on a
 *   miss.
 * - A graph that thinks on a provider that refuses a forced tool while it
 *   does (`shared/thinking-mode.ts` `thinkingRefusesForcedTool`): the
 *   provider strategy, Anthropic's own JSON output
 *   (`output_config.format`), which forces no tool, because forced tool use
 *   and thinking do not combine on every platform and model. Its schema goes
 *   through the Anthropic SDK's own transform (the one
 *   @langchain/anthropic's withStructuredOutput applies), because Anthropic
 *   accepts only closed objects and a subset of keywords. That transform runs
 *   for every provider today; an OpenAI reasoning model under it is
 *   stigmer#3322.
 */

import { providerStrategy, toolStrategy } from "langchain";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { answerFormOf } from "../../shared/answer-form.js";

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
  refusesForcedTool: boolean,
) {
  if (outputSchema === undefined) return undefined;
  return refusesForcedTool
    ? providerStrategy({ schema: transformJSONSchema(outputSchema) as ObjectJsonSchema })
    : toolStrategy(answerFormOf(outputSchema));
}
