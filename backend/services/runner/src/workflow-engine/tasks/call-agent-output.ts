/**
 * Structured output validation for call:agent results.
 *
 * When a call:agent task defines `output.schema`, the agent's
 * response is validated against the JSON Schema. The `on_invalid`
 * policy determines behavior on validation failure:
 *
 * - ON_INVALID_FAIL: task fails immediately
 * - ON_INVALID_RETRY: re-prompt with validation errors (up to max_retries)
 * - ON_INVALID_FALLBACK: branch to fallback_task
 *
 * Uses Ajv for JSON Schema Draft 2020-12 validation.
 *
 * This module is sandbox-safe — no Node.js built-ins, no I/O.
 */

import type { AgentCallResult } from "../types.js";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
}

/**
 * Validates an agent call result against a JSON Schema.
 * Reads from `result.structured` — the agent domain owns extraction
 * and this function only validates the already-extracted data.
 */
export function validateAgentCallOutput(
  result: AgentCallResult,
  schema: Record<string, unknown>,
): ValidationResult {
  const data = extractValidationTarget(result);

  if (data === undefined) {
    return {
      valid: false,
      errors: ["Agent did not return structured output"],
    };
  }

  return validateJsonSchema(data, schema);
}

function extractValidationTarget(result: AgentCallResult): unknown | undefined {
  if (result.structured !== undefined && result.structured !== null) {
    return result.structured;
  }
  return undefined;
}

/**
 * Lightweight JSON Schema validation. Checks `type`, `required`,
 * `properties`, and `enum` constraints — the subset used by agent
 * output schemas. Full Ajv integration is deferred to the activity
 * layer if deeper schema support (Draft 2020-12 features like
 * $ref, if/then/else, etc.) is needed.
 *
 * This keeps the workflow sandbox free of heavy dependencies.
 */
function validateJsonSchema(
  data: unknown,
  schema: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];

  if (schema.type === "object") {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { valid: false, errors: ["Expected object, got " + typeof data] };
    }

    const obj = data as Record<string, unknown>;
    const required = schema.required as string[] | undefined;
    if (required) {
      for (const field of required) {
        if (!(field in obj)) {
          errors.push(`Missing required field '${field}'`);
        }
      }
    }

    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties) {
      for (const [field, propSchema] of Object.entries(properties)) {
        if (!(field in obj)) continue;
        const value = obj[field];

        if (propSchema.type && !matchesType(value, propSchema.type as string)) {
          errors.push(`Field '${field}' expected type '${propSchema.type}', got '${typeof value}'`);
        }

        if (propSchema.enum && Array.isArray(propSchema.enum)) {
          if (!propSchema.enum.includes(value)) {
            errors.push(
              `Field '${field}' must be one of [${propSchema.enum.join(", ")}], got '${value}'`,
            );
          }
        }
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(data)) {
      return { valid: false, errors: ["Expected array, got " + typeof data] };
    }
  } else if (schema.type) {
    if (!matchesType(data, schema.type as string)) {
      return { valid: false, errors: [`Expected type '${schema.type}', got '${typeof data}'`] };
    }
  }

  return { valid: errors.length === 0, errors };
}

function matchesType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}
