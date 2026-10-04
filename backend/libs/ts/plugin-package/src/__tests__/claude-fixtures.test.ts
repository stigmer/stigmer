/**
 * The Claude fixture suite: three real Claude Code plugins, vendored from
 * anthropics/claude-plugins-official at d182ca456 (see
 * fixtures/claude-plugins/NOTICE), read exactly as a user's checkout would
 * be. As in the Cursor suite, every assertion names the field it pins.
 *
 * Between them the three cover: tool hooks with no matcher that run as
 * written (hookify), a matcher list carried beside seven `if` handlers that
 * are all `asyncRewake` and so not run (security-guidance), lifecycle
 * events named as not run (both), a YAML-list `tools` (hookify) and a comma
 * `tools` naming Claude-only tools such as `LS` and `KillShell`, kept as
 * written for the runner to ignore per entry (feature-dev).
 */

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readPluginPackage } from "../read-plugin-package.js";
import { directoryPluginFiles } from "../__test-utils__/directory-files.js";
import { accepted, kindsOf } from "../__test-utils__/read.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/claude-plugins/", import.meta.url));

function readFixture(name: string) {
  return readPluginPackage(directoryPluginFiles(`${FIXTURES}${name}`));
}

describe("hookify: tool hooks that run as written", () => {
  const outcome = readFixture("hookify");

  it("is accepted, naming Stop and UserPromptSubmit as not run", () => {
    expect(kindsOf(outcome)).toEqual({
      errors: [],
      warnings: ["hook-event-not-run", "hook-event-not-run", "skill-name-differs-from-directory", "sub-agent-field-ignored"],
    });
    expect(outcome.warnings.filter((f) => f.kind === "hook-event-not-run").map((f) => f.subject)).toEqual(["Stop", "UserPromptSubmit"]);
  });

  it("carries its PreToolUse and PostToolUse hooks with no matcher, placeholders verbatim", () => {
    expect(accepted(outcome).hooks).toEqual({
      format: "claude-code",
      groups: [
        {
          event: "PreToolUse",
          matcher: "",
          handlers: [{ command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py"', args: [], timeoutSeconds: 10, failClosed: false }],
        },
        {
          event: "PostToolUse",
          matcher: "",
          handlers: [{ command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse.py"', args: [], timeoutSeconds: 10, failClosed: false }],
        },
      ],
    });
  });

  it("reads the agent's YAML-list tools", () => {
    expect(accepted(outcome).subAgents.map((a) => [a.name, a.tools])).toEqual([["conversation-analyzer", ["Read", "Grep"]]]);
  });

  it("no longer records hooks/ as ignored", () => {
    expect(accepted(outcome).ignored).toEqual([{ kind: "commands", path: "commands/" }]);
  });
});

describe("security-guidance: one handler runs, seven background reviews and four events do not", () => {
  const outcome = readFixture("security-guidance");

  it("carries the Edit|Write|MultiEdit|NotebookEdit handler", () => {
    expect(accepted(outcome).hooks).toEqual({
      format: "claude-code",
      groups: [
        {
          event: "PostToolUse",
          matcher: "Edit|Write|MultiEdit|NotebookEdit",
          handlers: [
            {
              command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/sg-python.sh" "${CLAUDE_PLUGIN_ROOT}/hooks/security_reminder_hook.py"',
              args: [],
              failClosed: false,
            },
          ],
        },
      ],
    });
  });

  it("names its seven 'if' handlers as asyncRewake, and SessionStart, UserPromptSubmit, Stop and SubagentStop", () => {
    const notRun = outcome.warnings.filter((f) => f.kind === "hook-handler-not-run");
    expect(notRun).toHaveLength(7);
    expect(new Set(notRun.map((f) => f.detail))).toEqual(new Set(["it runs in the background ('asyncRewake'), so it cannot decide a call"]));
    expect(outcome.warnings.filter((f) => f.kind === "hook-event-not-run").map((f) => f.subject)).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "SubagentStop",
    ]);
    expect(kindsOf(outcome).warnings).toHaveLength(11);
  });
});

describe("feature-dev: comma tool lists with Claude-only names", () => {
  const outcome = readFixture("feature-dev");

  it("is accepted with each agent's color warned and no hooks", () => {
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["sub-agent-field-ignored", "sub-agent-field-ignored", "sub-agent-field-ignored"] });
    expect(accepted(outcome).hooks).toBeUndefined();
  });

  it("keeps LS, NotebookRead, KillShell and BashOutput in the list as written", () => {
    const explorer = accepted(outcome).subAgents.find((a) => a.name === "code-explorer");
    expect(explorer?.tools).toEqual(["Glob", "Grep", "LS", "Read", "NotebookRead", "WebFetch", "TodoWrite", "WebSearch", "KillShell", "BashOutput"]);
    expect(explorer?.modelHint).toEqual({ raw: "sonnet", alias: "sonnet" });
  });
});
