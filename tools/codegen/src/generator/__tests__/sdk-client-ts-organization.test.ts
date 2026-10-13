/**
 * Pins how the TypeScript SDK generator carries an organization in a
 * resource's input, and the update it emits. An organization-scoped kind
 * (Agent) takes its organization. An organization-less kind takes none: its
 * input's `org` is the empty string type, documented as belonging to no
 * organization. An update takes the resource itself (named by its
 * metadata.id) and the paths it changes, so no input maps a loaded
 * resource back. Each input's doc names its resource with the article its
 * name takes.
 *
 * The generator runs over the real schemas into a temporary directory, and
 * these cases read what it wrote.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSDKClientTSGeneration } from "../sdk-client-ts.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

/** The generated function that starts at `marker`, to its closing brace; a missing one fails the case. */
function from(text: string, marker: string): string {
  const at = text.indexOf(marker);
  expect(at, `${marker} was generated`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n}\n", at);
  expect(end, `${marker} closes`).toBeGreaterThan(at);
  return text.slice(at, end);
}

describe("the TypeScript SDK's inputs carry an organization only for kinds that have one", () => {
  let root: string;
  let organization: string;
  let agent: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-ts-org-"));
    runSDKClientTSGeneration(SCHEMAS, root);
    organization = fs.readFileSync(path.join(root, "organization.ts"), "utf8");
    agent = fs.readFileSync(path.join(root, "agent.ts"), "utf8");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("an organization's input takes no organization, and says why", () => {
    expect(organization).toContain(
      "   * Always empty: an Organization belongs to no organization, so\n" +
        "   * `metadata.org` stays unset. Omit it.\n" +
        "   */\n" +
        '  org?: "";\n',
    );
    expect(organization).not.toContain("  org: string;\n");
  });

  it("an update takes the resource and the paths it changes, on Update<Kind>Input", () => {
    const update = from(agent, "  async update(");
    expect(update).toContain(
      "  async update(resource: Agent | MessageInitShape<typeof AgentSchema>, paths: string[]): Promise<Agent> {\n",
    );
    expect(update).toContain("this.command.update(create(UpdateAgentInputSchema, { resource, updateMask: { paths } }))");
    expect(organization).not.toContain("UpdateInput(");
  });

  it("names each input's resource with the article its name takes", () => {
    expect(organization).toContain("/** Input for creating or applying an Organization. */\n");
    expect(agent).toContain("/** Input for creating or applying an Agent. */\n");
    expect(fs.readFileSync(path.join(root, "skill.ts"), "utf8")).toContain(
      "/** Input for creating or applying a Skill. */\n",
    );
  });

  it("an organization-scoped kind's input takes its organization", () => {
    expect(agent).toContain("  org: string;\n");
  });
});
