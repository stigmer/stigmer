// The plugin's guard (plugin/hooks): its tool list is exactly the tools the
// full roster marks destructive, plus the approval tool, in the script and in
// Claude Code's hook matcher; every decision it makes, asked or let through,
// from Claude Code's input and from Cursor's shell hook; Cursor's hooks file
// on that one event, the one where Cursor enforces an ask (its MCP executor
// acts on `deny` alone); and both entry scripts run as their coding agent
// runs them, failing open.
// The CLI's suite holds its command list to the CLI's own --force options
// (client-apps/cli/src/commands/__tests__/coding-agent.test.ts).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { configureLogger, createServer } from "@stigmer/mcp-server";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const hooks = join(root, "plugin", "hooks");

interface Decision {
  hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
}
interface CursorAnswer {
  permission?: string;
  user_message?: string;
  agent_message?: string;
}
interface Guard {
  DESTRUCTIVE_TOOLS: string[];
  APPROVAL_TOOL: string;
  TOOL_PREFIX: string;
  decide(input: unknown): Decision | null;
  decideCursor(input: unknown): CursorAnswer;
  reasonFor(call: { kind: "tool"; name: string; args: Record<string, unknown> } | { kind: "shell"; command: string }): string | null;
  commands(line: string): string[][];
}

let guard: Guard;
let destructive: string[];
let toolNames: string[];

beforeAll(async () => {
  guard = (await import(pathToFileURL(join(hooks, "decide.mjs")).href)) as Guard;
  configureLogger({ level: "error", format: "text" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "guard", version: "test" });
  await Promise.all([createServer({ serverAddress: "127.0.0.1:1", apiKey: "" }).connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  toolNames = tools.map((t) => t.name);
  destructive = tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name).sort();
});

const bash = (command: string) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
const tool = (name: string, input: Record<string, unknown>) => ({
  hook_event_name: "PreToolUse",
  tool_name: `mcp__plugin_stigmer_stigmer__${name}`,
  tool_input: input,
});

describe("what the guard asks about", () => {
  it("names exactly the tools the full roster marks destructive", () => {
    expect(destructive.length).toBeGreaterThan(0);
    expect([...guard.DESTRUCTIVE_TOOLS].sort()).toEqual(destructive);
    expect(toolNames).toContain(guard.APPROVAL_TOOL);
  });

  it("is matched in hooks.json on those tools and the approval tool, by the plugin's tool names, and on stigmer shell commands", () => {
    const file = JSON.parse(readFileSync(join(hooks, "hooks.json"), "utf8")) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string; args: string[]; if?: string }> }> };
    };
    const [tools, shell] = file.hooks.PreToolUse;
    const listed = /^\^mcp__plugin_stigmer_stigmer__\(([a-z_|]+)\)\$$/.exec(tools?.matcher ?? "")?.[1]?.split("|").sort();
    expect(listed).toEqual([...guard.DESTRUCTIVE_TOOLS, guard.APPROVAL_TOOL].sort());
    expect(guard.TOOL_PREFIX).toBe("mcp__plugin_stigmer_stigmer__");
    expect(shell?.matcher).toBe("Bash");
    expect(shell?.hooks[0]?.if).toBe("Bash(stigmer *)");
    for (const group of [tools, shell]) {
      expect(group?.hooks).toEqual([expect.objectContaining({ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"] })]);
    }
  });

  it("points Codex at an empty hooks file of its own (its hooks cannot ask), never Claude Code's", () => {
    const manifest = (path: string) => JSON.parse(readFileSync(join(root, "plugin", path), "utf8")) as { hooks?: string };
    expect(manifest(".codex-plugin/plugin.json").hooks).toBe("./hooks/codex-hooks.json");
    expect(JSON.parse(readFileSync(join(hooks, "codex-hooks.json"), "utf8"))).toEqual({ hooks: {} });
  });

  // Cursor turns an `ask` into a prompt on beforeShellExecution alone: its
  // MCP executor acts on a beforeMCPExecution answer only when it is `deny`,
  // and any MCP hook makes it refuse every server's call that carries a file
  // path, so the plugin hooks no MCP call (cursor-agent 2026.11.19's bundled
  // executor). Cursor fails a hook open unless failClosed is set.
  it("is run by Cursor on beforeShellExecution alone, through cursor-guard.mjs, failing open", () => {
    const manifest = JSON.parse(readFileSync(join(root, "plugin", ".cursor-plugin", "plugin.json"), "utf8")) as { hooks?: string };
    expect(manifest.hooks).toBe("./hooks/cursor-hooks.json");
    expect(JSON.parse(readFileSync(join(hooks, "cursor-hooks.json"), "utf8"))).toEqual({
      version: 1,
      hooks: { beforeShellExecution: [{ command: 'node "${CURSOR_PLUGIN_ROOT}/hooks/cursor-guard.mjs"' }] },
    });
  });
});

describe("decide", () => {
  it.each([
    ["delete_agent", { org: "acme", slug: "invoice-checker" }, /deletes the agent acme\/invoice-checker and every version of it\. It can't be undone\./],
    ["delete_skill", { slug: "export" }, /deletes the skill export and every version/],
    ["cancel_run", { run_id: "run_1" }, /cancels run run_1/],
    ["submit_run_approval", { run_id: "run_1", decision: "allow" }, /approval with "allow".*the person's to give/],
    ["submit_run_approval", { run_id: "run_1", decision: "allow_all" }, /"allow_all"/],
  ])("asks before %s %j", (name, input, reason) => {
    const answer = guard.decide(tool(name, input));
    expect(answer?.hookSpecificOutput.permissionDecision).toBe("ask");
    expect(answer?.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(answer?.hookSpecificOutput.permissionDecisionReason).toMatch(reason);
    expect(answer?.hookSpecificOutput.permissionDecisionReason).toMatch(/stop and ask them first\.$/);
  });

  it.each([
    ["submit_run_approval", { run_id: "run_1", decision: "deny" }],
    ["get_agent", { slug: "x" }],
    ["apply_agent", { name: "x" }],
    ["run_agent", { agent: "x" }],
  ])("lets %s %j through", (name, input) => {
    expect(guard.decide(tool(name, input))).toBeNull();
  });

  it("knows a destructive tool by the list alone", () => {
    expect(guard.decide(tool("delete_agent", {}))?.hookSpecificOutput.permissionDecisionReason).toMatch(/the agent \?/);
  });

  it.each([
    "stigmer delete agent x -f",
    "stigmer delete agent x --force",
    "cd a && stigmer vault remove-secret K --force",
    "stigmer reset --force",
    "stigmer --org acme service-account delete ci -f",
    "STIGMER_DEBUG=1 stigmer provider-key delete anthropic --force=true",
    "stigmer vault remove-connection github.com --mine -yf",
    "stigmer example get invoice-match -f",
    "stigmer app-handover --stack node --agent x --write . --force",
    "npx @stigmer/cli@latest delete skill y -f",
    "/usr/local/bin/stigmer delete agent 'a b' -f",
    "stigmer runs approve run_1",
    "stigmer runs approve run_1 --action allow-all",
    "stigmer runs approve run_1 --action=allow",
    "echo hi; (stigmer delete agent x -f)",
  ])("asks before `%s`", (command) => {
    expect(guard.decide(bash(command))?.hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it.each([
    "stigmer delete agent x",
    "stigmer apply -f a.yaml",
    "stigmer validate -f ./manifests/",
    "stigmer logs -f",
    "stigmer runs logs run_1 -f",
    "stigmer list agents",
    "stigmer reset",
    "stigmer reset -f",
    "stigmer --force-color delete agent x",
    "stigmer delete agent x --force=false",
    "stigmer runs approve run_1 --action deny --comment 'not on prod'",
    "echo 'stigmer delete agent x -f'",
    "git push -f",
    "",
  ])("lets `%s` through", (command) => {
    expect(guard.decide(bash(command))).toBeNull();
  });

  it.each([null, 1, "x", {}, { tool_name: 3 }, { tool_name: "Bash" }, { tool_name: "Bash", tool_input: { command: 3 } }, { tool_name: "Read", tool_input: {} }])(
    "says nothing about malformed or other input %j",
    (input) => {
      expect(guard.decide(input)).toBeNull();
    },
  );

  it("says nothing when reading the input throws, rather than fail the call", () => {
    const hostile = {
      get tool_name(): string {
        throw new Error("boom");
      },
    };
    expect(guard.decide(hostile)).toBeNull();
  });

  it("reads no command words after `--`", () => {
    expect(guard.decide(bash("stigmer -- delete agent x -f"))).toBeNull();
  });

  it("splits a shell line into its commands, quotes and assignments removed", () => {
    expect(guard.commands(`A=1 stigmer run x -m "a; b" && echo 'c|d' | cat\nls \\-f`)).toEqual([
      ["stigmer", "run", "x", "-m", "a; b"],
      ["echo", "c|d"],
      ["cat"],
      ["ls", "-f"],
    ]);
    expect(guard.commands(`echo "say \\"hi\\""`)).toEqual([["echo", 'say "hi"']]);
  });
});

describe("reasonFor, the one decision both coding agents' sides read", () => {
  it("answers the same reason for a tool call and a shell line as decide gives Claude Code", () => {
    const toolReason = guard.reasonFor({ kind: "tool", name: "delete_agent", args: { org: "acme", slug: "x" } });
    expect(guard.decide(tool("delete_agent", { org: "acme", slug: "x" }))?.hookSpecificOutput.permissionDecisionReason.startsWith(toolReason ?? "-")).toBe(true);
    const shellReason = guard.reasonFor({ kind: "shell", command: "stigmer delete agent x -f" });
    expect(guard.decide(bash("stigmer delete agent x -f"))?.hookSpecificOutput.permissionDecisionReason.startsWith(shellReason ?? "-")).toBe(true);
    expect(guard.reasonFor({ kind: "tool", name: "get_agent", args: {} })).toBeNull();
    expect(guard.reasonFor({ kind: "shell", command: "stigmer list agents" })).toBeNull();
  });

  it("says nothing about a call of a kind it does not know", () => {
    expect(guard.reasonFor({ kind: "file", path: "x" } as unknown as { kind: "shell"; command: string })).toBeNull();
  });
});

// Cursor's hook input, as Cursor 2026.11.19 hands it.
const cursorShell = (command: string) => ({ hook_event_name: "beforeShellExecution", command, cwd: "" });

describe("decideCursor", () => {
  it.each([
    ["stigmer delete agent acme/invoice-checker -f", /skips the CLI's own question with --force/],
    ["stigmer runs approve run_1 --action allow", /approval with "allow"/],
  ])("asks before `%s`, telling the person and the agent", (command, reason) => {
    const answer = guard.decideCursor(cursorShell(command));
    expect(answer.permission).toBe("ask");
    expect(answer.user_message).toMatch(reason);
    expect(answer.agent_message).toMatch(reason);
    expect(answer.agent_message).toMatch(/stop and ask them first\.$/);
  });

  it.each(["stigmer delete agent x", "stigmer list agents", "git push -f"])("lets the shell line `%s` through", (command) => {
    expect(guard.decideCursor(cursorShell(command))).toEqual({});
  });

  it("says nothing about an MCP call, which the plugin does not hook in Cursor", () => {
    const mcp = { hook_event_name: "beforeMCPExecution", tool_name: "delete_agent", tool_input: '{"slug":"x"}', mcp_server_name: "plugin-stigmer-stigmer" };
    expect(guard.decideCursor(mcp)).toEqual({});
  });

  it.each([null, 1, "x", {}, { hook_event_name: "preToolUse", tool_name: "Shell" }, { hook_event_name: "beforeShellExecution" }])(
    "says nothing about malformed or other input %j",
    (input) => {
      expect(guard.decideCursor(input)).toEqual({});
    },
  );

  it("says nothing when reading the input throws, rather than fail the call", () => {
    const hostile = {
      get hook_event_name(): string {
        throw new Error("boom");
      },
    };
    expect(guard.decideCursor(hostile)).toEqual({});
  });
});

describe("cursor-guard.mjs, as Cursor runs it", () => {
  const run = (stdin: string) => spawnSync(process.execPath, [join(hooks, "cursor-guard.mjs")], { input: stdin, encoding: "utf8" });

  it("prints the ask as JSON and exits 0", () => {
    const result = run(JSON.stringify(cursorShell("stigmer delete agent x --force")));
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as CursorAnswer).permission).toBe("ask");
  });

  it("prints {} and exits 0 for a call it lets through, and for input it can't read", () => {
    for (const stdin of [JSON.stringify(cursorShell("stigmer list agents")), "not json", ""]) {
      const result = run(stdin);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({});
    }
  });
});

describe("guard.mjs, as Claude Code runs it", () => {
  const run = (stdin: string) => spawnSync(process.execPath, [join(hooks, "guard.mjs")], { input: stdin, encoding: "utf8" });

  it("prints the ask as JSON and exits 0", () => {
    const result = run(JSON.stringify(bash("stigmer delete agent x -f")));
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as Decision).hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("prints nothing and exits 0 for a call it lets through, and for input it can't read", () => {
    for (const stdin of [JSON.stringify(bash("stigmer list agents")), "not json", ""]) {
      const result = run(stdin);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    }
  });
});
