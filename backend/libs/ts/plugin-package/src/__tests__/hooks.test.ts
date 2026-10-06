/**
 * Pins hook reading over built plugins: the sources a package's manifests
 * reach (declared files, inline objects, `hooks/hooks.json`, merged and
 * each file read once), the format decided by the entries and checked
 * against the manifests, what is carried in each format and what is named
 * as not run, one format per plugin, the matcher and `if` checks, and
 * `${user_config.KEY}` in exec-form arguments counting as a reference, read
 * the same way off a read plugin's hooks by `hookVariableReferences`, and
 * `HOOK_WARNING_KINDS`, the warnings a surface lists as hooks not run.
 *
 * The vendored Claude plugins are pinned in `claude-fixtures.test.ts`; the
 * cases here are the shapes no vendorable plugin carries, among them a
 * plugin built in the shape of Anthropic's `claude-security` (whose licence
 * forbids vendoring it): synchronous `if` handlers on `Bash`, an async one
 * beside them, and three events Stigmer does not run.
 */

import { describe, expect, it } from "vitest";

import { PLUGIN_DOCUMENT_LIMITS } from "../files.js";
import { warningMessage } from "../messages.js";
import { HOOK_WARNING_KINDS } from "../outcome.js";
import { hookVariableReferences, isValidMatcher } from "../normalise/hooks.js";
import { claudePlugin, codexPlugin, cursorPlugin, openPlugin, withFile } from "../testing.js";
import { accepted, findingOf, kindsOf, read, refused } from "../__test-utils__/read.js";

const command = (cmd: string, extra: Readonly<Record<string, unknown>> = {}) => ({ type: "command", command: cmd, ...extra });

describe("Claude Code's format", () => {
  it("carries tool-call groups with their matchers, conditions, exec form and timeouts as written", () => {
    const plugin = accepted(
      read(
        claudePlugin({
          hooks: {
            PreToolUse: [
              { hooks: [command("python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/pre.py\"", { timeout: 10 })] },
              { matcher: "*", hooks: [command("node", { args: ["${CLAUDE_PLUGIN_ROOT}/check.js", "--strict"] })] },
              { matcher: "Edit|Write, MultiEdit", hooks: [command("lint", { timeout: 2.5 })] },
            ],
            PostToolUse: [{ matcher: "mcp__plugin_example_db__.*", hooks: [command("audit", { if: "Bash(git push *)", shell: "bash" })] }],
          },
        }),
      ),
    );
    expect(plugin.hooks).toEqual({
      format: "claude-code",
      groups: [
        { event: "PreToolUse", matcher: "", handlers: [{ command: "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/pre.py\"", args: [], timeoutSeconds: 10, failClosed: false }] },
        { event: "PreToolUse", matcher: "*", handlers: [{ command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/check.js", "--strict"], failClosed: false }] },
        { event: "PreToolUse", matcher: "Edit|Write, MultiEdit", handlers: [{ command: "lint", args: [], timeoutSeconds: 3, failClosed: false }] },
        { event: "PostToolUse", matcher: "mcp__plugin_example_db__.*", handlers: [{ command: "audit", args: [], condition: "Bash(git push *)", failClosed: false }] },
      ],
    });
  });

  it("reads a plugin with hooks and nothing else, accepting the file's 'description' silently", () => {
    const files = withFile(
      claudePlugin(),
      "hooks/hooks.json",
      JSON.stringify({ description: "Guards", hooks: { PreToolUse: [{ hooks: [command("guard")] }] }, modules: ["./register.ts"] }),
    );
    const outcome = read(files);
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["hook-field-ignored"] });
    expect(findingOf(outcome.warnings, "hook-field-ignored")).toMatchObject({ path: "hooks/hooks.json", detail: "modules" });
    const plugin = accepted(outcome);
    expect(plugin.skills).toEqual([]);
    expect(plugin.subAgents).toEqual([]);
    expect(plugin.hooks?.groups).toHaveLength(1);
  });

  it("names every handler it does not run, with its reason, and drops a group left empty", () => {
    const outcome = read(
      claudePlugin({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                command("bg", { async: true }),
                command("rewake", { asyncRewake: true, rewakeMessage: "m" }),
                command("ps", { shell: "powershell" }),
                { type: "prompt", prompt: "Is this safe?" },
              ],
            },
          ],
        },
      }),
    );
    expect(outcome.warnings.map((f) => f.detail)).toEqual([
      "it runs in the background ('async'), so it cannot decide a call",
      "it runs in the background ('asyncRewake'), so it cannot decide a call",
      "it runs in PowerShell ('shell'), which the runner does not have",
      "its type is 'prompt', and Stigmer runs command hooks",
    ]);
    expect(accepted(outcome).hooks).toBeUndefined();
  });

  it("runs a PowerShell-shelled handler in exec form, where Claude Code ignores 'shell'", () => {
    const plugin = accepted(read(claudePlugin({ hooks: { PreToolUse: [{ hooks: [command("node", { args: ["x.js"], shell: "powershell" })] }] } })));
    expect(plugin.hooks?.groups[0]?.handlers).toEqual([{ command: "node", args: ["x.js"], failClosed: false }]);
  });

  it("carries a handler with 'once' and names the field, which Claude Code ignores outside skill frontmatter", () => {
    const outcome = read(claudePlugin({ hooks: { PostToolUse: [{ hooks: [command("x", { once: true })] }] } }));
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["hook-field-ignored"] });
    expect(accepted(outcome).hooks?.groups).toHaveLength(1);
  });

  it("names an unknown group key without dropping the group", () => {
    const outcome = read(claudePlugin({ hooks: { PreToolUse: [{ hooks: [command("x")], note: "n" }] } }));
    expect(findingOf(outcome.warnings, "hook-field-ignored")).toMatchObject({ subject: "PreToolUse", detail: "note" });
    expect(accepted(outcome).hooks?.groups).toHaveLength(1);
  });
});

describe("a plugin in the shape of claude-security", () => {
  const outcome = read(
    claudePlugin({
      name: "security-scanner",
      hooks: {
        PermissionRequest: [{ hooks: [command("sh hooks.sh permission")] }],
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [
              command("sh hooks.sh push", { if: "Bash(git push *)", timeout: 5 }),
              command("sh hooks.sh pr", { if: "Bash(gh pr create *)" }),
              command("sh hooks.sh review", { if: "Bash(git commit *)", asyncRewake: true }),
            ],
          },
        ],
        PostToolUseFailure: [{ hooks: [command("sh hooks.sh failure")] }],
        UserPromptExpansion: [{ hooks: [command("sh hooks.sh expand")] }],
      },
      agents: [
        { file: "explore", frontmatter: { description: "Explores.", tools: "Read, Glob, Grep" } },
        {
          file: "lead",
          frontmatter: {
            description: "Leads a scan.",
            tools: "Read, Glob, Grep, Bash, Agent(security-scanner:explore, security-scanner:scan-inventory), Workflow(security-scanner:scan), TaskCreate",
          },
        },
      ],
    }),
  );

  it("carries the two synchronous 'if' handlers on Bash, with their conditions", () => {
    expect(accepted(outcome).hooks).toEqual({
      format: "claude-code",
      groups: [
        {
          event: "PostToolUse",
          matcher: "Bash",
          handlers: [
            { command: "sh hooks.sh push", args: [], timeoutSeconds: 5, condition: "Bash(git push *)", failClosed: false },
            { command: "sh hooks.sh pr", args: [], condition: "Bash(gh pr create *)", failClosed: false },
          ],
        },
      ],
    });
  });

  it("names the async handler and the three events it does not run", () => {
    expect(kindsOf(outcome).warnings).toEqual(["hook-event-not-run", "hook-event-not-run", "hook-event-not-run", "hook-handler-not-run"]);
    expect(outcome.warnings.filter((f) => f.kind === "hook-event-not-run").map((f) => f.subject)).toEqual([
      "PermissionRequest",
      "PostToolUseFailure",
      "UserPromptExpansion",
    ]);
  });

  it("keeps the agents' lists raw, plugin-scoped names and Claude-only tools included", () => {
    const lead = accepted(outcome).subAgents.find((agent) => agent.name === "lead");
    expect(lead?.tools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Bash",
      "Agent(security-scanner:explore, security-scanner:scan-inventory)",
      "Workflow(security-scanner:scan)",
      "TaskCreate",
    ]);
  });
});

describe("sources", () => {
  it("merges declared files and inline objects with hooks/hooks.json, reading a file named twice once", () => {
    const files = claudePlugin({
      hooks: { PreToolUse: [{ hooks: [command("default")] }] },
      manifest: {
        hooks: [
          "./config/extra.json",
          "./hooks/hooks.json",
          { PostToolUse: [{ matcher: "Write", hooks: [command("inline")] }] },
        ],
      },
      files: { "config/extra.json": JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [command("extra")] }] } }) },
    });
    const plugin = accepted(read(files));
    expect(plugin.hooks?.groups.map((g) => g.handlers[0]?.command)).toEqual(["extra", "default", "inline"]);
  });

  it("warns a declared file that is not in the plugin", () => {
    const outcome = read(claudePlugin({ manifest: { hooks: "./config/missing.json" } }));
    expect(findingOf(outcome.warnings, "path-missing")).toMatchObject({ path: ".claude-plugin/plugin.json", subject: "./config/missing.json" });
  });

  it("refuses an inline Claude object written with the file's wrapper", () => {
    const outcome = read(claudePlugin({ manifest: { hooks: { hooks: { PreToolUse: [] } } } }));
    expect(findingOf(refused(outcome), "hooks-shape").message).toBe(
      "hooks '.claude-plugin/plugin.json#hooks' are not in a shape Stigmer reads: an inline hooks object is the event map itself, with no 'hooks' wrapper",
    );
  });

  it("refuses a hooks field that is neither a path nor an object", () => {
    expect(kindsOf(read(claudePlugin({ manifest: { hooks: 3 } })))).toEqual({ errors: ["manifest-field-type"], warnings: [] });
  });

  it("refuses a declared hooks path that escapes the plugin", () => {
    expect(kindsOf(read(claudePlugin({ manifest: { hooks: "./../x.json" } })))).toEqual({ errors: ["path-escapes-root"], warnings: [] });
  });

  it("reads an empty hooks file as carrying nothing", () => {
    const files = withFile(claudePlugin(), "hooks/hooks.json", JSON.stringify({ hooks: {}, version: 1 }));
    expect(kindsOf(read(files))).toEqual({ errors: [], warnings: [] });
    expect(accepted(read(files)).hooks).toBeUndefined();
  });

  it("refuses an inline entry that is not a matcher group", () => {
    const outcome = read(claudePlugin({ manifest: { hooks: { PreToolUse: [{ command: "x" }] } } }));
    expect(findingOf(refused(outcome), "hooks-shape").detail).toBe("every entry on 'PreToolUse' must be a matcher group with a 'hooks' array");
  });

  it("skips an event with no entries beside one that has some", () => {
    const files = withFile(claudePlugin(), "hooks/hooks.json", JSON.stringify({ hooks: { Stop: [], PreToolUse: [{ hooks: [command("x")] }] } }));
    expect(kindsOf(read(files))).toEqual({ errors: [], warnings: [] });
    expect(accepted(read(files)).hooks?.groups.map((g) => g.event)).toEqual(["PreToolUse"]);
  });

  it("refuses a hooks file over its cap before reading it", () => {
    const files = withFile(claudePlugin(), "hooks/hooks.json", `{"hooks":{},"pad":"${"x".repeat(PLUGIN_DOCUMENT_LIMITS.hooks)}"}`);
    expect(kindsOf(read(files))).toEqual({ errors: ["document-too-large"], warnings: [] });
  });

  it("leaves hooks/ unread under the open manifest alone, naming it as a hook not read", () => {
    const files = withFile(openPlugin(), "hooks/hooks.json", "{ not even json");
    expect(kindsOf(read(files))).toEqual({ errors: [], warnings: ["hooks-not-read"] });
  });
});

describe("format checks", () => {
  it("refuses a file whose shape no manifest reaching it reads", () => {
    const files = withFile(cursorPlugin(), "hooks/hooks.json", JSON.stringify({ hooks: { preToolUse: [{ hooks: [command("x")] }] } }));
    expect(findingOf(refused(read(files)), "hooks-shape").message).toBe(
      "hooks 'hooks/hooks.json' are not in a shape Stigmer reads: they are written in Claude Code's format, but the manifest that reads them expects Cursor's",
    );
  });

  it("refuses a file that mixes the two formats", () => {
    const files = withFile(
      claudePlugin(),
      "hooks/hooks.json",
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [command("x")] }], preToolUse: [{ command: "y" }] } }),
    );
    expect(findingOf(refused(read(files)), "hooks-shape").detail).toBe("they mix Claude Code matcher groups with Cursor handlers");
  });

  it.each([
    ["an event that is not an array", { hooks: { PreToolUse: {} } }],
    ["an entry that is not an object", { hooks: { PreToolUse: ["x"] } }],
    ["a top-level hooks that is not an object", { hooks: [] }],
    ["handlers that are not objects", { hooks: { PreToolUse: [{ hooks: "x" }] } }],
    ["a not-run event whose group holds no handler list", { hooks: { Stop: [{ hooks: "x" }] } }],
    ["a non-string type", { hooks: { PreToolUse: [{ hooks: [{ type: 1, command: "x" }] }] } }],
    ["a non-string matcher", { hooks: { PreToolUse: [{ matcher: 1, hooks: [command("x")] }] } }],
    ["args that are not strings", { hooks: { PreToolUse: [{ hooks: [command("x", { args: [1] })] }] } }],
    ["a negative timeout", { hooks: { PreToolUse: [{ hooks: [command("x", { timeout: -1 })] }] } }],
    ["a non-string if", { hooks: { PreToolUse: [{ hooks: [command("x", { if: true })] }] } }],
  ])("refuses %s", (_case, document) => {
    expect(kindsOf(read(withFile(claudePlugin(), "hooks/hooks.json", JSON.stringify(document))))).toEqual({ errors: ["hooks-shape"], warnings: [] });
  });

  it("accepts '*', the empty matcher, exact lists and compiling regular expressions", () => {
    for (const matcher of ["", "*", "Bash", "Edit|Write", "Edit, Write", "mcp__plugin_db_tools__.*", "^Notebook"]) {
      expect(isValidMatcher(matcher, "claude-code"), matcher).toBe(true);
    }
    expect(isValidMatcher("*", "cursor")).toBe(true);
    expect(isValidMatcher("Shell|MCP:.*", "cursor")).toBe(true);
    expect(isValidMatcher("(", "cursor")).toBe(false);
    expect(isValidMatcher("[a-", "claude-code")).toBe(false);
  });
});

describe("Cursor's format", () => {
  const outcome = read(
    cursorPlugin({
      hooks: {
        preToolUse: [{ command: "./hooks/guard.sh", matcher: "Shell|MCP:.*", timeout: 5 }],
        beforeShellExecution: [
          { command: "./hooks/net.sh", matcher: "curl|wget", failClosed: true },
          { type: "prompt", prompt: "Is this command safe?" },
        ],
        afterMCPExecution: [{ command: "./hooks/audit.sh", loop_limit: 3 }],
        stop: [{ command: "./hooks/stop.sh", loop_limit: 3 }],
      },
    }),
  );

  it("carries each tool-call handler as a group of one, with its own matcher and failClosed", () => {
    expect(accepted(outcome).hooks).toEqual({
      format: "cursor",
      groups: [
        { event: "preToolUse", matcher: "Shell|MCP:.*", handlers: [{ command: "./hooks/guard.sh", args: [], timeoutSeconds: 5, failClosed: false }] },
        { event: "beforeShellExecution", matcher: "curl|wget", handlers: [{ command: "./hooks/net.sh", args: [], failClosed: true }] },
        { event: "afterMCPExecution", matcher: "", handlers: [{ command: "./hooks/audit.sh", args: [], failClosed: false }] },
      ],
    });
  });

  it("names the prompt handler, loop_limit on a carried handler, and the stop event", () => {
    expect(kindsOf(outcome).warnings).toEqual(["hook-event-not-run", "hook-field-ignored", "hook-handler-not-run"]);
    expect(findingOf(outcome.warnings, "hook-field-ignored")).toMatchObject({ subject: "afterMCPExecution", detail: "loop_limit" });
  });

  it("refuses a non-boolean failClosed, a missing command and an uncompilable matcher", () => {
    const bad = (handler: Readonly<Record<string, unknown>>) => kindsOf(read(cursorPlugin({ hooks: { preToolUse: [handler] } }))).errors;
    expect(bad({ command: "x", failClosed: "yes" })).toEqual(["hooks-shape"]);
    expect(bad({ command: " " })).toEqual(["hook-command-missing"]);
    expect(bad({ command: "x", matcher: "(" })).toEqual(["hook-matcher-invalid"]);
    expect(bad({ type: 2, command: "x" })).toEqual(["hooks-shape"]);
  });

  it("reads a Cursor inline object in its file's shape", () => {
    const plugin = accepted(read(cursorPlugin({ manifest: { hooks: { version: 1, hooks: { preToolUse: [{ command: "x" }] } } } })));
    expect(plugin.hooks?.groups.map((g) => g.event)).toEqual(["preToolUse"]);
  });
});

describe("Codex and plugins with two formats", () => {
  it("reads a Codex plugin's hooks as Claude Code's format", () => {
    const plugin = accepted(read(codexPlugin({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [command("guard")] }] } })));
    expect(plugin.hooks?.format).toBe("claude-code");
  });

  it("runs the Claude Code hooks when a plugin carries both formats", () => {
    const files = new Map([
      ...claudePlugin({ hooks: { PreToolUse: [{ hooks: [command("claude")] }] } }),
      ...cursorPlugin({
        manifest: { hooks: "./hooks/cursor.json" },
        files: { "hooks/cursor.json": JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: "cursor" }], stop: [{ command: "s" }] } }) },
      }),
    ]);
    const outcome = read(files);
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["hooks-format-not-run"] });
    expect(accepted(outcome).hooks?.groups.map((g) => g.handlers[0]?.command)).toEqual(["claude"]);
  });

  it("runs Cursor's tool-call hooks when the Claude Code ones carry only lifecycle events, or nothing", () => {
    const guard = { preToolUse: [{ command: "./guard.sh", failClosed: true }] };
    const lifecycleOnly = new Map([
      ...claudePlugin({ hooks: { Stop: [{ hooks: [command("summary")] }] } }),
      ...cursorPlugin({ manifest: { hooks: "./hooks/cursor.json" }, files: { "hooks/cursor.json": JSON.stringify({ version: 1, hooks: guard }) } }),
    ]);
    const outcome = read(lifecycleOnly);
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["hook-event-not-run"] });
    expect(accepted(outcome).hooks).toEqual({
      format: "cursor",
      groups: [{ event: "preToolUse", matcher: "", handlers: [{ command: "./guard.sh", args: [], failClosed: true }] }],
    });
    const emptyInline = new Map([...claudePlugin({ manifest: { hooks: {} } }), ...cursorPlugin({ hooks: guard })]);
    expect(kindsOf(read(emptyInline))).toEqual({ errors: [], warnings: [] });
    expect(accepted(read(emptyInline)).hooks?.format).toBe("cursor");
  });

  it("runs Cursor's hooks when they are the only ones", () => {
    const files = new Map([...claudePlugin(), ...cursorPlugin({ hooks: { preToolUse: [{ command: "cursor" }] } })]);
    expect(accepted(read(files)).hooks?.format).toBe("cursor");
  });
});

describe("variables a hook references", () => {
  it("counts ${user_config.KEY} in an exec-form handler as a reference", () => {
    const files = claudePlugin({
      userConfig: { WEBHOOK: { type: "string" } },
      hooks: { PreToolUse: [{ hooks: [command("node", { args: ["notify.js", "${user_config.WEBHOOK}"] })] }] },
    });
    expect(kindsOf(read(files))).toEqual({ errors: [], warnings: [] });
  });

  it("does not count a shell-form command, where Claude Code does not substitute it", () => {
    const files = claudePlugin({
      userConfig: { WEBHOOK: { type: "string" } },
      hooks: { PreToolUse: [{ hooks: [command("notify ${user_config.WEBHOOK}")] }] },
    });
    expect(kindsOf(read(files))).toEqual({ errors: [], warnings: ["variable-unreferenced"] });
  });

  it("reads the same references off a read plugin's hooks, once each, exec form only", () => {
    const plugin = accepted(
      read(
        claudePlugin({
          userConfig: { WEBHOOK: { type: "string" }, CHANNEL: { type: "string" } },
          hooks: {
            PreToolUse: [
              { hooks: [command("node", { args: ["notify.js", "${user_config.WEBHOOK}", "${user_config.CHANNEL}"] })] },
              { hooks: [command("echo ${user_config.SHELL_ONLY}")] },
            ],
            PostToolUse: [{ hooks: [command("${user_config.WEBHOOK}", { args: ["post"] })] }],
          },
        }),
      ),
    );
    expect(plugin.hooks && hookVariableReferences(plugin.hooks)).toEqual(["WEBHOOK", "CHANNEL"]);
  });

  it("reads the same references off a stored hook set, which is not a read plugin's", () => {
    // The shape a plugin's recorded hooks and an agent's inline hooks have on
    // the wire: the console declares these names on an agent it switches a
    // plugin's hooks on for, by the rule install uses.
    const stored = {
      format: 1,
      groups: [
        {
          event: "PreToolUse",
          matcher: "",
          handlers: [
            { command: "python3", args: ["check.py", "${user_config.API_TOKEN}"], timeoutSeconds: 0, condition: "" },
            { command: "echo ${user_config.SHELL_ONLY}", args: [], timeoutSeconds: 0, condition: "" },
          ],
        },
      ],
    };
    expect(hookVariableReferences(stored)).toEqual(["API_TOKEN"]);
  });
});

describe("HOOK_WARNING_KINDS", () => {
  it("holds exactly the warnings that name hooks Stigmer does not run", () => {
    expect([...HOOK_WARNING_KINDS].sort()).toEqual([
      "hook-event-not-run",
      "hook-handler-not-run",
      "hooks-format-not-run",
      "hooks-not-read",
      "skill-hooks-not-run",
    ]);
    for (const kind of HOOK_WARNING_KINDS) {
      expect(warningMessage(kind, { path: "hooks/hooks.json", subject: "Stop" }), kind).toMatch(/hook/);
    }
    // Its hook runs, with one field unread, so it stays among the other warnings.
    expect(HOOK_WARNING_KINDS.has("hook-field-ignored")).toBe(false);
  });

  it("classes a plugin's every hook finding as one, so a surface lists none of them twice", () => {
    const outcome = read(
      claudePlugin({
        hooks: { PreToolUse: [{ hooks: [command("node check.js")] }], Stop: [{ hooks: [command("node stop.js")] }] },
        skills: [{ name: "s", description: "d", frontmatter: { hooks: { PreToolUse: [] } } }],
      }),
    );
    const warnings = kindsOf(outcome).warnings;
    expect(warnings).toEqual(["hook-event-not-run", "skill-hooks-not-run"]);
    const hookKinds: ReadonlySet<string> = HOOK_WARNING_KINDS;
    expect(warnings.every((kind) => hookKinds.has(kind))).toBe(true);
  });
});
