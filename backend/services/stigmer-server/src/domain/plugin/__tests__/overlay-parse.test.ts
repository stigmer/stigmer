/**
 * Pins the overlay parser as the server twin of the SDK's strict manifest
 * parse: a document the CLI accepts parses (camelCase and proto field
 * names both), an unknown field refuses naming the path, a wrong `kind`
 * refuses, a missing `kind` refuses, an empty or non-mapping document
 * refuses, a foreign `metadata.org` refuses while an empty or matching
 * one passes, and malformed YAML refuses with the parser's message.
 */
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";

import { OverlayParseError, parseOverlayDocument } from "../overlay/parse.js";

const encoder = new TextEncoder();
const AGENT = { schema: AgentSchema, yamlKind: "Agent", org: "acme" };

function parse(text: string) {
  return parseOverlayDocument(
    "ai.stigmer/agent.yaml",
    encoder.encode(text),
    AGENT,
  );
}

function refusal(text: string): string {
  try {
    parse(text);
  } catch (error) {
    expect(error).toBeInstanceOf(OverlayParseError);
    return (error as OverlayParseError).message;
  }
  throw new Error("expected a refusal");
}

describe("parseOverlayDocument", () => {
  it("parses a document the CLI accepts, in either field casing", () => {
    const agent = parse(
      "apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: thermos\nspec:\n  instructions: Long enough instructions here.\n  skill_refs:\n    - slug: a\n  skillRefs:\n    - slug: b\n",
    );
    expect(agent.metadata?.name).toBe("thermos");
    expect(agent.spec?.skillRefs.map((r) => r.slug)).toContain("b");
  });

  it("refuses an unknown field, naming the document", () => {
    expect(
      refusal("kind: Agent\nmetadata:\n  name: t\nspec:\n  colour: blue\n"),
    ).toContain("overlay document 'ai.stigmer/agent.yaml': invalid Agent:");
  });

  it("refuses a kind other than the one its location holds", () => {
    expect(refusal("kind: Workflow\nmetadata:\n  name: t\n")).toBe(
      "overlay document 'ai.stigmer/agent.yaml': kind 'Workflow' is not the Agent this location holds",
    );
  });

  it("refuses a missing kind", () => {
    expect(refusal("metadata:\n  name: t\n")).toContain(
      "missing the required 'kind' field (expected kind: Agent)",
    );
  });

  it("refuses an empty or non-mapping document", () => {
    expect(refusal("   \n")).toContain("the document is empty");
    expect(refusal("- a\n- b\n")).toContain("expected a mapping document");
  });

  it("refuses a foreign org and accepts an empty or matching one", () => {
    expect(
      refusal("kind: Agent\nmetadata:\n  name: t\n  org: other\n"),
    ).toContain(
      "metadata.org 'other' is not the organization the plugin is installed into ('acme')",
    );
    expect(
      parse("kind: Agent\nmetadata:\n  name: t\n  org: acme\n").metadata?.org,
    ).toBe("acme");
    expect(parse("kind: Agent\nmetadata:\n  name: t\n").metadata?.org).toBe("");
  });

  it("refuses malformed YAML with the parser's message", () => {
    expect(refusal("kind: Agent\nmetadata: [unclosed\n")).toContain(
      "invalid YAML:",
    );
  });
});
