/**
 * Convert a JSON Schema object to a Zod schema.
 *
 * Used by multiple activity layers (call:llm, ExecuteCursor extraction,
 * ExecuteDeepAgent responseFormat) to produce Zod schemas for
 * `withStructuredOutput()` / function-calling APIs.
 *
 * Handles the subset of JSON Schema used by workflow output schemas:
 * object types with required/optional fields, string/number/boolean/array
 * primitives, enum constraints, and null types.
 */

import { z } from "zod";

export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const type = schema.type as string | undefined;

  if (type === "object") {
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    const required = new Set(schema.required as string[] | undefined ?? []);

    if (!properties) return z.object({}).passthrough();

    const shape: Record<string, z.ZodType> = {};
    for (const [key, propSchema] of Object.entries(properties)) {
      let fieldType = jsonSchemaToZod(propSchema);
      if (!required.has(key)) {
        fieldType = fieldType.nullable();
      }
      shape[key] = fieldType;
    }
    return z.object(shape).passthrough();
  }

  if (type === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    return z.array(items ? jsonSchemaToZod(items) : z.unknown());
  }

  if (type === "string") {
    const enumValues = schema.enum as string[] | undefined;
    if (enumValues && enumValues.length > 0) {
      return z.enum(enumValues as [string, ...string[]]);
    }
    return z.string();
  }

  if (type === "number" || type === "integer") return z.number();
  if (type === "boolean") return z.boolean();
  if (type === "null") return z.null();

  return z.unknown();
}
