/**
 * Pins the driver-neutral half of the sub-agent retirement
 * (../sub-agents-retired.ts) over agent rows built the way an earlier
 * release wrote them, the sub-agents in the retired AgentSpec field 6
 * (retired-mcp-server-rows.ts):
 *   - each sub-agent is dropped and logged at warn as a ready-to-apply
 *     Agent manifest: its name made a slug, its description and
 *     instructions, its skills, the parent's plugins and env declarations,
 *     its own tools else the parent's, the union of both disallowed lists,
 *     and a model override as `run_config.model_name` on the native engine;
 *     the same line carries the `subagents` entry to add to the parent;
 *   - the changed agent heads a new version: the recomputed spec hash, the
 *     previous one named, the step's message; nothing else of it changes;
 *   - an agent without sub-agents, or without a spec, is left (undefined),
 *     and nothing is logged;
 *   - the frozen slug rule;
 *   - a session pinned to a changed agent moves to its new version, never
 *     one pinned to no version, already on it, or on another agent;
 *   - bytes that do not decode throw, and the step's error names the row.
 * The drivers' migration tests pin the SQL around these functions.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { canonicalSpecHash } from "../../pipeline/steps/spec-hash.js";
import { readSubAgents } from "../frozen-sub-agent.js";
import {
  SUB_AGENT_REMOVED_MESSAGE,
  allowedByBoth,
  SUB_AGENT_RETIREMENT_AGENT_KIND,
  SUB_AGENT_RETIREMENT_SESSION_KIND,
  SUB_AGENT_RETIREMENT_VERSION_MESSAGE,
  frozenSlug,
  repinSessionRow,
  retireSubAgentsInAgentRow,
  unreadableSubAgentRowError,
} from "../sub-agents-retired.js";
import {
  pluginRef,
  recordingLogger,
  retiredAgentRow,
  retiredSessionRow,
  skillRef,
} from "./retired-mcp-server-rows.js";
import type { SubAgentInit } from "./retired-mcp-server-rows.js";

const ORG = "org_01jz0000000000000000000000";
const OLD = "a".repeat(64);

/** A parent agent with plugins, env and tool lists, holding `subAgents`. */
function parentRow(subAgents: readonly SubAgentInit[]): Uint8Array {
  return retiredAgentRow({
    metadata: { id: "agt_parent", org: ORG, slug: "reviewer", name: "reviewer", labels: { team: "core" } },
    spec: {
      description: "Reviews pull requests",
      instructions: "Review every pull request with care.",
      plugins: [pluginRef("gh-tools", ORG)],
      env: {
        GITHUB_TOKEN: { description: "a token for the GitHub API", isSecret: true },
        REGION: { value: "eu", isSecret: false },
      },
      tools: ["Read", "mcp__plugin_gh-tools_github__*"],
      disallowedTools: ["Bash", "WebFetch"],
    },
    status: { versionHash: OLD },
    subAgents,
  });
}

const TRIAGER: SubAgentInit = {
  name: "Issue Triager",
  description: "Sorts new issues",
  instructions: "Triage every new issue.",
  skillRefs: [skillRef("house-style", ORG)],
  modelOverride: "claude-sonnet-4-5",
  tools: ["Read", "Grep"],
  disallowedTools: ["WebFetch", "Write"],
};

/** What one warning carried: the manifest parsed, and the line to add to the parent. */
function logged(fields: Record<string, unknown> | undefined): {
  agent: unknown;
  subagent: unknown;
  manifest: Record<string, unknown>;
  addToAgent: unknown;
} {
  return {
    agent: fields?.["agent"],
    subagent: fields?.["subagent"],
    manifest: yaml.load(String(fields?.["manifest"])) as Record<string, unknown>,
    addToAgent: yaml.load(String(fields?.["add_to_agent"])),
  };
}

describe("a manifest's tools are what the sub-agent could use under both lists", () => {
  it("takes either list alone when the other is empty", () => {
    expect(allowedByBoth([], ["Read", "Grep"])).toEqual(["Read", "Grep"]);
    expect(allowedByBoth(["Read"], [])).toEqual(["Read"]);
  });

  it("keeps an entry only when an entry of the other list admits it, the narrower of the two", () => {
    // A server's family admits its tools and the family itself; mcp__* admits every MCP entry.
    expect(allowedByBoth(["mcp__plugin_gh_github"], ["mcp__plugin_gh_github__read", "Read"])).toEqual([
      "mcp__plugin_gh_github__read",
    ]);
    expect(allowedByBoth(["mcp__plugin_gh_github__read"], ["mcp__plugin_gh_github__*"])).toEqual([
      "mcp__plugin_gh_github__read",
    ]);
    expect(allowedByBoth(["mcp__*"], ["mcp__plugin_gh_github", "Bash"])).toEqual(["mcp__plugin_gh_github"]);
    // A bare tool admits its specified forms; one tool never admits another.
    expect(allowedByBoth(["Bash"], ["Bash(git status *)", "Write"])).toEqual(["Bash(git status *)"]);
    expect(allowedByBoth(["mcp__plugin_gh_github__read"], ["mcp__plugin_gh_github__write"])).toEqual(["Skill"]);
  });

  it("grants no tool when the lists share none: only Skill, which names no tool", () => {
    expect(allowedByBoth(["Read"], ["Bash", "Write"])).toEqual(["Skill"]);
  });
});

describe("an agent's sub-agents are dropped and logged as agent manifests", () => {
  it("logs a manifest that runs as the sub-agent ran, with the subagents entry for the parent", () => {
    const logger = recordingLogger();
    const result = retireSubAgentsInAgentRow(parentRow([TRIAGER]), logger);
    expect(result).toBeDefined();

    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.message).toBe(SUB_AGENT_REMOVED_MESSAGE);
    const line = logged(logger.warnings[0]?.fields);
    expect(line.agent).toBe(`${ORG}/reviewer`);
    expect(line.subagent).toBe("Issue Triager");
    expect(line.manifest).toEqual({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "issue-triager" },
      spec: {
        description: "Sorts new issues",
        instructions: "Triage every new issue.",
        skill_refs: [{ kind: "skill", org: ORG, slug: "house-style" }],
        // The parent's plugins and shell: the sub-agent used both.
        plugins: [{ kind: "plugin", org: ORG, slug: "gh-tools" }],
        env: {
          GITHUB_TOKEN: { description: "a token for the GitHub API", is_secret: true },
          REGION: { value: "eu" },
        },
        // The tools both lists admit: the parent's list never admitted
        // Grep, so the sub-agent could not use it, and the manifest grants
        // it neither. The union of both disallowed lists.
        tools: ["Read"],
        disallowed_tools: ["Bash", "WebFetch", "Write"],
        run_config: { model_name: "claude-sonnet-4-5" },
        harness: "HARNESS_STIGMER",
      },
    });
    expect(line.addToAgent).toEqual({ subagents: [{ kind: "agent", slug: "issue-triager" }] });
  });

  it("a sub-agent with no tools of its own takes the parent's, and one with no model override names no engine", () => {
    const logger = recordingLogger();
    retireSubAgentsInAgentRow(
      parentRow([{ name: "writer", instructions: "Write the release notes." }]),
      logger,
    );
    const { manifest } = logged(logger.warnings[0]?.fields);
    const spec = manifest["spec"] as Record<string, unknown>;
    expect(spec["tools"]).toEqual(["Read", "mcp__plugin_gh-tools_github__*"]);
    expect(spec["disallowed_tools"]).toEqual(["Bash", "WebFetch"]);
    expect(spec).not.toHaveProperty("run_config");
    expect(spec).not.toHaveProperty("harness");
    expect(spec).not.toHaveProperty("description");
    expect(spec).not.toHaveProperty("skill_refs");
    expect(manifest["metadata"]).toEqual({ name: "writer" });
  });

  it("a parent with no plugins, env or tool lists writes none into the manifest", () => {
    const logger = recordingLogger();
    retireSubAgentsInAgentRow(
      retiredAgentRow({
        metadata: { id: "agt_bare", org: ORG, slug: "bare", name: "bare" },
        spec: { instructions: "A bare parent agent." },
        subAgents: [{ name: "helper", instructions: "Help the parent." }],
      }),
      logger,
    );
    const { manifest } = logged(logger.warnings[0]?.fields);
    expect(manifest["spec"]).toEqual({ instructions: "Help the parent." });
  });

  it("logs one line per sub-agent, in order", () => {
    const logger = recordingLogger();
    retireSubAgentsInAgentRow(parentRow([TRIAGER, { name: "writer", instructions: "Write." }]), logger);
    expect(logger.warnings.map((warning) => warning.fields?.["subagent"])).toEqual(["Issue Triager", "writer"]);
  });

  it("stores the parent without its sub-agents as a new version, everything else as it was", () => {
    const before = fromBinary(AgentSchema, parentRow([TRIAGER]));
    const result = retireSubAgentsInAgentRow(parentRow([TRIAGER]), recordingLogger())!;
    const after = fromBinary(AgentSchema, result.data);

    expect(readSubAgents(after.spec!)).toEqual([]);
    expect((after.spec as { $unknown?: unknown }).$unknown).toBeUndefined();
    const newHash = canonicalSpecHash(AgentSpecSchema, after.spec!);
    expect(newHash).not.toBe(OLD);
    expect(result.versionHash).toBe(newHash);
    expect(after.status?.versionHash).toBe(newHash);
    expect(after.metadata?.version?.id).toBe(newHash);
    expect(after.metadata?.version?.previousVersionId).toBe(OLD);
    expect(after.metadata?.version?.message).toBe(SUB_AGENT_RETIREMENT_VERSION_MESSAGE);

    // Nothing else of the parent moves.
    expect(after.metadata?.labels).toEqual(before.metadata?.labels);
    expect(after.spec?.instructions).toBe(before.spec?.instructions);
    expect(after.spec?.plugins).toEqual(before.spec?.plugins);
    expect(after.spec?.env).toEqual(before.spec?.env);
    expect(after.spec?.tools).toEqual(before.spec?.tools);
    expect(after.spec?.disallowedTools).toEqual(before.spec?.disallowedTools);

    // A second pass finds nothing to do.
    expect(retireSubAgentsInAgentRow(result.data, recordingLogger())).toBeUndefined();
  });

  it("leaves an agent without sub-agents, or without a spec, and logs nothing", () => {
    const logger = recordingLogger();
    expect(retireSubAgentsInAgentRow(parentRow([]), logger)).toBeUndefined();
    expect(
      retireSubAgentsInAgentRow(
        toBinary(AgentSchema, create(AgentSchema, { metadata: { id: "agt_nospec", org: ORG } })),
        logger,
      ),
    ).toBeUndefined();
    expect(logger.warnings).toEqual([]);
  });

  it("throws on bytes that do not decode, and the step's error names the row", () => {
    expect(() => retireSubAgentsInAgentRow(new Uint8Array([0xff, 0xff, 0xff]), recordingLogger())).toThrow();
    const cause = new Error("premature EOF");
    const error = unreadableSubAgentRowError("agent", "agt_bad", cause);
    expect(error.message).toBe(
      "agent 'agt_bad' cannot be read to retire sub-agents written inside agents: Error: premature EOF",
    );
    expect(error.cause).toBe(cause);
  });
});

describe("the frozen slug rule", () => {
  it.each([
    ["Issue Triager", "issue-triager"],
    ["code_reviewer.v2", "code-reviewer-v2"],
    ["  --Spaced  Out--  ", "spaced-out"],
    ["Ünïcode Bot!", "ncode-bot"],
    ["42 answers", "agent-42-answers"],
    ["???", "subagent"],
    ["", "subagent"],
  ])("makes %j the slug %j", (name, slug) => {
    expect(frozenSlug(name)).toBe(slug);
  });
});

describe("a session on a changed agent", () => {
  const NEW = "b".repeat(64);
  const repinned = new Map([["agt_parent", NEW]]);

  function session(agentId: string, agentVersionHash: string): Uint8Array {
    return retiredSessionRow({
      metadata: { id: "ses_1", org: ORG, slug: "ses-1" },
      spec: { subject: "Review" },
      status: { agentId, agentVersionHash },
    });
  }

  it("moves to the agent's new version", () => {
    const moved = repinSessionRow(session("agt_parent", OLD), repinned);
    expect(moved).toBeDefined();
    const status = fromBinary(SessionSchema, moved!).status;
    expect(status?.agentVersionHash).toBe(NEW);
    expect(status?.agentId).toBe("agt_parent");
  });

  it("is left when pinned to no version, already on the new one, or on another agent", () => {
    expect(repinSessionRow(session("agt_parent", ""), repinned)).toBeUndefined();
    expect(repinSessionRow(session("agt_parent", NEW), repinned)).toBeUndefined();
    expect(repinSessionRow(session("agt_other", OLD), repinned)).toBeUndefined();
    expect(
      repinSessionRow(
        toBinary(SessionSchema, create(SessionSchema, { metadata: { id: "ses_2", org: ORG } })),
        repinned,
      ),
    ).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() => repinSessionRow(new Uint8Array([0xff, 0xff, 0xff]), repinned)).toThrow();
  });
});

describe("the kinds the step reads", () => {
  it("names the agent and session rows by their kind column values", () => {
    expect([SUB_AGENT_RETIREMENT_AGENT_KIND, SUB_AGENT_RETIREMENT_SESSION_KIND]).toEqual([
      ApiResourceKind[ApiResourceKind.agent],
      ApiResourceKind[ApiResourceKind.session],
    ]);
  });
});
