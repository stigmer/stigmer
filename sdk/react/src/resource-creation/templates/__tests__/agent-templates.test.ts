import { describe, expect, it } from "vitest";
import { EXAMPLES } from "@stigmer/examples";
import { AGENT_TEMPLATES } from "../agent-templates";
import { TEMPLATE_CATEGORY_LABELS } from "../types";

/**
 * The built-in agent templates pre-fill only what every user can keep.
 *
 * A template that named a plugin, Skill, MCP server or variable would seed
 * the wizard with a reference most organizations cannot resolve, so the
 * agent would fail to save or to run for them. Each template therefore
 * fills the name, the description and the instructions, and nothing else.
 * Each is filed under a category the gallery has a label for, and the ids
 * are distinct, since the gallery keys its cards by id. The templates are
 * Stigmer's example jobs, one for one, so "Create a new agent" and the
 * launcher's first question offer the same list.
 */
describe("AGENT_TEMPLATES", () => {
  it("fills only the name, description and instructions", () => {
    for (const template of AGENT_TEMPLATES) {
      expect(Object.keys(template.data).sort(), template.id).toEqual([
        "description",
        "instructions",
        "name",
      ]);
      for (const value of Object.values(template.data)) {
        expect(
          typeof value === "string" && value.trim().length > 0,
          template.id,
        ).toBe(true);
      }
    }
  });

  it("files every template under a labelled category, each id once", () => {
    const ids = AGENT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of AGENT_TEMPLATES) {
      expect(Object.keys(TEMPLATE_CATEGORY_LABELS), template.id).toContain(
        template.category,
      );
    }
  });

  it("are the example jobs, one for one, each making the example's agent", () => {
    expect(AGENT_TEMPLATES.map((template) => template.id)).toEqual(EXAMPLES.map((example) => example.id));
    for (const [index, template] of AGENT_TEMPLATES.entries()) {
      const example = EXAMPLES[index];
      expect(template.data.name, template.id).toBe(example?.agent.name);
      expect(template.data.instructions, template.id).toBe(example?.agent.instructions);
    }
  });
});
