/**
 * Pins the reference page of roles and general access. Every row comes from
 * the kind table's grantable roles, team roles and per-kind role sentences,
 * and from each role's role_meta name, so a role the contract adds, removes
 * or rewords moves the page with it on the next codegen run.
 *
 * The generator runs over the real schemas and API tree into a temporary
 * directory, and these cases read what it wrote.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSDKDocsGeneration } from "../sdk-docs.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");
const APIS = path.resolve(__dirname, "../../../../../apis");
// One generator run writes every resource page; beside other suites it
// outlasts vitest's ten-second hook default.
const GENERATE_TIMEOUT_MS = 60_000;

// The text of one kind's section, from its heading to the next.
function section(page: string, heading: string): string {
  const start = page.indexOf(`\n## ${heading}\n`);
  expect(start, `no section for ${heading}`).toBeGreaterThanOrEqual(0);
  const end = page.indexOf("\n## ", start + 1);
  return end < 0 ? page.slice(start) : page.slice(start, end);
}

describe("the roles reference page", () => {
  let root: string;
  let page: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-docs-roles-"));
    runSDKDocsGeneration(SCHEMAS, root, APIS);
    page = fs.readFileSync(path.join(root, "roles.mdx"), "utf8");
  }, GENERATE_TIMEOUT_MS);

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  }, GENERATE_TIMEOUT_MS);

  it("is listed in the folder's navigation", () => {
    const meta = JSON.parse(
      fs.readFileSync(path.join(root, "meta.json"), "utf8"),
    ) as { pages: string[] };
    expect(meta.pages).toContain("roles");
  });

  it("gives an agent its three roles, the two a team may hold, and its general access levels", () => {
    const agent = section(page, "Agent");
    expect(agent).toContain(
      "Served by every edition. [API reference](/docs/sdk/resources/agent)\n",
    );
    expect(agent).toContain(
      "**General access**: Private, Organization (the default), Child organizations.\n",
    );
    expect(agent).toContain("| Role | What it allows | A team may hold it |\n");
    expect(agent).toContain(
      "| Owner | Everything, including deleting it and deciding who has access | No |\n",
    );
    expect(agent).toContain(
      "| Editor | Change and run it; cannot delete it or decide who has access | Yes |\n",
    );
    expect(agent).toContain(
      "| Viewer | Run it and see how it is set up; cannot change it | Yes |\n",
    );
  });

  it("gives a conversation a Participant who sends and a Viewer who does not, granted to people only", () => {
    const session = section(page, "Session");
    expect(session).toContain(
      "**General access**: Private only. It is reached through the roles below.\n",
    );
    expect(session).toContain(
      "| Participant | Read the conversation and send messages |\n",
    );
    expect(session).toContain(
      "| Viewer | Read the conversation; cannot send messages |\n",
    );
    expect(session).toContain("Granted to people only, never to a team.\n");
  });

  it("names a vault's one role Can use, with Organization offered and Private the default", () => {
    const vault = section(page, "Vault");
    expect(vault).toContain(
      "**General access**: Private (the default), Organization.\n",
    );
    expect(vault).toContain(
      "| Can use | Use this vault's logins and secrets in their runs | Yes |\n",
    );
  });

  it("gives the organization its four roles in the contract's sentences", () => {
    const organization = section(page, "Organization");
    for (const role of ["Owner", "Admin", "Member", "Viewer"]) {
      expect(organization).toMatch(
        new RegExp(`\\n\\| ${role} \\| [^|]+ \\|\\n`),
      );
    }
    expect(organization).toContain(
      "| Viewer | See what is shared with the organization; cannot start conversations |\n",
    );
  });

  it("names the editions an enterprise kind is served by", () => {
    expect(section(page, "Team")).toContain(
      "Served by the Enterprise and Cloud editions.",
    );
  });

  it("leaves out a kind no role can be granted on", () => {
    expect(page).not.toContain("\n## Run\n");
    expect(page).not.toContain("\n## API Key\n");
  });
});
