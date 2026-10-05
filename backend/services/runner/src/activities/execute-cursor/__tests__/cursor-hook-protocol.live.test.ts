/**
 * Live ground truth for the hook protocol the approval gate rides on — the
 * standing instrument an `@cursor/sdk` bump runs before it is trusted
 * (stigmer/stigmer#1053, the first bump; every later one inherits this).
 *
 * WHY THIS EXISTS. The Stigmer HITL gate on the Cursor harness is a
 * `.cursor/hooks.json` `preToolUse` hook (`hook-script.ts`) that reads the
 * SDK's stdin payload and answers `{"permission": "allow" | "deny"}`. Three
 * facts about that payload are load-bearing and none is a TypeScript type:
 *
 *  1. `tool_name` is the HOOK taxonomy, PascalCase (`Write`, `Shell`, `Delete`;
 *     the stream taxonomy is lowercase `edit`, `shell`, `delete`) — the gated
 *     set `BUILT_IN_GATED` (`approval-policy.ts`) is spelled in it.
 *  2. `tool_input` is an OBJECT for built-in tools (a JSON STRING for MCP
 *     tools under `beforeMCPExecution`) — the hook's identity token and the
 *     denial ledger's captured args are computed from it.
 *  3. `hook_event_name` discriminates `preToolUse` from `beforeMCPExecution`.
 *
 * The hermetic tests prove the runner's handling of the shapes CAPTURED at
 * 1.0.13 (`cursor-hook-harness.ts` `hookWrite`, `hookShell`, ...). They cannot
 * see the SDK move. This test runs one real turn that edits a file and runs a
 * shell command under an allow-everything observation hook, then asserts the
 * three facts on what the real SDK sent. A `tool_name` outside the gated set
 * for a write-, shell- or delete-class action is the one outcome that must
 * stop a bump: the gate would let it through.
 *
 * A second case pins two facts the runner's tool-list rules on this engine
 * depend on (`turn-setup.ts` `checkToolScope`, `hook-scope.ts`), first seen
 * on 1.0.31 (live probe, 2026-10-05):
 *
 *  4. A `task` delegation fires NO `preToolUse` (no `Task` entry) and NO
 *     `subagentStart`, though one is registered: `Agent(type, …)` cannot be
 *     held to a type list through the hook, so a type list is refused at
 *     setup and the hook's `subagentStart` / `Task` arms are a second line.
 *  5. The sub-agent's own tool calls fire `preToolUse` with the parent's
 *     `conversation_id`: a call cannot be told to be a sub-agent's, so a
 *     sub-agent with lists of its own is refused at setup, while the main
 *     agent's lists still bind it through `preToolUse`.
 *
 * A third and a fourth case pin what an agent's own hooks rest on, first seen
 * on 1.0.31 (live probe, 2026-10-05; `hook-views.ts`, `hook-server.ts`,
 * `workspace-hook-files.ts`, `hook-tool-hiding.ts`):
 *
 *  6. A create and an edit both reach `preToolUse` as `Write {file_path,
 *     content}`, a glob as `Grep` with an empty pattern and a `glob`, a
 *     deletion as `Delete {file_path}`, a command as `Shell {command, cwd,
 *     timeout}`.
 *  7. `updated_input` from `preToolUse` is applied to a command and a read's
 *     path, never to a written file's content, and `beforeMCPExecution`'s is
 *     not applied at all.
 *  8. `postToolUse` fires for an MCP call (as `MCP:<tool>`) and its
 *     `additional_context` reaches the model; `afterMCPExecution`'s does not.
 *  9. The `project` source runs a `<cwd>/.claude/settings.json` and
 *     `settings.local.json` hook (a `Bash` matcher on a shell call), and a
 *     second folder in `dirs` contributes no hook from either file.
 * 10. A web fetch reaches no hook at all.
 *
 * A bump that changes any of them fails this instrument on purpose: the rules
 * above were chosen from these facts and must be revisited with them.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`, by
 * hand or in the live lane; skips without `CURSOR_API_KEY` outside the lane
 * (`src/__test-utils__/live-gate.ts`). It spends real credits for one short
 * turn, with no product cost cap (the SDK is driven directly, not through an
 * execution), plus one short delegation turn for facts 4 and 5. Findings are
 * PRINTED as well as asserted, so a bump's PR can quote the shapes seen.
 */
import { describe, it, expect } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveSecret } from "../../../__test-utils__/live-gate.js";
import { approvalCategory } from "../approval-policy.js";

const CURSOR_API_KEY = liveSecret("CURSOR_API_KEY") ?? "";

/** One hook invocation as the SDK wrote it to the hook's stdin. */
interface HookInvocation {
  readonly hook_event_name?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
  readonly conversation_id?: unknown;
  readonly subagent_type?: unknown;
}

/**
 * An observation-only preToolUse/beforeMCPExecution/subagentStart hook (the
 * three events the runner's gate registers): appends every
 * invocation's stdin JSON to a log file and ALLOWS everything, so the turn
 * runs to completion and every gated action is seen exactly as the gate would
 * see it.
 */
function installObservationHook(workspaceRoot: string, logPath: string): void {
  const hooksDir = join(workspaceRoot, ".cursor");
  mkdirSync(hooksDir, { recursive: true });
  const scriptPath = join(hooksDir, "observe-hook.sh");
  writeFileSync(
    scriptPath,
    `#!/bin/bash\nINPUT=$(cat)\nprintf '%s\\n' "$INPUT" >> "${logPath}" 2>/dev/null || true\necho '{"permission":"allow"}'\n`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
  writeFileSync(
    join(hooksDir, "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{ command: scriptPath }],
        beforeMCPExecution: [{ command: scriptPath }],
        subagentStart: [{ command: scriptPath }],
      },
    }),
    "utf-8",
  );
}

function readInvocations(logPath: string): HookInvocation[] {
  if (!existsSync(logPath)) return [];
  const invocations: HookInvocation[] = [];
  for (const line of readFileSync(logPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      invocations.push(JSON.parse(line) as HookInvocation);
    } catch {
      /* a partial line from a hook the SDK cut off; nothing to read */
    }
  }
  return invocations;
}

describe.skipIf(!liveSecret("CURSOR_API_KEY"))("Cursor SDK hook protocol (live ground truth)", () => {
  it("delivers PascalCase tool_name, an object tool_input and hook_event_name for a file edit and a shell command", async () => {
    const { Agent } = await import("@cursor/sdk");
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const workspaceRoot = mkdtempSync(join(tmpdir(), "stigmer-hook-protocol-"));
    const stateRoot = join(workspaceRoot, ".sdk-state");
    mkdirSync(stateRoot, { recursive: true });
    const hookLog = join(workspaceRoot, "hook-invocations.jsonl");
    installObservationHook(workspaceRoot, hookLog);

    // Mirror the runner's arrangement (session-lifecycle.ts): local cwd, the
    // "project" setting source that loads .cursor/hooks.json, the session's
    // own store, the SDK's retries off.
    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "composer-2.5" },
      local: {
        cwd: workspaceRoot,
        settingSources: ["project"],
        store: await SqliteLocalAgentStore.open({ workspaceRef: `hook-protocol-${Date.now()}`, stateRoot }),
        enableAgentRetries: false,
      },
    });

    const run = await agent.send(
      "Do exactly two things, in order, without asking questions: " +
        "(1) create a file named probe.txt in the workspace containing the single line 'hook probe'; " +
        "(2) run the shell command `cat probe.txt`. Then reply with the word done.",
    );
    for await (const _event of run.stream()) {
      /* drain: the hook log is the evidence, not the stream */
    }
    const result = await run.wait();
    agent.close();

    const invocations = readInvocations(hookLog);

    // ---- Findings dump (what a bump's PR quotes) ----
    console.log(`[hook-protocol] run status: ${result.status}`);
    for (const inv of invocations) {
      console.log(
        `[hook-protocol] ${String(inv.hook_event_name)}:${String(inv.tool_name)} ` +
          `tool_input=${typeof inv.tool_input} ${JSON.stringify(inv.tool_input).slice(0, 200)}`,
      );
    }

    // The SDK boundary must not hang, and the turn must have reached the hook.
    expect(["finished", "error", "cancelled"]).toContain(result.status);
    expect(invocations.length, "the observation hook saw no tool call — hooks.json was not loaded").toBeGreaterThan(0);

    const builtIns = invocations.filter((inv) => inv.hook_event_name === "preToolUse");
    expect(builtIns.length, "no preToolUse invocation: the built-in tools did not reach the hook").toBeGreaterThan(0);
    for (const inv of builtIns) {
      // Fact 3: the discriminator is present and spelled as the script branches on it.
      expect(inv.hook_event_name).toBe("preToolUse");
      // Fact 1: the hook taxonomy is PascalCase.
      expect(typeof inv.tool_name).toBe("string");
      expect(inv.tool_name as string).toMatch(/^[A-Z]/);
      // Fact 2: built-in tool_input is an object, not a JSON string.
      expect(typeof inv.tool_input).toBe("object");
      expect(inv.tool_input).not.toBeNull();
    }

    // The gate's reach: the write and the shell the prompt forced must have
    // arrived under names the gate classifies. A write- or shell-class action
    // under an unclassified name is the outcome that stops a bump.
    const categories = builtIns.map((inv) => approvalCategory(inv.tool_name as string));
    expect(categories, "the file write reached the hook under a name the gate classifies as write").toContain("write");
    expect(categories, "the shell command reached the hook under a name the gate classifies as shell").toContain("shell");
  }, 300_000);

  it("a task delegation fires no Task preToolUse and no subagentStart, and the sub-agent's calls carry the parent's conversation_id", async () => {
    const { Agent } = await import("@cursor/sdk");
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const workspaceRoot = mkdtempSync(join(tmpdir(), "stigmer-hook-delegation-"));
    const stateRoot = join(workspaceRoot, ".sdk-state");
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, "probe.txt"), "delegation probe\n", "utf-8");
    const hookLog = join(workspaceRoot, "hook-invocations.jsonl");
    installObservationHook(workspaceRoot, hookLog);

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "composer-2.5" },
      local: {
        cwd: workspaceRoot,
        settingSources: ["project"],
        store: await SqliteLocalAgentStore.open({ workspaceRef: `hook-delegation-${Date.now()}`, stateRoot }),
        enableAgentRetries: false,
      },
      agents: {
        reader: {
          description: "Reads one file and reports its content.",
          prompt: "Read the file you are asked about with your read tool and reply with its exact content.",
          model: "inherit",
        },
      },
    });

    const run = await agent.send(
      "Do not read any file yourself. Delegate with the Task tool to the `reader` sub-agent: ask it to read " +
        "probe.txt and report its content. Then reply with what it reported.",
    );
    const streamedToolNames: string[] = [];
    for await (const event of run.stream()) {
      const e = event as { type?: unknown; name?: unknown };
      if (e.type === "tool_call" && typeof e.name === "string") streamedToolNames.push(e.name);
    }
    const result = await run.wait();
    agent.close();

    const invocations = readInvocations(hookLog);
    const taskPreToolUse = invocations.filter((inv) => inv.hook_event_name === "preToolUse" && inv.tool_name === "Task");
    const subagentStarts = invocations.filter((inv) => inv.hook_event_name === "subagentStart");
    const preToolUse = invocations.filter((inv) => inv.hook_event_name === "preToolUse");
    const conversationIds = [...new Set(preToolUse.map((inv) => String(inv.conversation_id)))];

    // ---- Findings dump (what a bump's PR quotes) ----
    console.log(`[hook-delegation] run status: ${result.status}`);
    console.log(`[hook-delegation] streamed tool calls: ${JSON.stringify(streamedToolNames)}`);
    console.log(`[hook-delegation] Task preToolUse invocations: ${taskPreToolUse.length}`);
    console.log(`[hook-delegation] subagentStart invocations: ${subagentStarts.length}`);
    console.log(
      `[hook-delegation] preToolUse: ${JSON.stringify(preToolUse.map((inv) => `${String(inv.tool_name)}@${String(inv.conversation_id)}`))}`,
    );

    expect(["finished", "error", "cancelled"]).toContain(result.status);
    expect(streamedToolNames, "the turn must have delegated, or nothing here was observed").toContain("task");
    // Fact 4: neither hook fires for the delegation.
    expect(taskPreToolUse, "a Task preToolUse arrived: revisit the Agent(type, …) refusal in checkToolScope").toEqual([]);
    expect(subagentStarts, "a subagentStart arrived: revisit the Agent(type, …) refusal in checkToolScope").toEqual([]);
    // Fact 5: the sub-agent's own calls reach preToolUse under the parent's conversation.
    expect(preToolUse.length, "the sub-agent's read never reached preToolUse: the main agent's lists would not bind it").toBeGreaterThan(0);
    expect(conversationIds, "calls carried distinct conversation ids: revisit the sub-agent-lists refusal").toHaveLength(1);
  }, 300_000);

  it("pins the tool shapes, which rewrites apply, and where post-call context reaches the model (facts 6 to 8)", async () => {
    const { Agent } = await import("@cursor/sdk");
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const workspaceRoot = mkdtempSync(join(tmpdir(), "stigmer-hook-rewrites-"));
    const stateRoot = join(workspaceRoot, ".sdk-state");
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, "alpha.txt"), "alpha: APPLE\n", "utf-8");
    writeFileSync(join(workspaceRoot, "beta.txt"), "beta: BANANA\n", "utf-8");
    writeFileSync(join(workspaceRoot, "keep.txt"), "original\n", "utf-8");
    writeFileSync(join(workspaceRoot, "gone.txt"), "bye\n", "utf-8");
    mkdirSync(join(workspaceRoot, "docs"), { recursive: true });
    writeFileSync(join(workspaceRoot, "docs", "a.md"), "# a\n", "utf-8");
    const hookLog = join(workspaceRoot, "hook-invocations.jsonl");
    const mcpLog = join(workspaceRoot, "mcp-calls.jsonl");
    // Rewrites a marked command, a read of alpha.txt, a write of keep.txt and
    // the MCP call's text; hands back context after a grep and an MCP call.
    const hook = join(workspaceRoot, ".cursor", "rewrite-hook.mjs");
    mkdirSync(join(workspaceRoot, ".cursor"), { recursive: true });
    writeFileSync(hook, [
      'import { appendFileSync, readFileSync } from "node:fs";',
      'const t = JSON.parse(readFileSync(0, "utf8"));',
      `appendFileSync(${JSON.stringify(hookLog)}, JSON.stringify(t) + "\\n");`,
      "const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };",
      "const ti = t.tool_input || {};",
      'if (t.hook_event_name === "preToolUse") {',
      '  if (t.tool_name === "Shell" && String(ti.command).includes("PROBE_REWRITE")) out({ permission: "allow", updated_input: { ...ti, command: "echo rewritten > shell-rewritten.txt" } });',
      '  if (t.tool_name === "Read" && String(ti.file_path).endsWith("alpha.txt")) out({ permission: "allow", updated_input: { ...ti, file_path: String(ti.file_path).replace(/alpha\\.txt$/, "beta.txt") } });',
      '  if (t.tool_name === "Write" && String(ti.file_path).endsWith("keep.txt")) out({ permission: "allow", updated_input: { ...ti, content: "REWRITTEN" } });',
      "  out({ permission: \"allow\" });",
      "}",
      'if (t.hook_event_name === "beforeMCPExecution") out({ permission: "allow", updated_input: { text: "rewritten-text" } });',
      'if (t.hook_event_name === "postToolUse" && t.tool_name === "Grep") out({ additional_context: "the secret word is PINEAPPLE" });',
      'if (t.hook_event_name === "postToolUse" && String(t.tool_name).startsWith("MCP:")) out({ additional_context: "the color is TURQUOISE" });',
      'if (t.hook_event_name === "afterMCPExecution") out({ additional_context: "the animal is OCELOT" });',
      "out({});",
    ].join("\n"), "utf-8");
    const command = `${process.execPath} ${hook}`;
    writeFileSync(join(workspaceRoot, ".cursor", "hooks.json"), JSON.stringify({
      version: 1,
      hooks: Object.fromEntries(["preToolUse", "beforeMCPExecution", "postToolUse", "afterMCPExecution"].map((e) => [e, [{ command }]])),
    }), "utf-8");
    const mcpServer = join(workspaceRoot, ".cursor", "echo-mcp.mjs");
    writeFileSync(mcpServer, [
      'import { appendFileSync } from "node:fs";',
      'import { createInterface } from "node:readline";',
      "const send = (m) => process.stdout.write(JSON.stringify(m) + \"\\n\");",
      'createInterface({ input: process.stdin }).on("line", (line) => {',
      "  let m; try { m = JSON.parse(line); } catch { return; }",
      "  if (m.id === undefined) return;",
      '  if (m.method === "initialize") return send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1" } } });',
      '  if (m.method === "tools/list") return send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "echo_tool", description: "Echoes text.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });',
      `  if (m.method === "tools/call") { appendFileSync(${JSON.stringify(mcpLog)}, JSON.stringify(m.params) + "\\n"); return send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "echoed" }] } }); }`,
      '  send({ jsonrpc: "2.0", id: m.id, result: {} });',
      "});",
    ].join("\n"), "utf-8");

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "composer-2.5" },
      local: {
        cwd: workspaceRoot,
        settingSources: ["project"],
        store: await SqliteLocalAgentStore.open({ workspaceRef: `hook-rewrites-${Date.now()}`, stateRoot }),
        enableAgentRetries: false,
      },
      mcpServers: { echo: { type: "stdio", command: process.execPath, args: [mcpServer] } },
    });
    const run = await agent.send(
      "Do each step in order with the right tool, without asking questions: " +
        "(1) read alpha.txt; (2) create created.txt containing 'created'; (3) overwrite keep.txt with 'model wrote this'; " +
        "(4) delete gone.txt with your delete tool, not the shell; (5) search the workspace for the text 'beta' with your search tool; " +
        "(6) find every *.md file with your file-finding tool; (7) run the shell command `echo PROBE_REWRITE > shell-orig.txt`; " +
        "(8) call the MCP tool echo_tool with text 'orig-text'. " +
        "Finally reply with what step 1 read, and any secret word, color or animal you were told about.",
    );
    for await (const _event of run.stream()) {
      /* drain */
    }
    const result = await run.wait();
    agent.close();
    const invocations = readInvocations(hookLog) as Array<HookInvocation & { tool_output?: unknown }>;
    const pre = invocations.filter((inv) => inv.hook_event_name === "preToolUse");
    const text = result.result ?? "";

    console.log(`[hook-rewrites] run status: ${result.status}`);
    for (const inv of pre) console.log(`[hook-rewrites] preToolUse:${String(inv.tool_name)} ${JSON.stringify(inv.tool_input).slice(0, 160)}`);
    console.log(`[hook-rewrites] reply: ${text.slice(0, 400)}`);

    expect(result.status).toBe("finished");
    // Fact 6: the shapes the views are written against.
    const writes = pre.filter((inv) => inv.tool_name === "Write").map((inv) => inv.tool_input as Record<string, unknown>);
    expect(writes.some((w) => String(w["file_path"]).endsWith("created.txt") && typeof w["content"] === "string")).toBe(true);
    expect(pre.some((inv) => inv.tool_name === "Delete" && String((inv.tool_input as Record<string, unknown>)["file_path"]).endsWith("gone.txt"))).toBe(true);
    expect(pre.some((inv) => inv.tool_name === "Grep" && (inv.tool_input as Record<string, unknown>)["pattern"] === "" && typeof (inv.tool_input as Record<string, unknown>)["glob"] === "string")).toBe(true);
    expect(pre.some((inv) => inv.tool_name === "Shell" && "command" in (inv.tool_input as object))).toBe(true);
    // Fact 7: which rewrites apply.
    expect(text, "the read's path rewrite applied").toContain("BANANA");
    expect(existsSync(join(workspaceRoot, "shell-orig.txt")), "the command's rewrite applied").toBe(false);
    expect(readFileSync(join(workspaceRoot, "keep.txt"), "utf-8"), "a written file's content rewrite is not applied").toContain("model wrote this");
    expect(readFileSync(mcpLog, "utf-8"), "beforeMCPExecution's rewrite is not applied").toContain("orig-text");
    // Fact 8: post-call context.
    expect(invocations.some((inv) => inv.hook_event_name === "postToolUse" && String(inv.tool_name).startsWith("MCP:"))).toBe(true);
    expect(text).toContain("PINEAPPLE");
    expect(text).toContain("TURQUOISE");
    expect(text).not.toContain("OCELOT");
  }, 600_000);

  it("runs a cwd's .claude settings hooks, none from a second folder, and no hook for a web fetch (facts 9 and 10)", async () => {
    const { Agent } = await import("@cursor/sdk");
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const workspaceRoot = mkdtempSync(join(tmpdir(), "stigmer-hook-claude-"));
    const second = mkdtempSync(join(tmpdir(), "stigmer-hook-second-"));
    const stateRoot = join(workspaceRoot, ".sdk-state");
    mkdirSync(stateRoot, { recursive: true });
    const markers = mkdtempSync(join(tmpdir(), "stigmer-hook-markers-"));
    const mark = (name: string) => `touch ${join(markers, name)}; echo '{"permission":"allow"}'`;
    const claude = (matcher: string, name: string) => ({ PreToolUse: [{ matcher, hooks: [{ type: "command", command: mark(name) }] }] });
    mkdirSync(join(workspaceRoot, ".claude"), { recursive: true });
    writeFileSync(join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({ hooks: claude("Bash", "cwd-settings") }), "utf-8");
    writeFileSync(join(workspaceRoot, ".claude", "settings.local.json"), JSON.stringify({ hooks: claude(".*", "cwd-settings-local") }), "utf-8");
    mkdirSync(join(second, ".claude"), { recursive: true });
    mkdirSync(join(second, ".cursor"), { recursive: true });
    writeFileSync(join(second, ".claude", "settings.json"), JSON.stringify({ hooks: claude("Bash", "second-settings") }), "utf-8");
    writeFileSync(join(second, ".cursor", "hooks.json"), JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: mark("second-cursor") }] } }), "utf-8");
    const hookLog = join(workspaceRoot, "hook-invocations.jsonl");
    installObservationHook(workspaceRoot, hookLog);

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "composer-2.5" },
      local: {
        cwd: workspaceRoot,
        dirs: [second],
        settingSources: ["project"],
        store: await SqliteLocalAgentStore.open({ workspaceRef: `hook-claude-${Date.now()}`, stateRoot }),
        enableAgentRetries: false,
      },
    });
    const run = await agent.send(
      "Do two things without asking questions: run the shell command `echo hello`, then fetch https://example.com with your web fetch tool. Reply done.",
    );
    for await (const _event of run.stream()) {
      /* drain */
    }
    const result = await run.wait();
    agent.close();
    const fired = readdirSync(markers).sort();
    const invocations = readInvocations(hookLog);

    console.log(`[hook-claude] run status: ${result.status}; markers: ${JSON.stringify(fired)}`);
    console.log(`[hook-claude] hook names: ${JSON.stringify(invocations.map((inv) => `${String(inv.hook_event_name)}:${String(inv.tool_name)}`))}`);

    expect(result.status).toBe("finished");
    // Fact 9: the cwd's two settings files load; the second folder's files do not.
    expect(fired).toEqual(["cwd-settings", "cwd-settings-local"]);
    // Fact 10: the web fetch reached no hook (only the shell did).
    expect(invocations.map((inv) => String(inv.tool_name)).filter((name) => /fetch/i.test(name))).toEqual([]);
  }, 600_000);
});
