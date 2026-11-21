/**
 * Pins the computer rule (computer.ts), every sentence in one place:
 *   - the reading rule: only COMPUTER_NONE means no computer; unset (a
 *     version or a conversation from before the setting) and no agent at
 *     all (the built-in assistant) have one;
 *   - an agent without one is refused, INVALID_ARGUMENT, for its own
 *     fields: the Claude harness, a Bash entry with or without a specifier
 *     (an empty list and disallowed_tools pass), its own hooks, an
 *     Environment; and FAILED_PRECONDITION for what it lists: a plugin
 *     with hooks, a plugin with a stdio MCP server, a subagent whose pinned
 *     version has a computer (unset counts as having one). An agent with a
 *     computer is never refused, whatever it names;
 *   - a conversation without one is refused, FAILED_PRECONDITION naming
 *     the agent, a repository, a folder, an Environment, the Claude
 *     harness and a plugin with hooks; uploads pass;
 *   - a turn without one is refused a plugin carrying a local program, and
 *     a turn with one is not.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Computer, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";

import type { RunPlugin } from "../../vault/resolve.js";
import {
  CLAUDE_NEEDS_COMPUTER_MESSAGE,
  agentComputer,
  hasComputer,
  refuseAgentWithoutComputer,
  refuseClaudeWithoutComputer,
  refuseConversationWithoutComputer,
  refuseTurnWithoutComputer,
} from "../computer.js";
import type { RunSubagent } from "../run-subagents.js";

function refusal(run: () => void): ConnectError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function noComputer(fields: Omit<MessageInitShape<typeof AgentSpecSchema>, "$typeName"> = {}): AgentSpec {
  return create(AgentSpecSchema, { computer: Computer.NONE, ...fields });
}

const HOOKS = { groups: [{ event: "PreToolUse", matcher: "*", handlers: [{ command: "lint.sh" }] }] };

function plugin(name: string, carries: "hooks" | "stdio" | "http"): RunPlugin {
  return {
    id: `plg_${name}`,
    name,
    status: create(PluginStatusSchema, {
      ...(carries === "hooks" ? { hooks: HOOKS } : {}),
      mcpServers: [
        carries === "stdio"
          ? { name: "git-local", transport: { case: "stdio", value: { command: "npx" } } }
          : { name: "remote", transport: { case: "http", value: { url: "https://remote.example/mcp" } } },
      ],
    }),
  };
}

function subagent(name: string, computer: Computer): RunSubagent {
  return { id: `agt_${name}`, name, versionHash: "a".repeat(64), org: "acme", spec: create(AgentSpecSchema, { computer }) };
}

function conversation(computer: Computer, spec: MessageInitShape<typeof SessionSpecSchema> = {}): Session {
  return create(SessionSchema, { spec, status: { computer } });
}

describe("the reading rule", () => {
  it("reads only COMPUTER_NONE as no computer", () => {
    expect(hasComputer(Computer.NONE)).toBe(false);
    expect(hasComputer(Computer.REQUIRED)).toBe(true);
    expect(hasComputer(Computer.UNSPECIFIED)).toBe(true);
    expect(hasComputer(undefined)).toBe(true);
  });

  it("gives the built-in assistant a computer, and an agent its own setting", () => {
    expect(hasComputer(agentComputer(undefined))).toBe(true);
    expect(agentComputer(create(AgentSpecSchema))).toBe(Computer.UNSPECIFIED);
    expect(agentComputer(noComputer())).toBe(Computer.NONE);
  });
});

describe("an agent without a computer", () => {
  it("is refused the Claude harness", () => {
    const error = refusal(() => refuseAgentWithoutComputer(noComputer({ harness: Harness.CLAUDE }), [], []));
    expect([error.code, error.rawMessage]).toEqual([Code.InvalidArgument, CLAUDE_NEEDS_COMPUTER_MESSAGE]);
  });

  it("is refused a Bash entry, with or without a specifier", () => {
    for (const entry of ["Bash", "Bash(git push *)"]) {
      const error = refusal(() => refuseAgentWithoutComputer(noComputer({ tools: ["Read", entry] }), [], []));
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(
        `this agent has no computer, so its tools can't list '${entry}', which runs commands; remove it from tools, or give the agent a computer`,
      );
    }
  });

  it("keeps an empty tool list, other tools and Bash in disallowed_tools", () => {
    refuseAgentWithoutComputer(noComputer(), [], []);
    refuseAgentWithoutComputer(noComputer({ tools: ["Read", "WebFetch", "mcp__docs__search"], disallowedTools: ["Bash"] }), [], []);
  });

  it("is refused its own hooks, and an empty hooks block passes", () => {
    const error = refusal(() =>
      refuseAgentWithoutComputer(noComputer({ hooks: [{ source: { case: "inline", value: HOOKS } }] }), [], []),
    );
    expect([error.code, error.rawMessage]).toEqual([
      Code.InvalidArgument,
      "this agent has no computer, so it can't run its own hooks; remove its hooks, or give the agent a computer",
    ]);
    refuseAgentWithoutComputer(noComputer({ hooks: [{ source: { case: "inline", value: { groups: [] } } }] }), [], []);
  });

  it("is refused an Environment", () => {
    const error = refusal(() =>
      refuseAgentWithoutComputer(noComputer({ environmentRef: { org: "acme", id: "env_1" } }), [], []),
    );
    expect([error.code, error.rawMessage]).toEqual([
      Code.InvalidArgument,
      "this agent has no computer, so it can't name an Environment; remove environment_ref, or give the agent a computer",
    ]);
  });

  it("is refused a plugin with hooks or a local program, and keeps one whose servers are URLs", () => {
    const hooks = refusal(() => refuseAgentWithoutComputer(noComputer(), [plugin("code-style", "hooks")], []));
    expect([hooks.code, hooks.rawMessage]).toEqual([
      Code.FailedPrecondition,
      "this agent has no computer, so it can't use plugin 'code-style', which runs hooks; remove the plugin, or give the agent a computer",
    ]);
    const stdio = refusal(() => refuseAgentWithoutComputer(noComputer(), [plugin("github-tools", "stdio")], []));
    expect([stdio.code, stdio.rawMessage]).toEqual([
      Code.FailedPrecondition,
      "this agent has no computer, so it can't use plugin 'github-tools', which runs its MCP server 'git-local' as a local program; remove the plugin, or give the agent a computer",
    ]);
    refuseAgentWithoutComputer(noComputer(), [plugin("docs", "http")], []);
  });

  it("is refused a subagent with a computer, one saved before the setting included", () => {
    for (const computer of [Computer.REQUIRED, Computer.UNSPECIFIED]) {
      const error = refusal(() => refuseAgentWithoutComputer(noComputer(), [], [subagent("repo-fixer", computer)]));
      expect([error.code, error.rawMessage]).toEqual([
        Code.FailedPrecondition,
        "this agent has no computer, so it can't list subagent 'repo-fixer', which has one; remove it from subagents, save 'repo-fixer' without a computer and list that version, or give the agent a computer",
      ]);
    }
    refuseAgentWithoutComputer(noComputer(), [], [subagent("triage", Computer.NONE)]);
  });

  it("refuses nothing when the agent has a computer", () => {
    for (const computer of [Computer.REQUIRED, Computer.UNSPECIFIED]) {
      refuseAgentWithoutComputer(
        create(AgentSpecSchema, {
          computer,
          harness: Harness.CLAUDE,
          tools: ["Bash"],
          hooks: [{ source: { case: "inline", value: HOOKS } }],
          environmentRef: { org: "acme", id: "env_1" },
        }),
        [plugin("code-style", "hooks")],
        [subagent("repo-fixer", Computer.REQUIRED)],
      );
    }
  });
});

describe("a conversation without a computer", () => {
  const prefix = "agent 'support-desk' has no computer";

  it("is refused a repository and a folder, naming each, and keeps an upload", () => {
    const repo = refusal(() =>
      refuseConversationWithoutComputer(
        conversation(Computer.NONE, {
          resources: [{ name: "app", resource: { case: "gitRepository", value: { url: "https://github.com/acme/app" } } }],
        }),
        "support-desk",
        [],
      ),
    );
    expect([repo.code, repo.rawMessage]).toEqual([
      Code.FailedPrecondition,
      `${prefix}, so this conversation can't attach repository 'app'; remove it, or give the agent a computer`,
    ]);
    const folder = refusal(() =>
      refuseConversationWithoutComputer(
        conversation(Computer.NONE, {
          resources: [{ name: "notes", resource: { case: "localPath", value: { path: "/Users/me/notes" } } }],
        }),
        "support-desk",
        [],
      ),
    );
    expect(folder.rawMessage).toBe(
      `${prefix}, so this conversation can't attach folder 'notes'; remove it, or give the agent a computer`,
    );
    refuseConversationWithoutComputer(
      conversation(Computer.NONE, { resources: [{ resource: { case: "file", value: { fileId: "fil_1" } } }] }),
      "support-desk",
      [],
    );
  });

  it("is refused an Environment, the Claude harness and a plugin with hooks", () => {
    const environment = refusal(() =>
      refuseConversationWithoutComputer(conversation(Computer.NONE, { environmentRef: { id: "env_1" } }), "support-desk", []),
    );
    expect([environment.code, environment.rawMessage]).toEqual([
      Code.FailedPrecondition,
      `${prefix}, so this conversation can't run in an Environment; remove environment_ref, or give the agent a computer`,
    ]);
    const claude = refusal(() =>
      refuseConversationWithoutComputer(conversation(Computer.NONE, { harness: Harness.CLAUDE }), "support-desk", []),
    );
    expect([claude.code, claude.rawMessage]).toEqual([
      Code.FailedPrecondition,
      `${prefix}, so its conversations can't run on the Claude engine, which always has one; choose the Stigmer engine, or give the agent a computer`,
    ]);
    const hooks = refusal(() =>
      refuseConversationWithoutComputer(conversation(Computer.NONE), "", [plugin("code-style", "hooks")]),
    );
    expect([hooks.code, hooks.rawMessage]).toEqual([
      Code.FailedPrecondition,
      "this conversation's agent has no computer, so this conversation can't use plugin 'code-style', which runs hooks; remove the plugin from the agent or the conversation, or give the agent a computer",
    ]);
  });

  it("refuses nothing when the conversation has a computer", () => {
    for (const computer of [Computer.REQUIRED, Computer.UNSPECIFIED]) {
      refuseConversationWithoutComputer(
        conversation(computer, {
          harness: Harness.CLAUDE,
          environmentRef: { id: "env_1" },
          resources: [{ name: "app", resource: { case: "gitRepository", value: { url: "https://github.com/acme/app" } } }],
        }),
        "repo-fixer",
        [plugin("code-style", "hooks")],
      );
    }
  });

  it("is refused the Claude harness alone, as an eval run's target is", () => {
    refuseClaudeWithoutComputer(Computer.NONE, Harness.STIGMER, "support-desk");
    refuseClaudeWithoutComputer(Computer.REQUIRED, Harness.CLAUDE, "repo-fixer");
    expect(refusal(() => refuseClaudeWithoutComputer(Computer.NONE, Harness.CLAUDE, "support-desk")).code).toBe(
      Code.FailedPrecondition,
    );
  });
});

describe("a turn", () => {
  it("without a computer is refused a plugin that now carries a local program", () => {
    const error = refusal(() =>
      refuseTurnWithoutComputer(conversation(Computer.NONE), "support-desk", [plugin("github-tools", "stdio")]),
    );
    expect([error.code, error.rawMessage]).toEqual([
      Code.FailedPrecondition,
      "agent 'support-desk' has no computer, so this conversation can't use plugin 'github-tools', which runs its MCP server 'git-local' as a local program; remove the plugin from the agent or the conversation, or give the agent a computer",
    ]);
  });

  it("with a computer, or with no conversation stamp, is never refused", () => {
    refuseTurnWithoutComputer(conversation(Computer.REQUIRED), "repo-fixer", [plugin("github-tools", "stdio")]);
    refuseTurnWithoutComputer(undefined, "", [plugin("code-style", "hooks")]);
  });
});
