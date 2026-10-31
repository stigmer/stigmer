// Pins the session's composer (FollowUpInput over input/composer-logic.ts),
// driven through Ink's own input parser:
//   - INK-08: several lines, a bracketed paste (a large one collapsed and sent
//     whole), Up and Down through rows and history, a draft kept while the
//     composer cannot send, Ctrl+C and a double Esc clearing a draft;
//   - INK-09: a host's slash command runs with its context instead of being
//     sent, a `/word` no command names is sent as written, a completion's
//     `attach` reaches the message, and an open menu owns Esc;
//   - the history walk, the paste label and the menu matching as plain logic.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { Text } from "ink";
import { FollowUpInput } from "../components/FollowUpInput.js";
import { TextField } from "../components/TextField.js";
import { KeyOwnerProvider, useKeysFree } from "../app/key-owner.js";
import type { ComposerContext, ComposerExtensions, PromptHistory } from "../input/extensions.js";
import {
  NO_WALK,
  acceptMenuItem,
  appendHistory,
  attachmentsOf,
  expandPastes,
  matchCommands,
  menuQuery,
  parseCommand,
  pasteInsert,
  stepHistory,
} from "../input/composer-logic.js";
import { bufferOf } from "../input/text-buffer.js";

afterEach(() => {
  cleanup();
});

/** Lets Ink read the keys and the view settle (a lone Esc waits 20 ms for a sequence). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

/** Types each chunk, letting Ink read it. */
async function type(stdin: { write: (data: string) => void }, ...chunks: string[]) {
  for (const chunk of chunks) {
    stdin.write(chunk);
    await settle();
  }
}

const ENTER = "\r";
const ESC = "\u001b";
const UP = "\u001b[A";
const DOWN = "\u001b[B";
const paste = (text: string) => `\u001b[200~${text}\u001b[201~`;

function context(overrides: Partial<ComposerContext> = {}): ComposerContext {
  return { mode: "agent", send: vi.fn(), stop: vi.fn(), note: vi.fn(), setMode: vi.fn(), leave: vi.fn(), ...overrides };
}

/** Whether the keys are free, drawn beside the composer, for the claim the menu takes. */
function FreeProbe() {
  return <Text>{useKeysFree() ? "keys:free" : "keys:claimed"}</Text>;
}

describe("INK-08 the composer takes several lines, paste, and history", () => {
  it("sends a message typed on two lines, by each new-line key", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={onSubmit} />);
    await type(stdin, "only the tests", "\\", ENTER, "and keep it small", "\n", "please", "\u001b\r", "now");
    expect(lastFrame()).toContain("only the tests\n   and keep it small\n   please\n   now");
    await type(stdin, ENTER);
    expect(onSubmit).toHaveBeenCalledWith("only the tests\nand keep it small\nplease\nnow", undefined);
    expect(lastFrame()).toContain("Reply...");
  });

  it("puts a small paste in as typed, line breaks kept, and collapses a large one that is sent whole", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={onSubmit} />);
    const trace = ["AssertionError: expected 1.02 to equal 1.01", "    at round.test.ts:14:22", "    at runTest (vitest/runner.js:88:9)", "    at run (vitest/runner.js:120:3)", "    at main"].join("\n");
    await type(stdin, "see ", paste(trace), " and ", paste("two\nlines"));
    expect(lastFrame()).toContain("see [Pasted text #1 +4 lines] and two");
    // Backspace takes a label whole.
    await type(stdin, ...Array.from({ length: " and two\nlines".length }, () => "\u001b[D"), "\u007f", ENTER);
    expect(onSubmit).toHaveBeenCalledWith("see  and two\nlines", undefined);
    await type(stdin, paste(trace), ENTER);
    expect(onSubmit).toHaveBeenLastCalledWith(trace, undefined);
  });

  it("walks the history with Up and Down from the first and last rows, and brings the draft back", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={onSubmit} />);
    await type(stdin, "first", ENTER, "second\nline", ENTER, "draft");
    await type(stdin, UP);
    expect(lastFrame()).toContain("second\n   line");
    await type(stdin, UP);
    // Up from the last row moves to the first row before it walks.
    expect(lastFrame()).toContain("second\n   line");
    await type(stdin, UP);
    expect(lastFrame()).toContain("❯ first");
    await type(stdin, UP);
    expect(lastFrame()).toContain("❯ first");
    await type(stdin, DOWN, DOWN, DOWN);
    expect(lastFrame()).toContain("❯ draft");
  });

  it("loads and keeps the host's history, one entry per message, repeats kept once", async () => {
    const appended: string[] = [];
    const history: PromptHistory = { load: async () => ["from yesterday"], append: (entry) => void appended.push(entry) };
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={vi.fn()} composer={{ history }} />);
    await settle();
    await type(stdin, UP);
    expect(lastFrame()).toContain("❯ from yesterday");
    await type(stdin, ENTER, UP, ENTER);
    expect(appended).toEqual(["from yesterday", "from yesterday"]);
  });

  it("goes on without a host history that cannot be read or kept", async () => {
    const onSubmit = vi.fn();
    const failing: PromptHistory = { load: async () => Promise.reject(new Error("disk full")), append: async () => Promise.reject(new Error("disk full")) };
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={onSubmit} composer={{ history: failing }} />);
    await type(stdin, "first", ENTER, UP);
    expect(onSubmit).toHaveBeenCalledWith("first", undefined);
    expect(lastFrame()).toContain("❯ first");
    cleanup();
    const throwing: PromptHistory = {
      load: () => {
        throw new Error("unreadable");
      },
      append: () => {
        throw new Error("unwritable");
      },
    };
    const second = render(<FollowUpInput onSubmit={onSubmit} composer={{ history: throwing }} />);
    await type(second.stdin, "second", ENTER, UP);
    expect(second.lastFrame()).toContain("❯ second");
  });

  it("keeps the draft while it cannot send, and lets Ctrl+C clear it", async () => {
    const onSubmit = vi.fn();
    const drafts: boolean[] = [];
    const { stdin, lastFrame, rerender } = render(<FollowUpInput onSubmit={onSubmit} onDraftChange={(has) => drafts.push(has)} />);
    await type(stdin, "keep me");
    rerender(<FollowUpInput onSubmit={onSubmit} disabled onDraftChange={(has) => drafts.push(has)} />);
    await type(stdin, "x", ENTER);
    expect(lastFrame()).toContain("❯ keep me");
    expect(onSubmit).not.toHaveBeenCalled();
    await type(stdin, "\u0003");
    expect(lastFrame()).toContain("Reply...");
    expect(drafts.at(-1)).toBe(false);
    expect(drafts).toContain(true);
  });

  it("clears a draft on Esc twice, into the history, unless Esc stops a turn", async () => {
    const { stdin, lastFrame, rerender } = render(<FollowUpInput onSubmit={vi.fn()} />);
    await type(stdin, "wrong idea", ESC);
    expect(lastFrame()).toContain("wrong idea");
    await type(stdin, ESC);
    expect(lastFrame()).toContain("Reply...");
    await type(stdin, UP);
    expect(lastFrame()).toContain("❯ wrong idea");
    rerender(<FollowUpInput onSubmit={vi.fn()} escapeClears={false} />);
    await type(stdin, ESC, ESC);
    expect(lastFrame()).toContain("❯ wrong idea");
  });

  it("sends nothing for an empty message, and sends text typed with its Enter in one read", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={onSubmit} />);
    await type(stdin, ENTER, "   ", ENTER);
    expect(onSubmit).not.toHaveBeenCalled();
    await type(stdin, "\u0015", "typed fast\r");
    expect(onSubmit).toHaveBeenCalledWith("typed fast", undefined);
    expect(lastFrame()).toContain("Reply...");
  });

  it("leaves the history once a recalled message is edited", async () => {
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={vi.fn()} />);
    await type(stdin, "first", ENTER, UP, "!");
    expect(lastFrame()).toContain("❯ first!");
    // Off the walk: Down has no draft to bring back.
    await type(stdin, DOWN);
    expect(lastFrame()).toContain("❯ first!");
  });

  it("shows 'Sending...' while a message is on its way, and lists the keys on '?'", async () => {
    expect(render(<FollowUpInput onSubmit={vi.fn()} isSubmitting />).lastFrame()).toContain("Sending...");
    cleanup();
    const commands = [{ name: "deploy", description: "Ship it", run: vi.fn() }];
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={vi.fn()} composer={{ commands }} />);
    await type(stdin, "?");
    expect(lastFrame()).toContain("Esc");
    expect(lastFrame()).toMatch(/\/deploy\s+Ship it/);
    await type(stdin, "?");
    expect(lastFrame()).not.toContain("Ship it");
    await type(stdin, "?", "a");
    expect(lastFrame()).not.toContain("Ship it");
    expect(lastFrame()).toContain("❯ a");
  });

  it("starts a new line on Ctrl+J as the kitty keyboard protocol reports it", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<FollowUpInput onSubmit={onSubmit} />);
    await type(stdin, "one", "\u001b[106;5u", "two", ENTER);
    expect(onSubmit).toHaveBeenCalledWith("one\ntwo", undefined);
  });
});

describe("INK-09 a host CLI adds its own slash commands and @ completions", () => {
  const deploy = { name: "deploy", description: "Ship to an environment", args: "<environment>", run: vi.fn() };
  const doctor = { name: "doctor", description: "Check the setup", run: vi.fn() };

  it("runs a host command with its context instead of sending it, and sends a /word no command names", async () => {
    const onSubmit = vi.fn();
    const ctx = context();
    const { stdin } = render(<FollowUpInput onSubmit={onSubmit} composer={{ commands: [deploy, doctor] }} context={ctx} />);
    await type(stdin, "/deploy staging", ENTER);
    expect(deploy.run).toHaveBeenCalledWith("staging", ctx);
    expect(onSubmit).not.toHaveBeenCalled();
    await type(stdin, "/etc/hosts is wrong", ENTER);
    expect(onSubmit).toHaveBeenCalledWith("/etc/hosts is wrong", undefined);
  });

  it("gives a command what was pasted, not its label, and says in the thread when a command fails", async () => {
    const ask = { name: "ask", description: "Ask about a trace", run: vi.fn() };
    const broken = { name: "broken", description: "Fails", run: async () => Promise.reject(new Error("no route to host")) };
    const thrower = {
      name: "thrower",
      description: "Throws",
      run: () => {
        throw "plain words";
      },
    };
    const ctx = context();
    const { stdin } = render(<FollowUpInput onSubmit={vi.fn()} composer={{ commands: [ask, broken, thrower] }} context={ctx} />);
    const trace = ["Error: boom", "  at a", "  at b", "  at c"].join("\n");
    await type(stdin, "/ask ", paste(trace), ENTER);
    expect(ask.run).toHaveBeenCalledWith(trace, ctx);
    await type(stdin, "/broken", ENTER);
    expect(ctx.note).toHaveBeenCalledWith("/broken failed: no route to host");
    await type(stdin, "/thrower", ENTER);
    expect(ctx.note).toHaveBeenCalledWith("/thrower failed: plain words");
  });

  it("opens the command menu on '/', filters as the person types, and takes the selected one on Tab", async () => {
    const ctx = context();
    const { stdin, lastFrame } = render(
      <KeyOwnerProvider>
        <FreeProbe />
        <FollowUpInput onSubmit={vi.fn()} composer={{ commands: [deploy, doctor] }} context={ctx} />
      </KeyOwnerProvider>,
    );
    await type(stdin, "/");
    expect(lastFrame()).toMatch(/▸ \/deploy <environment>\s+Ship to an environment/);
    expect(lastFrame()).toContain("/doctor");
    expect(lastFrame()).toContain("keys:claimed");
    await type(stdin, "do");
    expect(lastFrame()).not.toContain("/deploy");
    await type(stdin, "\t");
    expect(lastFrame()).toMatch(/❯ \/doctor\n/);
    expect(lastFrame()).toContain("keys:free");
    await type(stdin, ENTER);
    expect(doctor.run).toHaveBeenCalledWith("", ctx);
  });

  it("moves the selection with the arrows, runs a command typed in full on Enter, and closes the menu on Esc", async () => {
    const ctx = context();
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={vi.fn()} composer={{ commands: [deploy, doctor] }} context={ctx} />);
    await type(stdin, "/", DOWN);
    expect(lastFrame()).toContain("▸ /doctor");
    await type(stdin, UP, UP);
    expect(lastFrame()).toContain("▸ /doctor");
    await type(stdin, ESC);
    expect(lastFrame()).not.toContain("Check the setup");
    await type(stdin, "\u007f", "/doctor");
    await type(stdin, ENTER);
    expect(doctor.run).toHaveBeenCalledWith("", ctx);
  });

  it("completes behind a trigger, and sends what the accepted item attaches while its text stays", async () => {
    const onSubmit = vi.fn();
    const queries: string[] = [];
    const extensions: ComposerExtensions = {
      completions: [
        {
          trigger: "@",
          complete: (query) => {
            queries.push(query);
            return [
              { label: "src/billing/round.ts", insert: "@src/billing/round.ts", detail: "file", attach: { workspaceFileRefs: ["src/billing/round.ts"] } },
              { label: "src/billing/invoice.ts", insert: "@src/billing/invoice.ts" },
            ].filter((item) => item.label.includes(query));
          },
        },
      ],
    };
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={onSubmit} composer={extensions} />);
    await type(stdin, "look at @rou");
    expect(lastFrame()).toMatch(/▸ src\/billing\/round\.ts\s+file/);
    expect(queries.at(-1)).toBe("rou");
    await type(stdin, ENTER);
    expect(lastFrame()).toMatch(/look at @src\/billing\/round\.ts\n/);
    await type(stdin, "please", ENTER);
    expect(onSubmit).toHaveBeenCalledWith("look at @src/billing/round.ts please", { workspaceFileRefs: ["src/billing/round.ts"] });
  });

  it("drops a completion that failed, and shows no menu for it", async () => {
    const extensions: ComposerExtensions = { completions: [{ trigger: "#", complete: async () => Promise.reject(new Error("offline")) }] };
    const { stdin, lastFrame } = render(<FollowUpInput onSubmit={vi.fn()} composer={extensions} />);
    await type(stdin, "#12");
    expect(lastFrame()).toContain("❯ #12");
    expect(lastFrame()).not.toContain("▸");
  });
});

describe("a one-line field", () => {
  it("takes a paste on one line, its line breaks as spaces", async () => {
    const changes: string[] = [];
    function Field() {
      const [value, setValue] = React.useState(bufferOf(""));
      return (
        <TextField
          value={value}
          onChange={(next) => {
            changes.push(next.text);
            setValue(next);
          }}
          onSubmit={vi.fn()}
        />
      );
    }
    const { stdin, lastFrame } = render(<Field />);
    await type(stdin, paste("two\nlines\r\nhere"));
    expect(changes.at(-1)).toBe("two lines here");
    expect(lastFrame()).toContain("two lines here");
  });
});

describe("the composer's logic", () => {
  it("walks history back to the oldest and forward to the draft", () => {
    const entries = ["one", "two"];
    const back = stepHistory(entries, NO_WALK, "draft", "back")!;
    expect(back).toEqual({ walk: { index: 1, draft: "draft" }, text: "two" });
    const older = stepHistory(entries, back.walk, "two", "back")!;
    expect(older).toEqual({ walk: { index: 0, draft: "draft" }, text: "one" });
    expect(stepHistory(entries, older.walk, "one", "back")).toBeUndefined();
    expect(stepHistory(entries, older.walk, "one", "forward")).toEqual({ walk: { index: 1, draft: "draft" }, text: "two" });
    expect(stepHistory(entries, back.walk, "two", "forward")).toEqual({ walk: NO_WALK, text: "draft" });
    expect(stepHistory(entries, NO_WALK, "draft", "forward")).toBeUndefined();
    expect(stepHistory([], NO_WALK, "draft", "back")).toBeUndefined();
  });

  it("keeps a message once when it repeats the newest, never a blank one, and at most the limit", () => {
    expect(appendHistory(["a"], "a")).toEqual(["a"]);
    expect(appendHistory(["a"], "  ")).toEqual(["a"]);
    expect(appendHistory(["a", "b"], "a")).toEqual(["a", "b", "a"]);
    expect(appendHistory(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
  });

  it("collapses a paste over 800 characters or three lines, numbering each, and expands it when sent", () => {
    expect(pasteInsert("a\r\nb\nc", 1)).toEqual({ insert: "a\nb\nc" });
    expect(pasteInsert("a\rb\rc\rd", 1).label).toBe("[Pasted text #1 +3 lines]");
    expect(pasteInsert("a\nb\nc\nd", 1)).toEqual({ insert: "[Pasted text #1 +3 lines]", label: "[Pasted text #1 +3 lines]" });
    expect(pasteInsert("x".repeat(800), 1)).toEqual({ insert: "x".repeat(800) });
    expect(pasteInsert("x".repeat(801), 2).label).toBe("[Pasted text #2 +0 lines]");
    const pastes = new Map([["[Pasted text #1 +3 lines]", "a\nb\nc\nd"]]);
    expect(expandPastes("see [Pasted text #1 +3 lines] and [Pasted text #1 +3 lines]", pastes)).toBe("see a\nb\nc\nd and a\nb\nc\nd");
  });

  it("finds the command menu only at the start of a one-line message, and a trigger at a word's start", () => {
    expect(menuQuery(bufferOf("/dep"), ["@"])).toEqual({ kind: "command", query: "dep", start: 0 });
    expect(menuQuery(bufferOf("/deploy now"), ["@"])).toBeUndefined();
    expect(menuQuery(bufferOf("/dep\nx", 4), ["@"])).toBeUndefined();
    expect(menuQuery(bufferOf("see @src/b"), ["@"])).toEqual({ kind: "completion", trigger: "@", query: "src/b", start: 4 });
    expect(menuQuery(bufferOf("@"), ["@"])).toEqual({ kind: "completion", trigger: "@", query: "", start: 0 });
    expect(menuQuery(bufferOf("mail me@host"), ["@"])).toBeUndefined();
    expect(menuQuery(bufferOf("see @src then", 8), ["@"])).toEqual({ kind: "completion", trigger: "@", query: "src", start: 4 });
    expect(menuQuery(bufferOf("plain"), ["@"])).toBeUndefined();
    expect(menuQuery(bufferOf("line one\n@doc"), ["@"])).toEqual({ kind: "completion", trigger: "@", query: "doc", start: 9 });
    expect(menuQuery(bufferOf("tab\t@x"), ["@"])).toEqual({ kind: "completion", trigger: "@", query: "x", start: 4 });
  });

  it("finds the menu in time linear in a long draft", () => {
    const long = `${"x".repeat(200_000)}\n${"y ".repeat(10)}`;
    const started = performance.now();
    expect(menuQuery(bufferOf(long), ["@"])).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("matches commands that start with the query first, then those that contain it, in any case", () => {
    const named = (name: string) => ({ name, description: "", run: () => {} });
    const commands = [named("redeploy"), named("Deploy"), named("doctor")];
    expect(matchCommands(commands, "dep").map((command) => command.name)).toEqual(["Deploy", "redeploy"]);
    expect(matchCommands(commands, "").map((command) => command.name)).toEqual(["redeploy", "Deploy", "doctor"]);
  });

  it("replaces what was typed with the item and a space, and reads a sent message as a command", () => {
    const query = menuQuery(bufferOf("see @rou more", 8), ["@"])!;
    expect(acceptMenuItem(bufferOf("see @rou more", 8), query, "@src/round.ts")).toEqual({ text: "see @src/round.ts  more", cursor: 18 });
    const deploy = { name: "deploy", description: "", run: () => {} };
    expect(parseCommand("  /deploy  staging now ", [deploy])).toEqual({ command: deploy, args: "staging now" });
    expect(parseCommand("/deploy", [deploy])).toEqual({ command: deploy, args: "" });
    expect(parseCommand("/deployx", [deploy])).toBeUndefined();
    expect(parseCommand("deploy", [deploy])).toBeUndefined();
    expect(parseCommand("please /deploy now", [deploy])).toBeUndefined();
    expect(parseCommand("/deploy\tstaging", [deploy])).toEqual({ command: deploy, args: "staging" });
  });

  it("attaches what each accepted item stands for while its text stays, each file once", () => {
    const a = { label: "a", insert: "@a", attach: { workspaceFileRefs: ["a"], fileIds: ["file_1"] } };
    const b = { label: "b", insert: "@b", attach: { fileIds: ["file_1", "file_2"] } };
    const c = { label: "c", insert: "@c" };
    expect(attachmentsOf("@a and @b and @c", [a, b, c])).toEqual({ workspaceFileRefs: ["a"], fileIds: ["file_1", "file_2"] });
    expect(attachmentsOf("only @b", [a, b])).toEqual({ fileIds: ["file_1", "file_2"] });
    expect(attachmentsOf("none", [a, b, c])).toBeUndefined();
    // An item that attaches nothing adds nothing, even when its text stays.
    expect(attachmentsOf("only @c", [a, b, c])).toBeUndefined();
  });
});
