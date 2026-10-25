/**
 * Hermetic scenario: the catalogue's `format-on-edit` plugin formats what the
 * native engine's file tools write, through the whole `ExecuteDeepAgent`
 * activity on the real graph with the scripted model.
 *
 * The plugin is mounted exactly as installed: its archive is built from the
 * catalogue folder's own files (`plugins/format-on-edit`) and its recorded
 * `status.hooks` from that folder's own `hooks/hooks.json`, so the hook that
 * runs here is the one the catalogue ships: `node` in exec form on the
 * plugin's script, a Claude Code `PostToolUse` group on `Write|Edit`. The
 * workspace is a git repository whose `package.json` depends on Prettier;
 * its `node_modules/.bin/prettier` is a fake that lays `{ ... }` out on
 * three lines, so a formatted file is recognisable.
 *
 * Arms:
 *  - an `edit_file` that lands comes back formatted, the model's next request
 *    carries the result with `Hook feedback:` and the plugin's notice, and
 *    file review holds one change whose after-bytes are the formatted ones;
 *  - a `write_file` the same;
 *  - an edit that fails ("String not found") leaves the file and the result
 *    exactly as without the plugin;
 *  - a sub-agent's edit is formatted too (it runs the conversation's hooks);
 *  - a conversation that lists the plugin on the built-in assistant
 *    (`SessionSpec.plugins`) formats too.
 *
 * Structure and side effects only; no golden, since the transcript shapes
 * are the hooks and file-review scenarios' and are pinned there.
 */

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { GetArtifactResponseSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { buildZip } from "@stigmer/zip-structure/testing";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type ExecutionRecord,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { initGitWorkspace, localPathEntry } from "../../../../__test-utils__/git-workspace-fixture.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../../__test-utils__/hermetic-deep-agent.js";
import type { ScriptedToolCall, ScriptedTurn } from "../../__test-utils__/scripted-model.js";
import type { StigmerClient } from "../../../../client/stigmer-client.js";
import { HOOK_FEEDBACK_HEADING } from "../../../../shared/hooks/messages.js";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const PLUGIN_DIR = fileURLToPath(new URL("../../../../../../../../plugins/format-on-edit/", import.meta.url));

/** Every file under `dir`, as archive entries with POSIX paths. */
function folderEntries(dir: string, root = dir): { name: string; content: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return folderEntries(path, root);
    return [{ name: relative(root, path).split("\\").join("/"), content: readFileSync(path, "utf8") }];
  });
}

interface HooksFile {
  hooks: Record<string, { matcher: string; hooks: { command: string; args?: string[]; timeout?: number }[] }[]>;
}

const ARCHIVE = buildZip(folderEntries(PLUGIN_DIR));
const HOOKS_FILE = JSON.parse(readFileSync(join(PLUGIN_DIR, "hooks", "hooks.json"), "utf8")) as HooksFile;

const FORMAT_ON_EDIT = create(PluginSchema, {
  metadata: { id: "plg_format_on_edit", org: "hermetic-org", slug: "format-on-edit", name: "format-on-edit" },
  status: {
    digest: createHash("sha256").update(ARCHIVE).digest("hex"),
    artifactStorageKey: "plugins/format-on-edit.zip",
    hooks: create(HookConfigSchema, {
      format: HookFormat.CLAUDE_CODE,
      groups: Object.entries(HOOKS_FILE.hooks).flatMap(([event, groups]) =>
        groups.map((group) =>
          create(HookGroupSchema, {
            event,
            matcher: group.matcher,
            handlers: group.hooks.map((handler) =>
              create(HookHandlerSchema, { command: handler.command, args: handler.args ?? [], timeoutSeconds: handler.timeout ?? 0 }),
            ),
          }),
        ),
      ),
    }),
  },
});

const UNFORMATTED = "export function add(a, b) { return a + b; }\n";
const FORMATTED = "export function add(a, b) {\n  return a + b;\n}\n";
/** A Prettier stand-in: `{ ` and ` }` become line breaks, so a formatted file is recognisable. */
const FAKE_PRETTIER = `#!${process.execPath}
const fs = require("node:fs");
const file = process.argv[process.argv.length - 1];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll("{ ", "{\\n  ").replaceAll(" }", "\\n}"));
`;

function notice(path: string, lines: string): string {
  return `Prettier reformatted ${path} after this change (${lines} now differ from what you wrote). Read those lines again before quoting them in another edit.`;
}

/** A git workspace that depends on Prettier, with the fake installed (ignored, as node_modules is). */
function prettierRepo(env: HermeticEnvironment, name: string, files: Record<string, string>): string {
  const repo = join(env.workspaceRootDir, "repos", name);
  initGitWorkspace(repo, {
    ".gitignore": "node_modules/\n",
    "package.json": JSON.stringify({ name, devDependencies: { prettier: "^3.0.0" } }),
    ...files,
  });
  const bin = join(repo, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "prettier"), FAKE_PRETTIER);
  chmodSync(join(bin, "prettier"), 0o755);
  return repo;
}

function listPlugin(record: ExecutionRecord, where: "agent" | "session"): void {
  const ref = create(ApiResourceReferenceSchema, { kind: 58, org: "hermetic-org", slug: "format-on-edit" });
  if (where === "agent") record.agent!.spec!.plugins.push(ref);
  else record.session.spec!.plugins.push(ref);
}

const pluginClient: Partial<StigmerClient> = {
  getPluginByReference: vi.fn(async () => FORMAT_ON_EDIT),
  getPluginArtifactDownloadUrl: vi.fn(async () => {
    throw new ConnectError("no download lane", Code.Unimplemented);
  }),
  getPluginArtifact: vi.fn(async () => create(GetArtifactResponseSchema, { artifact: ARCHIVE })),
};

/** One tool call, then a closing turn; every tool result the model is handed is kept in `seen`. */
function oneCall(call: ScriptedToolCall, seen: string[]): (transcript: readonly BaseMessage[]) => ScriptedTurn {
  return (transcript) => {
    const answered = transcript.filter((m) => ToolMessage.isInstance(m));
    if (answered.length === 0) return { text: "Changing the file.", toolCalls: [call], usage: { inputTokens: 1_300, outputTokens: 60 } };
    seen.push(...answered.map((m) => String(m.content)));
    return { text: "Done.", usage: { inputTokens: 1_500, outputTokens: 10 } };
  };
}

describe("ExecuteDeepAgent hermetic — the format-on-edit plugin", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("formats a landed edit, tells the model which lines moved, and file review holds the formatted bytes", async () => {
    clock.reset();
    const repo = prettierRepo(env, "fmt-edit", { "src/app.ts": "export function add(a, b) { return 0; }\n" });
    const record = deepAgentExecutionRecord({ message: "Make add add.", resources: [localPathEntry("app", repo)], fileReview: true });
    listPlugin(record, "agent");
    const edit: ScriptedToolCall = { id: "call-format-edit", name: "edit_file", args: { file_path: "/src/app.ts", old_string: "return 0;", new_string: "return a + b;" } };
    const seen: string[] = [];
    const scenario = beginDeepAgentScenario({ env, clock, record, clientOverrides: pluginClient, script: () => oneCall(edit, seen) });

    await runDeepAgentTurn(scenario);

    expect(readFileSync(join(repo, "src", "app.ts"), "utf8")).toBe(FORMATTED);
    const result = `Successfully replaced 1 occurrence(s) in '/src/app.ts'\n\n${HOOK_FEEDBACK_HEADING}\n${notice("src/app.ts", "lines 1-3")}`;
    expect(seen).toEqual([result]);
    expect(record.toolCalls().map((tc) => [tc.id, tc.status])).toEqual([[edit.id, ToolCallStatus.TOOL_CALL_COMPLETED]]);

    const events = record.rowsOf(record.lastFullStatus!).fileReviewEventStream?.events ?? [];
    const candidate = events.find((e) => e.payload.case === "candidateCaptured")?.payload;
    if (candidate?.case !== "candidateCaptured") throw new Error("file review captured no candidate");
    expect(candidate.value.changes).toHaveLength(1);
    const change = candidate.value.changes[0];
    expect(change.kind).toBe(FileChangeKind.MODIFY);
    expect(change.after?.body.case === "inline" ? change.after.body.value : undefined, "the review shows the formatted change").toBe(FORMATTED);
  });

  it("formats a landed write the same way", async () => {
    clock.reset();
    const repo = prettierRepo(env, "fmt-write", {});
    const record = deepAgentExecutionRecord({ message: "Write add.", resources: [localPathEntry("app", repo)], fileReview: true });
    listPlugin(record, "agent");
    const write: ScriptedToolCall = { id: "call-format-write", name: "write_file", args: { file_path: "/src/add.ts", content: UNFORMATTED } };
    const seen: string[] = [];
    const scenario = beginDeepAgentScenario({ env, clock, record, clientOverrides: pluginClient, script: () => oneCall(write, seen) });

    await runDeepAgentTurn(scenario);

    expect(readFileSync(join(repo, "src", "add.ts"), "utf8")).toBe(FORMATTED);
    expect(seen).toEqual([`Successfully wrote to '/src/add.ts'\n\n${HOOK_FEEDBACK_HEADING}\n${notice("src/add.ts", "lines 1-3")}`]);
  });

  it("leaves the file and the result as they were when the edit fails", async () => {
    clock.reset();
    const repo = prettierRepo(env, "fmt-failed", { "src/app.ts": UNFORMATTED });
    const record = deepAgentExecutionRecord({ message: "Change add.", resources: [localPathEntry("app", repo)], fileReview: true });
    listPlugin(record, "agent");
    const edit: ScriptedToolCall = { id: "call-format-failed", name: "edit_file", args: { file_path: "/src/app.ts", old_string: "return a - b;", new_string: "return b;" } };
    const seen: string[] = [];
    const scenario = beginDeepAgentScenario({ env, clock, record, clientOverrides: pluginClient, script: () => oneCall(edit, seen) });

    await runDeepAgentTurn(scenario);

    expect(readFileSync(join(repo, "src", "app.ts"), "utf8"), "an edit that did not land is not formatted").toBe(UNFORMATTED);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^Error: String not found in file/);
    expect(seen[0]).not.toContain(HOOK_FEEDBACK_HEADING);
  });

  it("formats a sub-agent's edit", async () => {
    clock.reset();
    const repo = prettierRepo(env, "fmt-subagent", { "src/app.ts": "export function add(a, b) { return 0; }\n" });
    const HELPER_INSTRUCTIONS = "You are the hermetic fixer.";
    const helper = create(AgentSchema, {
      metadata: { id: "agt_fixer", name: "fixer", slug: "fixer" },
      spec: { description: "Fixes code.", instructions: HELPER_INSTRUCTIONS },
      status: { versionHash: "f".repeat(64) },
    });
    const record = deepAgentExecutionRecord({ message: "Have the fixer make add add.", resources: [localPathEntry("app", repo)], fileReview: true, subagents: [helper] });
    listPlugin(record, "agent");
    const edit: ScriptedToolCall = { id: "call-format-sub-edit", name: "edit_file", args: { file_path: "/src/app.ts", old_string: "return 0;", new_string: "return a + b;" } };
    const seen: string[] = [];
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      clientOverrides: { ...pluginClient, getAgentByReference: vi.fn(async () => helper) },
      script: (_tools, context) =>
        context.systemPrompt.includes(HELPER_INSTRUCTIONS)
          ? oneCall(edit, seen)
          : {
              turns: [
                {
                  text: "Delegating.",
                  toolCalls: [{ id: "call-format-task", name: "task", args: { description: "Make add add.", subagent_type: "fixer" } }],
                  usage: { inputTokens: 1_500, outputTokens: 60 },
                },
                { text: "The fixer is done.", usage: { inputTokens: 1_800, outputTokens: 30 } },
              ],
            },
    });

    await runDeepAgentTurn(scenario);

    expect(readFileSync(join(repo, "src", "app.ts"), "utf8")).toBe(FORMATTED);
    expect(seen).toEqual([`Successfully replaced 1 occurrence(s) in '/src/app.ts'\n\n${HOOK_FEEDBACK_HEADING}\n${notice("src/app.ts", "lines 1-3")}`]);
  });

  it("formats on a conversation with the built-in assistant that lists the plugin", async () => {
    clock.reset();
    const repo = prettierRepo(env, "fmt-chat", {});
    const record = deepAgentExecutionRecord({ message: "Write add.", resources: [localPathEntry("app", repo)], fileReview: true, builtInAssistant: true });
    listPlugin(record, "session");
    const write: ScriptedToolCall = { id: "call-format-chat", name: "write_file", args: { file_path: "/add.ts", content: UNFORMATTED } };
    const seen: string[] = [];
    const scenario = beginDeepAgentScenario({ env, clock, record, clientOverrides: pluginClient, script: () => oneCall(write, seen) });

    await runDeepAgentTurn(scenario);

    expect(readFileSync(join(repo, "add.ts"), "utf8")).toBe(FORMATTED);
    expect(seen).toEqual([`Successfully wrote to '/add.ts'\n\n${HOOK_FEEDBACK_HEADING}\n${notice("add.ts", "lines 1-3")}`]);
  });
});
