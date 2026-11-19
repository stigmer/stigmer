/**
 * The answer form: the person's `structured_output_schema` as the tool a
 * model fills to answer, on every path that binds one (the Stigmer graph's
 * tool strategy, `execute-deep-agent/structured-output-format.ts`, and
 * tier-2 extraction, `extract-structured-output.ts`).
 *
 * The API's promise is that the person's JSON Schema is the contract
 * (`spec.proto` `structured_output_schema`), so the form is that schema,
 * whole: every description, every optional field left optional, every
 * keyword kept. The answer is checked against the form by JSON Schema
 * validation (langchain's `Validator`, the one its tool strategy runs), never
 * by a translation into another schema language, because a translation can
 * only lose what the person wrote.
 *
 * Three things the runner adds, each because a tool needs it and none of
 * them narrows what the person asked for:
 *
 * - `title` is the tool's name, `StructuredOutput`. langchain names a
 *   JSON-Schema tool after its `title`, and a provider refuses a tool name
 *   with a space in it, so a person's own title would break the turn. The
 *   name is the Claude engine's structured-output tool's
 *   (`execute-claude/engine-options.ts` `STRUCTURED_OUTPUT_TOOL`), so a model
 *   sees one name on either harness, and it stays the same on every turn,
 *   so the tool list a provider caches does not change between turns.
 * - `description`, when the person wrote none at the root: the tool's
 *   description is the schema's, and a model given a tool with none has no
 *   hint that it is where the answer goes.
 * - A root that is not an object is wrapped as the one required property
 *   `value` of an object, because a tool's input is an object on every
 *   provider, and so is the structured output a run records (a
 *   `google.protobuf.Struct`). An object root without `properties` gains an
 *   empty one, which allows the same values.
 */

import { Validator } from "@langchain/core/utils/json_schema";

/** The tool's name on every path; see the header. */
export const ANSWER_TOOL_NAME = "StructuredOutput";

/** The key a non-object answer is wrapped under. */
export const WRAPPED_ANSWER_KEY = "value";

/** The tool's description when the person's schema has none at its root. */
export const DEFAULT_ANSWER_DESCRIPTION = "Tool for extracting structured output from the model's response.";

/** A JSON Schema whose root is an object, which is what a tool takes. */
export type AnswerForm = Record<string, unknown> & {
  readonly type: "object";
  readonly title: string;
  readonly description: string;
  readonly properties: Record<string, unknown>;
};

/** The answer form for a person's structured-output schema. */
export function answerFormOf(schema: Readonly<Record<string, unknown>>): AnswerForm {
  if (schema.type !== "object") {
    return {
      type: "object",
      title: ANSWER_TOOL_NAME,
      description: DEFAULT_ANSWER_DESCRIPTION,
      properties: { [WRAPPED_ANSWER_KEY]: schema },
      required: [WRAPPED_ANSWER_KEY],
    };
  }
  return {
    ...schema,
    type: "object",
    title: ANSWER_TOOL_NAME,
    description: typeof schema.description === "string" ? schema.description : DEFAULT_ANSWER_DESCRIPTION,
    properties: isRecord(schema.properties) ? schema.properties : {},
  };
}

/**
 * The reasons `answer` does not fill `form`, or an empty list when it does.
 * The same validator langchain's tool strategy checks a graph's answer with.
 */
export function answerFormErrors(form: AnswerForm, answer: unknown): string[] {
  const result = new Validator(form as ConstructorParameters<typeof Validator>[0]).validate(answer);
  return result.valid ? [] : result.errors.map((e) => `${e.instanceLocation}: ${e.error}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
