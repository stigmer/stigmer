/**
 * HookConfigList shows a hook set the way both the plugin page and the agent
 * page do. Pins: one row per group with the event in plain words beside its
 * own name; an empty matcher and `*` read "every tool" and any other matcher
 * is shown verbatim; every handler's command and arguments verbatim (an
 * argument with a space quoted, so where it ends stays readable); a
 * handler's `if` condition and timeout when set, and nothing when not; an
 * event without plain words shown by its name alone.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { HookConfigSchema, HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { HookConfigList } from "../HookConfigList.js";

afterEach(cleanup);

describe("HookConfigList", () => {
  it("lists each event in plain words beside its name, its matcher, and every command verbatim", () => {
    render(
      <HookConfigList
        config={create(HookConfigSchema, {
          format: HookFormat.CLAUDE_CODE,
          groups: [
            { event: "PreToolUse", matcher: "", handlers: [{ command: "python3", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py"] }] },
            {
              event: "PreToolUse",
              matcher: "Bash|Write",
              handlers: [{ command: "node", args: ["check.js", "two words"], condition: "Bash(git push *)", timeoutSeconds: 10 }],
            },
            { event: "PostToolUse", matcher: "*", handlers: [{ command: "./log.sh" }] },
          ],
        })}
      />,
    );

    const list = screen.getByRole("list", { name: "Hooks (Claude Code format)" });
    const rows = within(list).getAllByRole("listitem").filter((item) => item.parentElement === list);
    expect(rows).toHaveLength(3);

    expect(within(rows[0]!).getByText("Before a tool call")).toBeTruthy();
    expect(within(rows[0]!).getByText("PreToolUse")).toBeTruthy();
    expect(within(rows[0]!).getByText("on every tool")).toBeTruthy();
    expect(within(rows[0]!).getByText("python3 ${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py")).toBeTruthy();
    expect(within(rows[0]!).queryByText("only if")).toBeNull();
    expect(within(rows[0]!).queryByText(/timeout/)).toBeNull();

    expect(within(rows[1]!).getByText("Bash|Write")).toBeTruthy();
    expect(within(rows[1]!).getByText('node check.js "two words"')).toBeTruthy();
    expect(within(rows[1]!).getByText("Bash(git push *)")).toBeTruthy();
    expect(within(rows[1]!).getByText("10s")).toBeTruthy();

    expect(within(rows[2]!).getByText("After a tool call")).toBeTruthy();
    expect(within(rows[2]!).getByText("on every tool")).toBeTruthy();
    expect(within(rows[2]!).getByText("./log.sh")).toBeTruthy();
  });

  it("names a Cursor-format set, and shows an event without plain words by its name alone", () => {
    render(
      <HookConfigList
        config={create(HookConfigSchema, {
          format: HookFormat.CURSOR,
          groups: [
            { event: "beforeShellExecution", handlers: [{ command: "./guard.sh" }] },
            { event: "somethingNew", handlers: [{ command: "./other.sh" }] },
          ],
        })}
      />,
    );

    const list = screen.getByRole("list", { name: "Hooks (Cursor format)" });
    expect(within(list).getByText("Before a shell command")).toBeTruthy();
    expect(within(list).getByRole("list", { name: "Commands run somethingNew" })).toBeTruthy();
  });
});
