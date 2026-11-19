/**
 * Serializing a tool's zod 4 schema for a model leaves the schema the tool
 * parses its own arguments with as it was.
 *
 * `@langchain/core`'s `toJsonSchema` closes every object of a zod 4 schema
 * before serializing it (`interopZodObjectStrict(schema, true)`, which
 * writes strict clones into the shape object it is given). If that write
 * reached the tool's own schema, a nested object would refuse an extra key
 * after the first model call where it stripped it before. It does not: the
 * serializer first rebuilds the schema (`interopZodTransformInputSchema`
 * with `recursive`, a fresh shape for every object), and the strict clones
 * land in the rebuilt copy. This pins that, on every path the runner
 * serializes a tool by: `toJsonSchema` directly (`middleware/tool-intent.ts`)
 * and `convertToOpenAITool` (the provider bindings).
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";

function nestedTool() {
  return tool(async (input: { target: { path: string } }) => input.target.path, {
    name: "nested",
    description: "A tool whose argument holds an object.",
    schema: z.object({
      target: z.object({ path: z.string() }),
      items: z.array(z.object({ id: z.string() })).optional(),
    }),
  });
}

const EXTRA_NESTED = { target: { path: "a.txt", extra: 1 }, items: [{ id: "x", extra: 2 }] };

describe("a zod 4 tool schema after serialization", () => {
  it("serializes closed at every level, as langchain sends it", () => {
    const parameters = toJsonSchema(nestedTool().schema) as {
      additionalProperties?: boolean;
      properties: { target: { additionalProperties?: boolean } };
    };

    expect(parameters.additionalProperties).toBe(false);
    expect(parameters.properties.target.additionalProperties).toBe(false);
  });

  it("still strips an extra nested key after toJsonSchema", () => {
    const t = nestedTool();
    toJsonSchema(t.schema);

    expect((t.schema as z.ZodType).parse(EXTRA_NESTED)).toEqual({ target: { path: "a.txt" }, items: [{ id: "x" }] });
  });

  it("still strips an extra nested key after convertToOpenAITool", async () => {
    const t = nestedTool();
    convertToOpenAITool(t);

    await expect(t.invoke(EXTRA_NESTED)).resolves.toBe("a.txt");
  });
});
