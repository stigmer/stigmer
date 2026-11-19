/**
 * The answer form (`../answer-form.ts`): the person's schema whole, plus
 * only the three things a tool needs (its name as `title`, a description
 * when the root has none, an object root), and the JSON Schema check every
 * answer passes.
 */

import { describe, expect, it } from "vitest";
import {
  ANSWER_TOOL_NAME,
  DEFAULT_ANSWER_DESCRIPTION,
  WRAPPED_ANSWER_KEY,
  answerFormErrors,
  answerFormOf,
} from "../answer-form.js";
import { ANSWER_FORM } from "../../__test-utils__/answer-form-fixture.js";

describe("answerFormOf", () => {
  it("keeps an object schema whole and names the tool", () => {
    const form = answerFormOf(ANSWER_FORM);

    const { title, ...rest } = form;
    expect(title).toBe(ANSWER_TOOL_NAME);
    expect(rest).toEqual(ANSWER_FORM);
  });

  it("replaces a person's title, which a provider may refuse as a tool name", () => {
    const form = answerFormOf({ type: "object", title: "Candidate review", properties: { a: { type: "string" } } });

    expect(form.title).toBe(ANSWER_TOOL_NAME);
    expect(form.properties).toEqual({ a: { type: "string" } });
  });

  it("gives a root without a description the default one", () => {
    expect(answerFormOf({ type: "object", properties: {} }).description).toBe(DEFAULT_ANSWER_DESCRIPTION);
  });

  it("gives an object root without properties an empty set, which allows the same values", () => {
    const form = answerFormOf({ type: "object" });

    expect(form.properties).toEqual({});
    expect(answerFormErrors(form, { anything: 1 })).toEqual([]);
  });

  it("wraps a root that is not an object as the one required property", () => {
    const person = { type: "array", items: { type: "string" } };

    const form = answerFormOf(person);

    expect(form).toEqual({
      type: "object",
      title: ANSWER_TOOL_NAME,
      description: DEFAULT_ANSWER_DESCRIPTION,
      properties: { [WRAPPED_ANSWER_KEY]: person },
      required: [WRAPPED_ANSWER_KEY],
    });
    expect(answerFormErrors(form, { [WRAPPED_ANSWER_KEY]: ["a"] })).toEqual([]);
    expect(answerFormErrors(form, { [WRAPPED_ANSWER_KEY]: [1] })).not.toEqual([]);
  });
});

describe("answerFormErrors", () => {
  const form = answerFormOf(ANSWER_FORM);
  const filled = {
    name: "Ada",
    level: "staff",
    contact: { email: "ada@example.com" },
    skills: [{ skill: "analysis" }],
    decision: "hire",
  };

  it("accepts an answer that leaves optional fields out", () => {
    expect(answerFormErrors(form, filled)).toEqual([]);
  });

  it("enforces what the person wrote beyond types: bounds, minItems, oneOf", () => {
    expect(answerFormErrors(form, { ...filled, score: 11 })).not.toEqual([]);
    expect(answerFormErrors(form, { ...filled, skills: [] })).not.toEqual([]);
    expect(answerFormErrors(form, { ...filled, decision: "maybe" })).not.toEqual([]);
  });

  it("refuses a missing required field and says where", () => {
    const { name: _name, ...missing } = filled;

    expect(answerFormErrors(form, missing).join(" ")).toMatch(/name/);
  });
});
