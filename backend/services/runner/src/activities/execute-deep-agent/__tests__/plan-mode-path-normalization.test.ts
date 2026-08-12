/**
 * End-to-end proof (real deepagents + LangGraph runtime, no LLM/network) that
 * a plan-mode PARENT graph accepts workspace-relative paths (issue #429).
 *
 * Before the fix, deepagents' permission enforcement canonicalized every
 * filesystem tool-call path BEFORE any rule ran and refused non-absolute
 * shapes, so on a rule-bearing graph a workspace-relative call — reads
 * included — died with `path must be absolute` instead of just working. The
 * path-normalization middleware (middleware/path-normalization.ts) rewrites
 * relative paths to workspace-absolute at our seam, before enforcement sees
 * them.
 *
 * The graph here is composed exactly the way setup.ts composes the parent:
 * the PRODUCTION buildMiddlewareStack (pathNormalization present, the
 * rule-bearing shape) + the CAS capture backend + the PRODUCTION
 * PLAN_MODE_PERMISSIONS constant. These tests are also the empirical proof
 * that langchain's wrapToolCall seam delivers rewritten args to the tool —
 * if it did not, the relative read below could never succeed.
 *
 * The sub-agent twin of this contract is pinned in
 * subagent-plan-mode-permissions.test.ts (issue #255 wiring).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";

import { PLAN_MODE_PERMISSIONS } from "../../../shared/plan-mode-permissions.js";
import { buildMiddlewareStack } from "../../../middleware/index.js";
import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import { ScriptedModel, type ScriptSelector } from "../__test-utils__/scripted-model.js";

const SEEDED_CONTENT = "PLAN_MODE_README_TOKEN: hello from the seeded file";

describe("plan-mode parent path normalization (issue #429)", () => {
  let root: string;
  let observer: CasCaptureObserver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "plan-path-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/notes.md"), SEEDED_CONTENT);
    observer = new CasCaptureObserver({ rootDir: root, isIgnored: async () => true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Build a parent graph the way setup.ts does in plan mode: the production
   * middleware stack with pathNormalization set (derived, like the graph's
   * permissions, from the plan-mode rules), a filesystem-only CAS capture
   * backend (no shellEnv — plan mode clears it), and PLAN_MODE_PERMISSIONS
   * on the graph.
   */
  async function buildPlanModeParent(script: ScriptSelector) {
    const { middleware } = buildMiddlewareStack({
      approvalGate: null,
      pathNormalization: { rootDir: root },
    });
    const backend = await createCasCaptureBackend({ rootDir: root, observer });
    return createDeepAgent({
      model: new ScriptedModel(script),
      checkpointer: new MemorySaver() as never,
      backend,
      middleware: middleware as never[],
      permissions: PLAN_MODE_PERMISSIONS,
    } as Parameters<typeof createDeepAgent>[0]);
  }

  function toolResultById(messages: BaseMessage[], toolCallId: string): string {
    const match = messages.find(
      (m): m is ToolMessage => m instanceof ToolMessage && m.tool_call_id === toolCallId,
    );
    expect(match, `expected a tool result for call '${toolCallId}'`).toBeDefined();
    return typeof match!.content === "string" ? match!.content : JSON.stringify(match!.content);
  }

  async function invokeOnce(script: ScriptSelector, threadId: string) {
    const agent = await buildPlanModeParent(script);
    return (await agent.invoke(
      { messages: [new HumanMessage({ content: "go" })] },
      { configurable: { thread_id: threadId }, recursionLimit: 50 },
    )) as { messages: BaseMessage[] };
  }

  it("a prompt-compliant relative read succeeds on the first tool round", async () => {
    const result = await invokeOnce(
      () => ({
        toolCalls: [
          { name: "read_file", args: { file_path: "src/notes.md" }, id: "c_read_rel" },
        ],
        done: "done",
      }),
      "t_read_rel",
    );

    const readResult = toolResultById(result.messages, "c_read_rel");
    expect(readResult).toContain("PLAN_MODE_README_TOKEN");
    expect(readResult).not.toMatch(/path must be absolute/i);
    expect(readResult).not.toMatch(/permission denied/i);
  });

  it("a relative write is refused by the RULES — permission denied, not a path-shape error", async () => {
    const result = await invokeOnce(
      () => ({
        toolCalls: [
          { name: "write_file", args: { file_path: "src/out.txt", content: "x" }, id: "c_write_rel" },
        ],
        done: "done",
      }),
      "t_write_rel",
    );

    // The deny-all-writes rule fires on the normalized path — the honest
    // plan-mode refusal the model can reason about, instead of the
    // pre-fix validation error that taught it to abandon relative paths.
    expect(toolResultById(result.messages, "c_write_rel")).toMatch(/permission denied for write/i);
    expect(toolResultById(result.messages, "c_write_rel")).not.toMatch(/path must be absolute/i);
    await expect(access(join(root, "src/out.txt"))).rejects.toThrow();
    expect(observer.before.size).toBe(0);
  });

  it("an escaping relative read is still refused — normalization grants no new reachability", async () => {
    // Outside the root, reachable only if `..` were naively joined away.
    const result = await invokeOnce(
      () => ({
        toolCalls: [
          { name: "read_file", args: { file_path: "../escape.txt" }, id: "c_read_escape" },
        ],
        done: "done",
      }),
      "t_read_escape",
    );

    // Left raw by the middleware, refused by upstream validation exactly as
    // before the fix.
    expect(toolResultById(result.messages, "c_read_escape")).toMatch(/must not contain|path must be absolute/i);
  });

  it("absolute in-workspace paths keep working unchanged", async () => {
    const result = await invokeOnce(
      () => ({
        toolCalls: [
          { name: "read_file", args: { file_path: join(root, "src/notes.md") }, id: "c_read_abs" },
        ],
        done: "done",
      }),
      "t_read_abs",
    );

    expect(toolResultById(result.messages, "c_read_abs")).toContain("PLAN_MODE_README_TOKEN");
  });

  it("relative ls flows through normalization to list the workspace directory", async () => {
    const result = await invokeOnce(
      () => ({
        toolCalls: [{ name: "ls", args: { path: "src" }, id: "c_ls_rel" }],
        done: "done",
      }),
      "t_ls_rel",
    );

    const lsResult = toolResultById(result.messages, "c_ls_rel");
    expect(lsResult).toContain("notes.md");
    expect(lsResult).not.toMatch(/path must be absolute/i);
  });
});
