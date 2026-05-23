import type { JsonObject } from "@bufbuild/protobuf";

/**
 * JSON Schema definitions for workflow architect agent structured responses.
 *
 * These schemas must stay within the subset supported by the runner's
 * jsonSchemaToZod: object, array, string, number, boolean, null,
 * enum on strings, optional properties, nested objects. No $ref,
 * oneOf/anyOf, or string patterns.
 *
 * With native harness (ToolStrategy), these schemas become an extract-N
 * function tool. tool_choice is set to "any", meaning the agent MUST
 * call a tool every turn. For turns where the agent has no YAML to
 * return (clarification questions), it must call extract with
 * action: "clarification".
 */

/**
 * Structured response schema for workflow generation and refinement.
 *
 * Actions:
 * - `generated_yaml`: Agent produced validated YAML (yaml field populated)
 * - `clarification`: Agent needs more info (explanation has the question)
 * - `no_changes`: Workflow is correct, no modifications needed
 */
export const WORKFLOW_ARCHITECT_RESPONSE_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["generated_yaml", "clarification", "no_changes"],
    },
    yaml: {
      type: "string",
    },
    explanation: {
      type: "string",
    },
  },
  required: ["action", "explanation"],
};

/**
 * Structured response schema for workflow execution diagnosis.
 *
 * Actions:
 * - `diagnosis`: Runtime error explanation (no YAML fix)
 * - `fix_yaml`: Definition error with validated YAML fix
 * - `clarification`: Agent needs more info from the user
 */
export const WORKFLOW_DIAGNOSIS_RESPONSE_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["diagnosis", "fix_yaml", "clarification"],
    },
    diagnosis: {
      type: "string",
    },
    yaml: {
      type: "string",
    },
    explanation: {
      type: "string",
    },
  },
  required: ["action", "explanation"],
};
