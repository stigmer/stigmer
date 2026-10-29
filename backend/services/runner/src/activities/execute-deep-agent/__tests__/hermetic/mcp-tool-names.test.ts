/**
 * Hermetic: two MCP servers that each list a tool of one name are two tools
 * on the Stigmer harness, through the REAL `ExecuteDeepAgent` activity
 * (stigmer#1860).
 *
 * The model is offered every server's tool as `mcp__<server>__<tool>`, the
 * name Claude Code gives it, the name agents' tool lists and Claude-Code-
 * format hooks already use, and the one the console tells people their tools
 * have (`shared/mcp-tool-names.ts`). Everything that leaves the engine keeps
 * the bare tool beside its server. Pinned, each against the server that
 * actually ran:
 *  - `github` and `notes` both list `remove`; github marks its own
 *    destructive. A call to github's asks first, on a card naming github,
 *    and never reaches either server. Until stigmer#1860 the turn never got
 *    that far: two tools of one name fail langchain's tool-identity check
 *    at the first model call ("You have modified a tool in wrapModelCall",
 *    langchain 1.5.14, whose registry is keyed by name).
 *  - A hook matching `mcp__notes__remove` refuses notes' call, and only
 *    that one: the refused row names notes.
 *  - github's own `write_file` is github's tool, judged by github's default
 *    (it carries no destructive mark, so it runs unasked) and handed its
 *    arguments as the model wrote them. Until then a server tool named like
 *    one of deepagents' own (`write_file`, `delete`, `ls`, `execute`, …)
 *    failed the whole turn: `createDeepAgent` refuses a custom tool with a
 *    built-in's name (`TOOL_NAME_COLLISION`, deepagents 1.14.1).
 *  - A saved subagent's call to its own server's `remove` runs, and its row
 *    names that server (a sub-agent's MCP row named none before).
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { HookSourceSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { savedAgentFixture } from "../../../../__test-utils__/execution-record-fixture.js";
import { ScriptedClock, createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { HttpMcpServer } from "../../../../__test-utils__/http-mcp-server.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { ApprovalPolicySource, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const OPEN_SCHEMA = { type: "object" as const, properties: { target: { type: "string" } } };
const WRITE_SCHEMA = { type: "object" as const, properties: { file_path: { type: "string" }, content: { type: "string" } } };

const github = new HttpMcpServer(
  [
    { name: "remove", description: "Remove a repository.", inputSchema: OPEN_SCHEMA, annotations: { destructiveHint: true } },
    { name: "write_file", description: "Write a file into a repository.", inputSchema: WRITE_SCHEMA },
  ],
  async (tool) => `github ${tool} ran`,
);
const notes = new HttpMcpServer([{ name: "remove", description: "Remove a note.", inputSchema: OPEN_SCHEMA }], async (tool) => `notes ${tool} ran`);
const wiki = new HttpMcpServer([{ name: "remove", description: "Remove a wiki page.", inputSchema: OPEN_SCHEMA }], async (tool) => `wiki ${tool} ran`);

const HELPER_INSTRUCTIONS = "You are the hermetic wiki helper.";

/** The agent's own hook: refuses notes' `remove` by its Claude Code name, and nothing else. */
const refusesNotesRemove = create(HookSourceSchema, {
  source: {
    case: "inline",
    value: create(HookConfigSchema, {
      format: HookFormat.CLAUDE_CODE,
      groups: [create(HookGroupSchema, {
        event: "PreToolUse",
        matcher: "mcp__notes__remove",
        handlers: [create(HookHandlerSchema, {
          command: "/bin/echo",
          args: ['{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"notes are kept"}}'],
        })],
      })],
    }),
  },
});

describe("ExecuteDeepAgent hermetic — two servers' tools of one name are two tools", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(async () => {
    await Promise.all([github.start(), notes.start(), wiki.start()]);
    env = createHermeticEnvironment();
    registry = stubRegistryFetch({ localOrigins: [github.url, notes.url, wiki.url] });
    clock.install();
  });

  afterAll(async () => {
    clock.uninstall();
    registry.restore();
    env.dispose();
    await Promise.all([github.stop(), notes.stop(), wiki.stop()]);
  });

  it("offers each server's tool by its server, and approves, hooks and records the one that runs", async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({
      message: "Tidy up.",
      hooks: [refusesNotesRemove],
      mcpServers: [
        { name: "github", url: `${github.url}/mcp` },
        { name: "notes", url: `${notes.url}/mcp` },
      ],
    });
    const offered: string[][] = [];
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (tools) => {
        offered.push([...tools]);
        return {
          turns: [
            { toolCalls: [{ id: "call-notes-remove", name: "mcp__notes__remove", args: { target: "old" } }] },
            { toolCalls: [{ id: "call-github-write", name: "mcp__github__write_file", args: { file_path: "/report.md", content: "kept" } }] },
            { toolCalls: [{ id: "call-github-remove", name: "mcp__github__remove", args: { target: "stigmer" } }] },
            { text: "Done." },
          ],
        };
      },
    });
    const workspace = sessionWorkspaceDir(env);
    mkdirSync(workspace, { recursive: true });

    await runDeepAgentTurn(scenario);

    expect(offered[0]).toEqual(expect.arrayContaining(["mcp__github__remove", "mcp__notes__remove", "mcp__github__write_file", "write_file"]));
    expect(offered[0], "no bare server tool reaches the model").not.toContain("remove");

    expect(record.persistedPhases.at(-1), "github's destructive remove waits for a person").toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(record.toolCalls().map((row) => [row.id, row.name, row.mcpServerSlug, row.status, row.requiresApproval])).toEqual([
      ["call-notes-remove", "remove", "notes", ToolCallStatus.TOOL_CALL_FAILED, false],
      ["call-github-write", "write_file", "github", ToolCallStatus.TOOL_CALL_COMPLETED, false],
      ["call-github-remove", "remove", "github", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, true],
    ]);
    const [refused, , waiting] = record.toolCalls();
    expect(refused!.approvalPolicySource, "the hook refused notes' call").toBe(ApprovalPolicySource.HOOK);
    expect(waiting!.approvalPolicySource, "github's own mark asks").toBe(ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN);

    expect(github.calls, "github's write got the model's arguments; its remove never ran").toEqual([
      { tool: "write_file", args: { file_path: "/report.md", content: "kept" } },
    ]);
    expect(notes.calls, "notes' remove never ran").toEqual([]);
    expect(existsSync(join(workspace, "report.md")), "the engine's own write_file never ran").toBe(false);
    expect(registry.urls.every((u) => u.includes("/model-registry") || [github.url, notes.url, wiki.url].some((o) => u.startsWith(o)))).toBe(true);
  });

  it("names a subagent's server on its row", async () => {
    clock.reset();
    const helper = savedAgentFixture("helper", {
      description: "Tidies the wiki.",
      instructions: HELPER_INSTRUCTIONS,
      harness: Harness.STIGMER,
      mcpServers: [{ name: "wiki", url: `${wiki.url}/mcp` }],
    });
    const record = deepAgentExecutionRecord({ message: "Ask helper to tidy the wiki.", subagents: [helper] });
    const offered: string[][] = [];
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (tools, context) => {
        if (context.systemPrompt.includes(HELPER_INSTRUCTIONS)) {
          offered.push([...tools]);
          return {
            turns: [
              { toolCalls: [{ id: "call-wiki-remove", name: "mcp__wiki__remove", args: { target: "stale" } }] },
              { text: "Tidied." },
            ],
          };
        }
        return {
          turns: [
            { toolCalls: [{ id: "call-task", name: "task", args: { description: "Tidy the wiki.", subagent_type: "helper" } }] },
            { text: "Done." },
          ],
        };
      },
    });
    mkdirSync(sessionWorkspaceDir(env), { recursive: true });

    await runDeepAgentTurn(scenario);

    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    expect(offered[0]).toContain("mcp__wiki__remove");
    const subRows = record.lastFullRows!.subAgentRuns.flatMap((run) => run.messages.flatMap((m) => m.toolCalls));
    expect(subRows.map((row) => [row.id, row.name, row.mcpServerSlug, row.status])).toEqual([
      ["call-wiki-remove", "remove", "wiki", ToolCallStatus.TOOL_CALL_COMPLETED],
    ]);
    expect(wiki.calls).toEqual([{ tool: "remove", args: { target: "stale" } }]);
  });
});
