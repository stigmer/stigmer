/**
 * The console's mirror of the server resolver, per declarer. Pinned for a
 * run with a person: a value given for this run meets a requirement by key
 * alone; an agent's or a git host's key comes from the person's own
 * credential serving it, then the organization's (field by field, as the
 * resolver reads them); an MCP server with personal sign-in takes only the
 * person's own; one with organization sign-in takes only the
 * organization's, and its gap is the organization's to fill; a key the
 * server's sign-in fills is a sign-in, never a typed value; optional keys
 * never block. Pinned for a run with no person: only an assignment for the
 * same declarer and key counts. Also: the platform's own keys are never
 * requirements, and a repository's host is read from its URL.
 */
import { describe, expect, it } from "vitest";
import {
  assignmentReadiness,
  declaredRequirements,
  gitHostOf,
  gitHostRequirement,
  personReadiness,
  type Declarer,
  type Requirement,
} from "../requirements";
import { storedCredential } from "./credential-world";

const ORG = "org_acme";
const AGENT: Declarer = { target: { kind: "agent", org: ORG, slug: "reviewer" }, name: "Reviewer" };
const PERSONAL_SERVER: Declarer = {
  target: { kind: "mcp_server", org: ORG, slug: "linear" },
  name: "Linear",
  signIn: "personal",
  mcpServerId: "mcp_linear",
  signInKey: "LINEAR_TOKEN",
};
const ORG_SERVER: Declarer = {
  target: { kind: "mcp_server", org: ORG, slug: "slack" },
  name: "Slack",
  signIn: "organization",
  mcpServerId: "mcp_slack",
};

function requirement(declarer: Declarer, key: string, optional = false): Requirement {
  return { declarer, key, isSecret: true, optional, description: "" };
}

function keysOf(requirements: readonly Requirement[]): string[] {
  return requirements.map((r) => `${r.declarer.name}:${r.key}`);
}

describe("personReadiness", () => {
  it("meets a requirement from this run's values by key, whoever declares it", () => {
    const result = personReadiness([requirement(AGENT, "API_KEY"), requirement(PERSONAL_SERVER, "API_KEY")], {
      credentials: [],
      runtimeKeys: new Set(["API_KEY"]),
    });
    expect(result.met.map((m) => m.source)).toEqual(["runtime", "runtime"]);
    expect(result.missing).toEqual([]);
  });

  it("reads an agent's key from the person's own credential, then the organization's, field by field", () => {
    const credentials = [
      storedCredential({ id: "mine", org: ORG, owner: "person", fields: ["A"], serves: [AGENT.target] }),
      storedCredential({ id: "team", org: ORG, owner: "org", fields: ["A", "B"], serves: [AGENT.target] }),
    ];
    const result = personReadiness([requirement(AGENT, "A"), requirement(AGENT, "B"), requirement(AGENT, "C")], {
      credentials,
    });
    expect(result.met.map((m) => [m.requirement.key, m.source])).toEqual([
      ["A", "own"],
      ["B", "organization"],
    ]);
    expect(keysOf(result.missing)).toEqual(["Reviewer:C"]);
  });

  it("never reads a declarer's key from a credential serving another declarer", () => {
    const credentials = [storedCredential({ id: "mine", org: ORG, owner: "person", fields: ["KEY"], serves: [AGENT.target] })];
    const result = personReadiness([requirement(PERSONAL_SERVER, "KEY")], { credentials });
    expect(keysOf(result.missing)).toEqual(["Linear:KEY"]);
  });

  it("takes only the person's own credential for a server with personal sign-in", () => {
    const credentials = [
      storedCredential({ id: "team", org: ORG, owner: "org", fields: ["KEY"], serves: [PERSONAL_SERVER.target] }),
    ];
    const result = personReadiness([requirement(PERSONAL_SERVER, "KEY")], { credentials });
    expect(result.met).toEqual([]);
    expect(keysOf(result.missing)).toEqual(["Linear:KEY"]);
  });

  it("takes only the organization's credential for a server with organization sign-in, and reports its gap as the organization's", () => {
    const own = [storedCredential({ id: "mine", org: ORG, owner: "person", fields: ["KEY"], serves: [ORG_SERVER.target] })];
    const unmet = personReadiness([requirement(ORG_SERVER, "KEY")], { credentials: own });
    expect(keysOf(unmet.organization)).toEqual(["Slack:KEY"]);
    expect(unmet.missing).toEqual([]);

    const team = [storedCredential({ id: "team", org: ORG, owner: "org", fields: ["KEY"], serves: [ORG_SERVER.target] })];
    const met = personReadiness([requirement(ORG_SERVER, "KEY")], { credentials: team });
    expect(met.met.map((m) => m.source)).toEqual(["organization"]);
  });

  it("reports a key the server's sign-in fills as a sign-in, never a value to type", () => {
    const result = personReadiness([requirement(PERSONAL_SERVER, "LINEAR_TOKEN"), requirement(PERSONAL_SERVER, "OTHER")], {
      credentials: [],
    });
    expect(keysOf(result.signIns)).toEqual(["Linear:LINEAR_TOKEN"]);
    expect(keysOf(result.missing)).toEqual(["Linear:OTHER"]);
  });

  it("never blocks on an optional key", () => {
    const result = personReadiness([requirement(AGENT, "MAYBE", true)], { credentials: [] });
    expect(result.missing).toEqual([]);
    expect(keysOf(result.optionalMissing)).toEqual(["Reviewer:MAYBE"]);
  });
});

describe("assignmentReadiness", () => {
  const github = { mcpServer: { org: ORG, slug: "linear" } };

  it("counts only an assignment for the same declarer and key", () => {
    const requirements = [requirement(PERSONAL_SERVER, "KEY"), requirement(AGENT, "KEY"), requirement(AGENT, "OPT", true)];
    const result = assignmentReadiness(requirements, [
      { requirement: { declarer: github, key: "KEY" }, credential: { credential: { org: ORG, slug: "bot" } } },
    ]);
    expect(keysOf(result.unassigned)).toEqual(["Reviewer:KEY"]);
    expect(keysOf(result.optionalUnassigned)).toEqual(["Reviewer:OPT"]);
  });

  it("is satisfied by a plain value as much as by a credential field", () => {
    const result = assignmentReadiness([requirement(AGENT, "REGION")], [
      { requirement: { declarer: { agent: { org: ORG, slug: "reviewer" } }, key: "REGION" }, literal: "eu" },
    ]);
    expect(result.unassigned).toEqual([]);
  });
});

describe("requirements", () => {
  it("leaves the platform's own keys out of a declarer's requirements", () => {
    const requirements = declaredRequirements(AGENT, {
      STIGMER_SERVER_ADDRESS: { isSecret: false, optional: false, description: "" },
      API_KEY: { isSecret: true, optional: false, description: "The key" },
    });
    expect(requirements.map((r) => r.key)).toEqual(["API_KEY"]);
  });

  it("reads a repository's host, lowercased, and gives it an optional token requirement", () => {
    expect(gitHostOf("https://GitHub.com/acme/api.git")).toBe("github.com");
    expect(gitHostOf("not a url")).toBeUndefined();
    expect(gitHostRequirement("github.com")).toMatchObject({
      declarer: { target: { kind: "git_host", host: "github.com" } },
      key: "GITHUB_TOKEN",
      optional: true,
    });
  });
});
