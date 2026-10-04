/**
 * Pins the overlay parser as the server twin of the SDK's strict manifest
 * parse: a document the CLI accepts parses (camelCase and proto field
 * names both), an unknown field refuses naming the path, a wrong `kind`
 * refuses, a missing `kind` refuses, an empty or non-mapping document
 * refuses, and malformed YAML refuses with the parser's message. Then the
 * documents' organizations: every organization a document names by slug
 * is resolved to its id (`resolveOverlayOrganizations`), a document's own
 * organization must then be the installing one (`checkOverlayOrg`), and an
 * empty one is the installing one's.
 */
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";

import { parseOverlays, resolveOverlayOrganizations } from "../overlay/documents.js";
import { checkOverlayOrg, OverlayParseError, parseOverlayDocument } from "../overlay/parse.js";

const encoder = new TextEncoder();
const AGENT = { schema: AgentSchema, yamlKind: "Agent" };
const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const GLOBEX_ID = "org_01jbbbbbbbbbbbbbbbbbbbbbbb";

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
    const path = "ai.stigmer/agent.yaml";
    expect(() => checkOverlayOrg(path, parse("kind: Agent\nmetadata:\n  name: t\n  org: other\n"), ACME_ID)).toThrow(
      `overlay document 'ai.stigmer/agent.yaml': metadata.org 'other' is not the organization the plugin is installed into ('${ACME_ID}')`,
    );
    expect(() => checkOverlayOrg(path, parse(`kind: Agent\nmetadata:\n  name: t\n  org: ${ACME_ID}\n`), ACME_ID)).not.toThrow();
    expect(() => checkOverlayOrg(path, parse("kind: Agent\nmetadata:\n  name: t\n"), ACME_ID)).not.toThrow();
  });

  it("refuses malformed YAML with the parser's message", () => {
    expect(refusal("kind: Agent\nmetadata: [unclosed\n")).toContain(
      "invalid YAML:",
    );
  });
});

describe("resolveOverlayOrganizations", () => {
  const resolver = {
    asked: [] as string[],
    resolve(name: string) {
      this.asked.push(name);
      return Promise.resolve(({ acme: ACME_ID, globex: GLOBEX_ID } as Record<string, string>)[name]);
    },
  };
  const overlayOf = (agentYaml: string) =>
    parseOverlays({
      agent: { path: "ai.stigmer/agent.yaml", bytes: encoder.encode(agentYaml) },
      workflows: [],
      mcpServers: [],
    } as never);

  it("resolves the organizations a document names by slug, its own and its references', and accepts the installing one", async () => {
    const overlays = overlayOf(
      "kind: Agent\nmetadata:\n  name: t\n  org: acme\nspec:\n  instructions: Long enough instructions here.\n  skill_refs:\n    - org: globex\n      slug: triage\n",
    );
    await resolveOverlayOrganizations(overlays, ACME_ID, resolver);
    expect(overlays.agent?.resource.metadata?.org).toBe(ACME_ID);
    expect(overlays.agent?.resource.spec?.skillRefs[0]?.org).toBe(GLOBEX_ID);
  });

  it("resolves workflow and MCP server documents too", async () => {
    const overlays = parseOverlays({
      workflows: [
        {
          path: "ai.stigmer/workflows/triage.yaml",
          name: "triage",
          bytes: encoder.encode("kind: Workflow\nmetadata:\n  name: triage\n  org: acme\n"),
        },
      ],
      mcpServers: [
        {
          path: "ai.stigmer/mcp-servers/orders.yaml",
          server: "orders",
          bytes: encoder.encode("kind: McpServer\nmetadata:\n  name: orders\n  org: acme\n"),
        },
      ],
    } as never);
    await resolveOverlayOrganizations(overlays, ACME_ID, resolver);
    expect(overlays.workflows[0]?.resource.metadata?.org).toBe(ACME_ID);
    expect(overlays.mcpServers[0]?.resource.metadata?.org).toBe(ACME_ID);
  });

  it("refuses a document naming another organization, by slug or by a name nothing holds", async () => {
    await expect(
      resolveOverlayOrganizations(overlayOf("kind: Agent\nmetadata:\n  name: t\n  org: globex\n"), ACME_ID, resolver),
    ).rejects.toThrow(`metadata.org 'globex' is not the organization the plugin is installed into ('${ACME_ID}')`);
    await expect(
      resolveOverlayOrganizations(overlayOf("kind: Agent\nmetadata:\n  name: t\n  org: globex\n"), ACME_ID, resolver, () => Promise.resolve("acme")),
    ).rejects.toThrow("is not the organization the plugin is installed into ('acme')");
    await expect(
      resolveOverlayOrganizations(overlayOf("kind: Agent\nmetadata:\n  name: t\n  org: nobody\n"), ACME_ID, resolver),
    ).rejects.toBeInstanceOf(OverlayParseError);
  });
});
