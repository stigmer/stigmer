/**
 * End-to-end proof (real deepagents + LangGraph runtime, no LLM/network) that
 * a plan-mode PARENT graph accepts workspace-relative paths (issue #429) and
 * confines every read to the workspace (issues #528, #754).
 *
 * Before the #429 fix, deepagents' permission enforcement canonicalized every
 * filesystem tool-call path BEFORE any rule ran and refused non-absolute
 * shapes, so on a rule-bearing graph a workspace-relative call — reads
 * included — died with `path must be absolute` instead of just working. The
 * path-normalization middleware (middleware/path-normalization.ts) rewrites
 * relative paths to VIRTUAL-absolute at our seam, before enforcement sees
 * them. The read boundary #528 built out of rules is structural since #754:
 * the backend is virtual-rooted, so every expressible path resolves inside
 * the workspace — an out-of-root name is simply nonexistent, and the
 * `.stigmer` symlink keeps platform-dir reads addressable in-root.
 *
 * The graph here is composed exactly the way setup.ts composes the parent:
 * the PRODUCTION buildMiddlewareStack (pathNormalization present on every
 * graph) + the CAS capture backend + the PRODUCTION buildPlanModePermissions
 * rules. These tests are also the empirical proof that langchain's
 * wrapToolCall seam delivers rewritten args to the tool — if it did not, the
 * relative read below could never succeed.
 *
 * The sub-agent twin of this contract is pinned in
 * subagent-plan-mode-permissions.test.ts (issue #255 wiring).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile, access, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";

import { buildPlanModePermissions } from "../../../shared/plan-mode-permissions.js";
import { buildMiddlewareStack } from "../../../middleware/index.js";
import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import { ScriptedModel, type ScriptSelector } from "../__test-utils__/scripted-model.js";

const SEEDED_CONTENT = "PLAN_MODE_README_TOKEN: hello from the seeded file";
const OUTSIDE_CONTENT = "OUT_OF_ROOT_SECRET_TOKEN: must never cross the boundary";
const PLATFORM_CONTENT = "PLATFORM_SKILL_TOKEN: reached through the .stigmer symlink";

/**
 * Build a plan-mode parent graph the way setup.ts does: the production
 * middleware stack with pathNormalization set (derived, like the graph's
 * permissions, from the plan-mode rules), a filesystem-only CAS capture
 * backend (no shellEnv — plan mode clears it), and the production
 * buildPlanModePermissions rules on the graph.
 */
async function buildPlanModeParent(
  root: string,
  observer: CasCaptureObserver,
  script: ScriptSelector,
) {
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
    permissions: buildPlanModePermissions(),
  } as Parameters<typeof createDeepAgent>[0]);
}

function toolResultById(messages: BaseMessage[], toolCallId: string): string {
  const match = messages.find(
    (m): m is ToolMessage => m instanceof ToolMessage && m.tool_call_id === toolCallId,
  );
  expect(match, `expected a tool result for call '${toolCallId}'`).toBeDefined();
  return typeof match!.content === "string" ? match!.content : JSON.stringify(match!.content);
}

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

  async function invokeOnce(script: ScriptSelector, threadId: string) {
    const agent = await buildPlanModeParent(root, observer, script);
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

describe("plan-mode workspace read boundary (issue #528)", () => {
  let root: string;
  let outside: string;
  let platform: string;
  let observer: CasCaptureObserver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "plan-bound-"));
    outside = await mkdtemp(join(tmpdir(), "plan-outside-"));
    platform = await mkdtemp(join(tmpdir(), "plan-platform-"));

    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/notes.md"), SEEDED_CONTENT);
    await writeFile(join(outside, "secret.txt"), OUTSIDE_CONTENT);

    // The production shape from shared/workspace/stigmer-link.ts: the
    // platform dir lives OUTSIDE the workspace, reached through an in-root
    // symlink — its path STRINGS are in-root, which is what the rules match.
    await mkdir(join(platform, "skills"), { recursive: true });
    await writeFile(join(platform, "skills/guide.md"), PLATFORM_CONTENT);
    await symlink(platform, join(root, ".stigmer"));

    observer = new CasCaptureObserver({ rootDir: root, isIgnored: async () => true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(platform, { recursive: true, force: true });
  });

  async function invokeOnce(script: ScriptSelector, threadId: string) {
    const agent = await buildPlanModeParent(root, observer, script);
    return (await agent.invoke(
      { messages: [new HumanMessage({ content: "go" })] },
      { configurable: { thread_id: threadId }, recursionLimit: 50 },
    )) as { messages: BaseMessage[] };
  }

  it("an out-of-root absolute read cannot reach the bytes — the name resolves in-workspace and finds nothing", async () => {
    // Pre-#754 this was a rule-based denial; the boundary is structural now:
    // the virtual root makes the outside path unaddressable, so the honest
    // answer is not-found. The security property — the bytes never cross —
    // is what this test pins.
    const result = await invokeOnce(
      () => ({
        toolCalls: [
          { name: "read_file", args: { file_path: join(outside, "secret.txt") }, id: "c_read_out" },
        ],
        done: "done",
      }),
      "t_read_out",
    );

    const readResult = toolResultById(result.messages, "c_read_out");
    expect(readResult).toMatch(/not found|no such file/i);
    expect(readResult).not.toContain("OUT_OF_ROOT_SECRET_TOKEN");
  });

  it("lists the workspace root itself — {root}/** admits the root, not just its subtree", async () => {
    const result = await invokeOnce(
      () => ({
        toolCalls: [{ name: "ls", args: { path: root }, id: "c_ls_root" }],
        done: "done",
      }),
      "t_ls_root",
    );

    const lsResult = toolResultById(result.messages, "c_ls_root");
    expect(lsResult).toContain("src");
    expect(lsResult).not.toMatch(/permission denied/i);
  });

  it("reads platform-dir material through the .stigmer symlink — in-root strings, out-of-root bytes", async () => {
    const result = await invokeOnce(
      () => ({
        toolCalls: [
          { name: "read_file", args: { file_path: join(root, ".stigmer/skills/guide.md") }, id: "c_read_skill" },
        ],
        done: "done",
      }),
      "t_read_skill",
    );

    const readResult = toolResultById(result.messages, "c_read_skill");
    expect(readResult).toContain("PLATFORM_SKILL_TOKEN");
    expect(readResult).not.toMatch(/permission denied/i);
  });

  it("a bare ls (no path argument) lists the workspace, not the OS root", async () => {
    // The tool's schema default is "/" — which under the virtual root IS the
    // workspace root (pre-#754 it was the OS root and the middleware had to
    // fill the omission), so the model's first listing just works.
    const result = await invokeOnce(
      () => ({
        toolCalls: [{ name: "ls", args: {}, id: "c_ls_bare" }],
        done: "done",
      }),
      "t_ls_bare",
    );

    const lsResult = toolResultById(result.messages, "c_ls_bare");
    expect(lsResult).toContain("src");
    expect(lsResult).not.toMatch(/permission denied/i);
  });

  it("a bare grep (no path argument) searches the workspace, not the whole filesystem", async () => {
    // Pre-#528, a bare grep recursively scanned the ENTIRE OS filesystem
    // (schema default "/" + the legacy backend's literal pass-through);
    // under the virtual root the default itself means the workspace.
    const result = await invokeOnce(
      () => ({
        toolCalls: [
          { name: "grep", args: { pattern: "PLAN_MODE_README_TOKEN" }, id: "c_grep_bare" },
        ],
        done: "done",
      }),
      "t_grep_bare",
    );

    const grepResult = toolResultById(result.messages, "c_grep_bare");
    expect(grepResult).toContain("notes.md");
    expect(grepResult).not.toMatch(/permission denied/i);
  });

  it("an explicit ls of '/' lists the workspace root — '/' MEANS the workspace in the virtual dialect", async () => {
    // Deliberate reversal of the pre-#754 pin ("denied honestly"): back then
    // "/" named the OS root, so denial was the honest answer. Under the
    // virtual root "/" IS the workspace root — the model asked for the
    // workspace and gets it.
    const result = await invokeOnce(
      () => ({
        toolCalls: [{ name: "ls", args: { path: "/" }, id: "c_ls_slash" }],
        done: "done",
      }),
      "t_ls_slash",
    );

    const lsResult = toolResultById(result.messages, "c_ls_slash");
    expect(lsResult).toContain("src");
    expect(lsResult).not.toMatch(/permission denied/i);
  });

  it("writes stay denied everywhere — the read-allow rule admits reads only", async () => {
    const result = await invokeOnce(
      () => ({
        toolCalls: [
          { name: "write_file", args: { file_path: join(root, "src/out.txt"), content: "x" }, id: "c_write_in" },
        ],
        done: "done",
      }),
      "t_write_in",
    );

    expect(toolResultById(result.messages, "c_write_in")).toMatch(/permission denied for write/i);
    await expect(access(join(root, "src/out.txt"))).rejects.toThrow();
  });
});

describe("plan-mode boundary with a glob-special workspace root (issues #528/#754)", () => {
  // Desktop localPath workspaces use the user's real project directory AS
  // the root — names like "My (work) [v2]" are legal there. Pre-#754 the
  // read-allow rule embedded the root as a glob and needed escapeGlobLiteral
  // to survive such names; the rules no longer embed the root at all, so
  // this suite now pins that special-character roots just work.
  let base: string;
  let root: string;
  let observer: CasCaptureObserver;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "plan-glob-"));
    root = join(base, "My (work) [v2]");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/notes.md"), SEEDED_CONTENT);
    observer = new CasCaptureObserver({ rootDir: root, isIgnored: async () => true });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  async function invokeOnce(script: ScriptSelector, threadId: string) {
    const agent = await buildPlanModeParent(root, observer, script);
    return (await agent.invoke(
      { messages: [new HumanMessage({ content: "go" })] },
      { configurable: { thread_id: threadId }, recursionLimit: 50 },
    )) as { messages: BaseMessage[] };
  }

  it("in-root reads work, absolute and relative alike; host files stay unreachable", async () => {
    const result = await invokeOnce(
      () => ({
        toolCalls: [
          { name: "read_file", args: { file_path: join(root, "src/notes.md") }, id: "c_abs" },
          { name: "read_file", args: { file_path: "src/notes.md" }, id: "c_rel" },
          { name: "read_file", args: { file_path: "/etc/hosts" }, id: "c_out" },
        ],
        done: "done",
      }),
      "t_glob_root",
    );

    expect(toolResultById(result.messages, "c_abs")).toContain("PLAN_MODE_README_TOKEN");
    expect(toolResultById(result.messages, "c_rel")).toContain("PLAN_MODE_README_TOKEN");
    // "/etc/hosts" names the WORKSPACE's etc/hosts, which doesn't exist —
    // the host file is structurally unaddressable.
    const outResult = toolResultById(result.messages, "c_out");
    expect(outResult).toMatch(/not found|no such file/i);
    expect(outResult).not.toContain("localhost");
  });
});
