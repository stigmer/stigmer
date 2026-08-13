/**
 * Tool-intent middleware (issue #276): the shell tool's bind-time schema
 * gains an optional model-authored `description`, execution never sees it,
 * and the argument survives verbatim into the message history.
 *
 * The integration block drives a REAL deepagents graph, because the two
 * claims that matter most are framework claims: (1) `wrapModelCall` receives
 * the library's built-in `execute` tool and the clone reaches `bindTools`,
 * and (2) the original tool's strip-parsing drops the extra argument before
 * the backend's `execute(command)` runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";
import {
  createToolIntentMiddleware,
  INTENT_ARG,
  INTENT_ARG_PROMPT,
} from "../tool-intent.js";
import { buildSubAgentMiddleware } from "../../activities/execute-deep-agent/subagent-wiring.js";
import { createCasCaptureBackend } from "../../activities/execute-deep-agent/cas-capture-backend.js";
import { CasCaptureObserver } from "../../activities/execute-deep-agent/cas-capture-observer.js";
import {
  ScriptedModel,
  type ScriptSelector,
} from "../../activities/execute-deep-agent/__test-utils__/scripted-model.js";

/** A stand-in for deepagents' `execute` tool: same name, same schema shape. */
function makeShellTool(executed: string[]) {
  return tool(
    async ({ command }: { command: string }) => {
      executed.push(command);
      return "ok";
    },
    {
      name: "execute",
      description: "Run a shell command",
      schema: z.object({ command: z.string().describe("The shell command to execute") }),
    },
  );
}

function makeReadTool() {
  return tool(async () => "contents", {
    name: "read_file",
    description: "Read a file",
    schema: z.object({ file_path: z.string() }),
  });
}

type BoundSchema = {
  type?: string;
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
};

function schemaOf(t: unknown): BoundSchema {
  return (t as { schema: BoundSchema }).schema;
}

async function runWrap(
  mw: ReturnType<typeof createToolIntentMiddleware>,
  tools: unknown[],
): Promise<unknown[]> {
  let seen: unknown[] = [];
  const handler = vi.fn(async (req: { tools?: unknown[] }) => {
    seen = req.tools ?? [];
    return new AIMessage({ content: "" });
  });
  await mw.wrapModelCall!(
    { model: {}, messages: [], tools, state: {}, runtime: {} } as never,
    handler as never,
  );
  return seen;
}

describe("ToolIntentMiddleware (unit)", () => {
  it("passes a tool-less request through untouched", async () => {
    const mw = createToolIntentMiddleware();
    const request = { model: {}, messages: [], state: {}, runtime: {} } as never;
    const handler = vi.fn(async () => new AIMessage({ content: "" }));
    await mw.wrapModelCall!(request, handler as never);
    expect(handler).toHaveBeenCalledWith(request);
  });

  it("extends the shell tool's bound schema with the optional intent arg", async () => {
    const shell = makeShellTool([]);
    const bound = await runWrap(createToolIntentMiddleware(), [shell]);

    expect(bound).toHaveLength(1);
    expect(bound[0]).not.toBe(shell);
    const schema = schemaOf(bound[0]);
    expect(schema.properties?.command?.type).toBe("string");
    expect(schema.properties?.[INTENT_ARG]).toEqual({
      type: "string",
      description: INTENT_ARG_PROMPT,
    });
    // Optional by construction: required is untouched.
    expect(schema.required ?? []).not.toContain(INTENT_ARG);
  });

  it("passes non-shell tools through by reference", async () => {
    const read = makeReadTool();
    const shell = makeShellTool([]);
    const bound = await runWrap(createToolIntentMiddleware(), [read, shell]);
    expect(bound[0]).toBe(read);
    expect(bound[1]).not.toBe(shell);
  });

  it("never shadows a real argument named like the intent arg", async () => {
    const conflicting = tool(async () => "ok", {
      name: "shell",
      description: "A shell tool that already has a description arg",
      schema: z.object({ command: z.string(), [INTENT_ARG]: z.string() }),
    });
    const bound = await runWrap(createToolIntentMiddleware(), [conflicting]);
    expect(bound[0]).toBe(conflicting);
  });

  it("passes through tools whose schema is not an object schema", async () => {
    const odd = { name: "bash", description: "odd", schema: 42 };
    const bound = await runWrap(createToolIntentMiddleware(), [odd]);
    expect(bound[0]).toBe(odd);
  });

  it("reuses one clone across model calls (referential stability)", async () => {
    const mw = createToolIntentMiddleware();
    const shell = makeShellTool([]);
    const first = await runWrap(mw, [shell]);
    const second = await runWrap(mw, [shell]);
    expect(first[0]).toBe(second[0]);
  });

  it("emits a non-executable declaration that provider converters accept", async () => {
    const shell = makeShellTool([]);
    const bound = await runWrap(createToolIntentMiddleware(), [shell]);
    const declaration = bound[0] as Record<string, unknown>;

    // Deliberately NOT an executable tool — the agent's validation forbids
    // swapping same-name executable instances, and execution belongs to the
    // registered original. StructuredToolParams is the sanctioned shape.
    expect(declaration.invoke).toBeUndefined();

    // The shape every provider's bindTools converts like a structured tool.
    const openAiTool = convertToOpenAITool(declaration as never) as {
      function: { name: string; parameters: { properties: Record<string, unknown> } };
    };
    expect(openAiTool.function.name).toBe("execute");
    expect(openAiTool.function.parameters.properties[INTENT_ARG]).toEqual({
      type: "string",
      description: INTENT_ARG_PROMPT,
    });
    expect(openAiTool.function.parameters.properties.command).toBeDefined();
  });

  it("is idempotent: an already-extended declaration passes through", async () => {
    const mw = createToolIntentMiddleware();
    const shell = makeShellTool([]);
    const [firstPass] = await runWrap(mw, [shell]);
    // A second middleware instance (e.g. a sub-agent stack composed over the
    // same request) must not re-wrap the extended declaration.
    const [secondPass] = await runWrap(createToolIntentMiddleware(), [firstPass]);
    expect(secondPass).toBe(firstPass);
  });
});

describe("ToolIntentMiddleware (real deepagents graph)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tool-intent-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("binds the extended execute schema to the model and strips the arg at execution", async () => {
    const marker = join(root, "intent-marker.txt");
    const script: ScriptSelector = () => ({
      toolCalls: [{
        name: "execute",
        args: {
          command: "echo ran > intent-marker.txt",
          [INTENT_ARG]: "Write the marker file",
        },
        id: "exec_intent_1",
      }],
      done: "done",
    });
    const model = new ScriptedModel(script);

    const observer = new CasCaptureObserver({ rootDir: root, isIgnored: async () => false });
    const backend = await createCasCaptureBackend({ rootDir: root, observer, shellEnv: {} });

    const checkpointer = new MemorySaver();
    const agent = await createDeepAgent({
      model,
      checkpointer: checkpointer as never,
      backend,
      middleware: [createToolIntentMiddleware()],
    } as Parameters<typeof createDeepAgent>[0]);

    const config = { configurable: { thread_id: "intent-thread" }, recursionLimit: 50 };
    await agent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);

    // (1) The model saw the library's execute tool WITH the intent arg.
    const boundExecute = model.boundTools.find(
      (t) => (t as { name?: string }).name === "execute",
    );
    expect(boundExecute).toBeDefined();
    const schema = schemaOf(boundExecute);
    expect(schema.properties?.[INTENT_ARG]?.description).toBe(INTENT_ARG_PROMPT);
    expect(schema.properties?.command).toBeDefined();
    expect(schema.required ?? []).not.toContain(INTENT_ARG);

    // (2) Execution ran the ORIGINAL tool: strip semantics dropped the intent
    // arg and the command executed normally.
    expect(await readFile(marker, "utf8")).toBe("ran\n");

    // (3) The intent arg survived verbatim in the message history — the
    // exact bytes the status builder persists onto ToolCall.args.
    const state = (await agent.getState(config)) as unknown as {
      values: { messages: Array<{ tool_calls?: Array<{ name: string; args: Record<string, unknown> }> }> };
    };
    const messages = state.values.messages;
    const toolCall = messages
      .flatMap((m) => m.tool_calls ?? [])
      .find((tc) => tc.name === "execute");
    expect(toolCall).toBeDefined();
    expect(toolCall!.args[INTENT_ARG]).toBe("Write the marker file");
    expect(toolCall!.args.command).toBe("echo ran > intent-marker.txt");
  });
});

describe("sub-agent stack wiring", () => {
  it("includes the tool-intent middleware in every sub-agent stack", () => {
    const stack = buildSubAgentMiddleware({});
    expect(stack.map((m) => m.name)).toContain("StigmerToolIntentMiddleware");
  });
});

describe("wire-contract fixture", () => {
  it("INTENT_ARG matches the cross-surface fixture key the SDK reads", () => {
    // The reader side (sdk/react intent-title tests) asserts against the
    // same file, so the writer and readers cannot drift apart silently.
    const here = dirname(fileURLToPath(import.meta.url));
    const fixture = JSON.parse(
      readFileSync(
        resolve(here, "../../../../../../test/fixtures/tool-view/intent-title.json"),
        "utf8",
      ),
    ) as { argField: string };
    expect(INTENT_ARG).toBe(fixture.argField);
  });
});
