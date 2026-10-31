// Pins what `stigmer run` and `stigmer resume` give the terminal kit's
// composer (composer.ts): its four commands, `@` over the session's local
// folders sent as workspace references, and a prompt history per directory
// in a file only its owner reads, the last 500 kept.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerContext } from "@stigmer/ink-ui";
import { HISTORY_LIMIT, cliCommands, cliComposer, fileHistory, historyPath, presentRoots, workspaceCompletion } from "../composer.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stigmer-composer-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function context(): ComposerContext {
  return { mode: "agent", send: vi.fn(), stop: vi.fn(), note: vi.fn(), setMode: vi.fn(), leave: vi.fn() };
}

function command(name: string) {
  return cliCommands().find((candidate) => candidate.name === name)!;
}

describe("INK-09 stigmer run adds its own slash commands and @ completions through the kit's hooks", () => {
  it("registers /help, /mode, /stop and /exit, each acting through the session's context", async () => {
    expect(cliCommands().map((candidate) => candidate.name)).toEqual(["help", "mode", "stop", "exit"]);
    const ctx = context();
    await command("help").run("", ctx);
    expect(vi.mocked(ctx.note).mock.calls[0]![0]).toMatch(/^\/help {2}List the commands and keys\n\/mode plan\|agent {2}Switch to plan.*\n\/stop.*\n\/exit.*\n@<path>.*\nEsc stops the agent/);
    await command("mode").run("plan", ctx);
    expect(ctx.setMode).toHaveBeenCalledWith("plan");
    await command("mode").run("agent", ctx);
    expect(ctx.setMode).toHaveBeenLastCalledWith("agent");
    await command("mode").run("fast", ctx);
    expect(ctx.note).toHaveBeenLastCalledWith("/mode takes plan or agent; this session is in agent mode.");
    await command("stop").run("", ctx);
    expect(ctx.stop).toHaveBeenCalledTimes(1);
    await command("exit").run("", ctx);
    expect(ctx.leave).toHaveBeenCalledTimes(1);
  });

  it("completes paths under the session's folders as workspace references, skipping dependency folders", async () => {
    mkdirSync(join(dir, "src", "billing"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "round"), { recursive: true });
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, "src", "billing", "round.ts"), "");
    writeFileSync(join(dir, "src", "billing", "invoice.ts"), "");
    writeFileSync(join(dir, "src", "around.md"), "");
    writeFileSync(join(dir, "node_modules", "round", "index.js"), "");
    writeFileSync(join(dir, ".git", "round"), "");
    const source = workspaceCompletion([dir]);
    expect(source.trigger).toBe("@");
    const items = await source.complete("round", new AbortController().signal);
    // A file named for the query comes first.
    expect(items.map((item) => item.label)).toEqual(["src/billing/round.ts", "src/around.md"]);
    expect(items[0]).toEqual({ label: "src/billing/round.ts", insert: "@src/billing/round.ts", attach: { workspaceFileRefs: ["src/billing/round.ts"] } });
    expect((await source.complete("ROUND", new AbortController().signal)).length).toBe(2);
    expect(await workspaceCompletion([join(dir, "missing")]).complete("", new AbortController().signal)).toEqual([]);
  });

  it("offers at most twenty items", async () => {
    for (let index = 0; index < 30; index += 1) writeFileSync(join(dir, `note-${String(index).padStart(2, "0")}.md`), "");
    expect(await workspaceCompletion([dir]).complete("note", new AbortController().signal)).toHaveLength(20);
  });

  it("completes only under folders on this machine, and always gives the commands and the history", () => {
    expect(presentRoots([dir, join(dir, "missing")])).toEqual([dir]);
    writeFileSync(join(dir, "file.txt"), "");
    expect(presentRoots([join(dir, "file.txt")])).toEqual([]);
    expect(cliComposer([dir]).completions).toHaveLength(1);
    const none = cliComposer([join(dir, "missing")]);
    expect(none.completions).toEqual([]);
    expect(none.commands).toHaveLength(4);
    expect(none.history).toBeDefined();
  });
});

describe("the prompt history per directory", () => {
  it("lives under the config directory, one file per working directory", () => {
    expect(historyPath("/work/a", dir)).toMatch(new RegExp(`^${dir}/\\.stigmer/history/[0-9a-f]{16}\\.json$`));
    expect(historyPath("/work/a", dir)).not.toBe(historyPath("/work/b", dir));
  });

  it("keeps each message once, readable only by its owner, the newest 500", async () => {
    const history = fileHistory("/work/a", dir);
    expect(await history.load()).toEqual([]);
    await history.append("first");
    await history.append("first");
    await history.append("  ");
    await history.append("second");
    expect(await history.load()).toEqual(["first", "second"]);
    expect(statSync(historyPath("/work/a", dir)).mode & 0o777).toBe(0o600);
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) await history.append(`m${index}`);
    const kept = await history.load();
    expect(kept).toHaveLength(HISTORY_LIMIT);
    expect(kept.at(-1)).toBe(`m${HISTORY_LIMIT + 4}`);
    expect(await fileHistory("/work/b", dir).load()).toEqual([]);
  });

  it("reads a damaged or foreign file as no history, and goes on when it cannot write", async () => {
    const path = historyPath("/work/a", dir);
    mkdirSync(join(dir, ".stigmer", "history"), { recursive: true });
    writeFileSync(path, "not json");
    expect(await fileHistory("/work/a", dir).load()).toEqual([]);
    writeFileSync(path, JSON.stringify({ entries: ["x"] }));
    expect(await fileHistory("/work/a", dir).load()).toEqual([]);
    writeFileSync(path, JSON.stringify(["kept", 7]));
    expect(await fileHistory("/work/a", dir).load()).toEqual(["kept"]);
    // A file where the folder should be: nothing is written, nothing throws.
    writeFileSync(join(dir, "blocked"), "");
    const blocked = fileHistory("/work/a", join(dir, "blocked"));
    await blocked.append("lost");
    expect(await blocked.load()).toEqual([]);
    expect(readFileSync(path, "utf8")).toBe(JSON.stringify(["kept", 7]));
  });
});
