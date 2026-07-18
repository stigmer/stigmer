/**
 * Validate action — validates data against JSON Schema and/or
 * business rules expressed as JQ predicates.
 *
 * Called by `call: validate` tasks in the CNCF workflow DSL. The Go
 * converter emits:
 *   call: validate
 *   with:
 *     input: "${ $data.buildUser }"
 *     schema: { type: object, properties: ..., required: [...] }
 *     rules: [{ name: "...", expression: "...", message: "..." }]
 *     on_fail: VALIDATION_FAIL_RAISE
 *     fallback_task: human_review
 *
 * Schema validation is a lightweight subset (type, required,
 * properties, enum, minimum, maximum). Business rules are evaluated
 * as JQ expressions — a falsy result means the rule failed.
 */

import { ApplicationFailure } from "@temporalio/activity";
import {
  evaluateExpression,
  isStrictExpr,
  sanitizeExpr,
} from "../workflow-engine/expression.js";

export interface ValidateConfig {
  readonly input: unknown;
  readonly schema?: Record<string, unknown>;
  readonly rules?: ReadonlyArray<{
    readonly name: string;
    readonly expression: string;
    readonly message?: string;
  }>;
  readonly on_fail?: string;
  readonly fallback_task?: string;
}

export interface ValidationError {
  readonly rule?: string;
  readonly path?: string;
  readonly message: string;
}

export interface ValidateResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<ValidationError>;
  readonly data: unknown;
  readonly __flow_directive__?: string;
}

function normalizeOnFail(raw: string | undefined): string {
  if (!raw) return "RAISE";
  return raw
    .toUpperCase()
    .replace(/^VALIDATION_FAIL_/, "");
}

// ─────────────────────────────────────────────────────────────────────
// JSON Schema validation (lightweight subset)
// ─────────────────────────────────────────────────────────────────────

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

function validateJsonSchema(
  data: unknown,
  schema: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (schema.type === "object") {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      errors.push({ path: "$", message: "Expected object, got " + typeof data });
      return errors;
    }

    const obj = data as Record<string, unknown>;
    const required = schema.required as string[] | undefined;
    if (required) {
      for (const field of required) {
        if (!(field in obj)) {
          errors.push({ path: `$.${field}`, message: `Missing required field '${field}'` });
        }
      }
    }

    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties) {
      for (const [field, propSchema] of Object.entries(properties)) {
        if (!(field in obj)) continue;
        const value = obj[field];

        if (propSchema.type && !matchesType(value, propSchema.type as string)) {
          errors.push({
            path: `$.${field}`,
            message: `Field '${field}' expected type '${propSchema.type}', got '${typeof value}'`,
          });
        }

        if (propSchema.enum && Array.isArray(propSchema.enum)) {
          if (!propSchema.enum.includes(value)) {
            errors.push({
              path: `$.${field}`,
              message: `Field '${field}' must be one of [${propSchema.enum.join(", ")}], got '${value}'`,
            });
          }
        }

        if (typeof value === "number") {
          if (propSchema.minimum !== undefined && value < (propSchema.minimum as number)) {
            errors.push({
              path: `$.${field}`,
              message: `Field '${field}' must be >= ${propSchema.minimum}, got ${value}`,
            });
          }
          if (propSchema.maximum !== undefined && value > (propSchema.maximum as number)) {
            errors.push({
              path: `$.${field}`,
              message: `Field '${field}' must be <= ${propSchema.maximum}, got ${value}`,
            });
          }
        }
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(data)) {
      errors.push({ path: "$", message: "Expected array, got " + typeof data });
    }
  } else if (schema.type) {
    if (!matchesType(data, schema.type as string)) {
      errors.push({ path: "$", message: `Expected type '${schema.type}', got '${typeof data}'` });
    }
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────
// Business rules validation (JQ predicates)
// ─────────────────────────────────────────────────────────────────────

async function validateRules(
  data: unknown,
  rules: ReadonlyArray<{ readonly name: string; readonly expression: string; readonly message?: string }>,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  for (const rule of rules) {
    // Config guard: the expression must be a jq string. Anything else is
    // a workflow-definition defect (or an upstream resolution bug) — name
    // the rule and what to fix instead of crashing in the jq engine.
    if (typeof rule.expression !== "string" || rule.expression.length === 0) {
      errors.push({
        rule: rule.name,
        message:
          `Rule '${rule.name}' has an invalid 'expression': expected a jq ` +
          `predicate string, got ${typeof rule.expression}. Fix the rule in ` +
          `the workflow's validate task_config.`,
      });
      continue;
    }

    // Rule expressions arrive unresolved (deferred code — see the
    // call-function builder). Accept both the strict `${ ... }` wrapper
    // and a bare jq predicate.
    const expr = isStrictExpr(rule.expression)
      ? sanitizeExpr(rule.expression)
      : rule.expression;

    const result = await evaluateExpression(expr, data, {});
    if (!result) {
      errors.push({
        rule: rule.name,
        message: rule.message || `Rule failed: ${rule.name}`,
      });
    }
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────

export async function validateAction(config: ValidateConfig): Promise<ValidateResult> {
  if (!config.schema && (!config.rules || config.rules.length === 0)) {
    throw ApplicationFailure.nonRetryable(
      "validate: at least one of 'schema' or 'rules' must be provided",
      "VALIDATE_MISSING_CRITERIA",
    );
  }

  const errors: ValidationError[] = [];

  if (config.schema) {
    errors.push(...validateJsonSchema(config.input, config.schema));
  }

  if (config.rules && config.rules.length > 0) {
    errors.push(...await validateRules(config.input, config.rules));
  }

  const result: ValidateResult = {
    valid: errors.length === 0,
    errors,
    data: config.input,
  };

  const onFail = normalizeOnFail(config.on_fail);

  if (!result.valid && onFail === "BRANCH" && config.fallback_task) {
    return { ...result, __flow_directive__: config.fallback_task };
  }

  if (!result.valid && onFail === "WARN") {
    return result;
  }

  if (!result.valid) {
    const summary = result.errors.map(e => e.message).join("; ");
    throw ApplicationFailure.nonRetryable(
      `Validation failed: ${summary}`,
      "VALIDATION_FAILED",
      result,
    );
  }

  return result;
}
