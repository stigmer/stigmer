/**
 * Pins how the SDK resource docs describe an input's organization and name
 * its resource. An organization-scoped kind's `org` is the organization's
 * id, which every resource stores, and a slug is also accepted. Each input
 * names its resource with the article its name takes.
 *
 * The generator runs over the real schemas and API tree into a temporary
 * directory, and these cases read what it wrote.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { indefiniteArticle } from "../gen-common.js";
import { runSDKDocsGeneration } from "../sdk-docs.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");
const APIS = path.resolve(__dirname, "../../../../../apis");

describe("the SDK resource docs", () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-docs-org-"));
    runSDKDocsGeneration(SCHEMAS, root, APIS);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("describes an organization-scoped input's org as the organization's id, a slug also accepted", () => {
    const agent = fs.readFileSync(path.join(root, "agent.mdx"), "utf8");
    expect(agent).toContain(
      '    org: { type: "string", description: "Organization id (a slug is also accepted).", required: true },\n',
    );
    expect(agent).not.toContain("Organization slug.");
  });

  it("names each input's resource with the article its name takes", () => {
    const organization = fs.readFileSync(path.join(root, "organization.mdx"), "utf8");
    expect(organization).toContain("Input for creating or updating an Organization.\n");
    const skill = fs.readFileSync(path.join(root, "skill.mdx"), "utf8");
    expect(skill).toContain("Input for creating or updating a Skill.\n");
  });
});

describe("indefiniteArticle", () => {
  it("answers an before a vowel and a otherwise", () => {
    expect(["Organization", "Agent", "Evaluator", "IamPolicy", "Usage"].map(indefiniteArticle)).toEqual([
      "an",
      "an",
      "an",
      "an",
      "an",
    ]);
    expect(["Skill", "Plugin", ""].map(indefiniteArticle)).toEqual(["a", "a", "a"]);
  });
});
