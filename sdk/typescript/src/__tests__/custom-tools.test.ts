/**
 * `defineCustomTool`: the declaration a backend and the chat kit share. It
 * returns the create input's entry as written (name, description and a copy
 * of the schema, so a later change to the caller's object never reaches a
 * session it declared) and is exported from the package root.
 */

import { describe, expect, it } from "vitest";

import { defineCustomTool } from "../index.js";

describe("defineCustomTool", () => {
  it("returns the create input's entry, its schema a copy of the one given", () => {
    const schema = { type: "object" as const, properties: { service: { type: "string" } }, required: ["service"] };
    const tool = defineCustomTool({ name: "show_registration_form", description: "Open the form.", inputSchema: schema });
    expect(tool).toEqual({ name: "show_registration_form", description: "Open the form.", inputSchema: schema });
    expect(tool.inputSchema).not.toBe(schema);
    schema.properties.service.type = "number";
    expect(tool.inputSchema, "a later change to a nested object never reaches it").toEqual({ type: "object", properties: { service: { type: "string" } }, required: ["service"] });
  });
});
