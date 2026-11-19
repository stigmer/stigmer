/**
 * The answer form the structured-output wire tests send: one JSON Schema
 * with what a person commonly writes into one (descriptions, an optional
 * field, an enum, a nested object, an array of objects, numeric bounds, a
 * format, `minItems` and a `oneOf`).
 */

/** An answer form with every construct a person commonly writes. */
export const ANSWER_FORM: Record<string, unknown> = {
  type: "object",
  description: "A reviewed candidate.",
  properties: {
    name: { type: "string", description: "The candidate's full name." },
    score: { type: "number", minimum: 0, maximum: 10, description: "0 to 10; 10 is a perfect fit." },
    level: { type: "string", enum: ["junior", "senior", "staff"] },
    contact: {
      type: "object",
      description: "How to reach them.",
      properties: { email: { type: "string", format: "email" }, phone: { type: "string" } },
      required: ["email"],
    },
    skills: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: { skill: { type: "string" }, years: { type: "integer" } },
        required: ["skill"],
      },
    },
    decision: {
      oneOf: [
        { type: "string", const: "hire" },
        { type: "object", properties: { reject: { type: "string" } }, required: ["reject"] },
      ],
    },
  },
  required: ["name", "level", "contact", "skills", "decision"],
};
