import { describe, it, expect } from "vitest";
import { z } from "zod";
import { jsonSchemaToZod } from "../json-schema-to-zod.js";

describe("jsonSchemaToZod", () => {
  describe("basic type mapping", () => {
    it("converts string type", () => {
      const schema = { type: "string" };
      const zod = jsonSchemaToZod(schema);
      expect(zod.parse("hello")).toBe("hello");
      expect(() => zod.parse(42)).toThrow();
    });

    it("converts number type", () => {
      const zod = jsonSchemaToZod({ type: "number" });
      expect(zod.parse(3.14)).toBe(3.14);
    });

    it("converts integer type as number", () => {
      const zod = jsonSchemaToZod({ type: "integer" });
      expect(zod.parse(42)).toBe(42);
    });

    it("converts boolean type", () => {
      const zod = jsonSchemaToZod({ type: "boolean" });
      expect(zod.parse(true)).toBe(true);
    });

    it("converts null type", () => {
      const zod = jsonSchemaToZod({ type: "null" });
      expect(zod.parse(null)).toBeNull();
    });

    it("converts string enum", () => {
      const zod = jsonSchemaToZod({ type: "string", enum: ["warning", "critical"] });
      expect(zod.parse("warning")).toBe("warning");
      expect(() => zod.parse("info")).toThrow();
    });

    it("returns unknown for unrecognized type", () => {
      const zod = jsonSchemaToZod({});
      expect(zod.parse("anything")).toBe("anything");
      expect(zod.parse(42)).toBe(42);
    });
  });

  describe("object type", () => {
    it("converts object with required fields", () => {
      const schema = {
        type: "object",
        required: ["name", "age"],
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      };
      const zod = jsonSchemaToZod(schema);
      const valid = { name: "Alice", age: 30 };
      expect(zod.parse(valid)).toMatchObject(valid);
    });

    it("allows additional properties via passthrough", () => {
      const schema = {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      };
      const zod = jsonSchemaToZod(schema);
      const result = zod.parse({ name: "Alice", extra: true });
      expect(result).toMatchObject({ name: "Alice", extra: true });
    });

    it("handles empty properties", () => {
      const zod = jsonSchemaToZod({ type: "object" });
      expect(zod.parse({})).toEqual({});
    });
  });

  describe("array type", () => {
    it("converts array with item schema", () => {
      const schema = {
        type: "array",
        items: { type: "string" },
      };
      const zod = jsonSchemaToZod(schema);
      expect(zod.parse(["a", "b"])).toEqual(["a", "b"]);
    });

    it("converts array without item schema", () => {
      const zod = jsonSchemaToZod({ type: "array" });
      expect(zod.parse([1, "two", true])).toEqual([1, "two", true]);
    });
  });

  describe("nested schemas", () => {
    it("handles nested objects with arrays", () => {
      const schema = {
        type: "object",
        required: ["cohorts"],
        properties: {
          cohorts: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "size"],
              properties: {
                name: { type: "string" },
                size: { type: "number" },
                trend: { type: "string" },
              },
            },
          },
        },
      };
      const zod = jsonSchemaToZod(schema);
      const data = {
        cohorts: [
          { name: "D1 New", size: 10, trend: "stable" },
          { name: "D3 Drop", size: 3589, trend: null },
        ],
      };
      expect(zod.parse(data)).toMatchObject(data);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // BUG REPRODUCTION: OpenAI structured output compatibility
  //
  // OpenAI's structured output API requires ALL fields to be required.
  // Optional semantics must use .nullable() (value can be null, key
  // must be present), not .optional() (key may be absent).
  //
  // LangChain's withStructuredOutput rejects Zod schemas that use
  // .optional() without .nullable() — this is the exact error from
  // the production failure:
  //
  //   Zod field at `#/definitions/extract/properties/anomalies/items/
  //   properties/metric` uses `.optional()` without `.nullable()`
  //   which is not supported by the API.
  //
  // The schema below is the exact anomalies.items schema from the
  // daily-notification-plan workflow that triggered the bug.
  // ─────────────────────────────────────────────────────────────────────

  describe("OpenAI structured output compatibility", () => {
    const anomalyItemSchema = {
      type: "object",
      properties: {
        metric: { type: "string" },
        description: { type: "string" },
        severity: { type: "string", enum: ["warning", "critical"] },
      },
    };

    it("non-required fields use nullable (not optional) for OpenAI compatibility", () => {
      const zod = jsonSchemaToZod(anomalyItemSchema);
      const shape = (zod as z.ZodObject<z.ZodRawShape>).shape;

      for (const key of ["metric", "description", "severity"]) {
        const field = shape[key];
        expect(
          field instanceof z.ZodNullable,
          `Field '${key}' should be z.ZodNullable but got ${field.constructor.name}`,
        ).toBe(true);
      }
    });

    it("nullable fields accept null values", () => {
      const zod = jsonSchemaToZod(anomalyItemSchema);
      const result = zod.parse({ metric: null, description: null, severity: null });
      expect(result).toEqual({ metric: null, description: null, severity: null });
    });

    it("nullable fields accept their typed values", () => {
      const zod = jsonSchemaToZod(anomalyItemSchema);
      const data = { metric: "DAU", description: "DAU dropped", severity: "warning" };
      expect(zod.parse(data)).toMatchObject(data);
    });

    it("full workflow schema produces nullable non-required fields at all nesting levels", () => {
      const fullSchema = {
        type: "object",
        required: ["executive_summary", "cohorts", "anomalies"],
        properties: {
          executive_summary: { type: "string" },
          dau: { type: "number" },
          dau_trend_pct: { type: "number" },
          cohorts: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "size", "action_needed"],
              properties: {
                name: { type: "string" },
                size: { type: "number" },
                retention_trend: { type: "string" },
                action_needed: { type: "boolean" },
              },
            },
          },
          anomalies: {
            type: "array",
            items: anomalyItemSchema,
          },
          data_quality_notes: { type: "string" },
        },
      };

      const zod = jsonSchemaToZod(fullSchema);
      const topShape = (zod as z.ZodObject<z.ZodRawShape>).shape;

      // Top-level non-required fields should be nullable
      expect(topShape.dau instanceof z.ZodNullable, "dau should be nullable").toBe(true);
      expect(topShape.dau_trend_pct instanceof z.ZodNullable, "dau_trend_pct should be nullable").toBe(true);
      expect(topShape.data_quality_notes instanceof z.ZodNullable, "data_quality_notes should be nullable").toBe(true);

      // Top-level required fields should NOT be nullable
      expect(topShape.executive_summary instanceof z.ZodNullable, "executive_summary should NOT be nullable").toBe(false);

      // Nested: cohorts items have optional retention_trend
      const cohortsArray = topShape.cohorts as z.ZodArray<z.ZodObject<z.ZodRawShape>>;
      const cohortItemShape = cohortsArray.element.shape;
      expect(cohortItemShape.retention_trend instanceof z.ZodNullable, "retention_trend should be nullable").toBe(true);
      expect(cohortItemShape.name instanceof z.ZodNullable, "name should NOT be nullable").toBe(false);
    });
  });
});
